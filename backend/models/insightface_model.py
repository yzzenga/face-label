"""InsightFace 模型封装 (ArcFace / MobileFaceNet)
支持 CPU 和 GPU 推理，自动检测可用设备，提供优雅回退。
"""

import os
import sys
import logging
from typing import List, Optional, Tuple
import numpy as np
import cv2

from .base import FaceModel, ModelRegistry
from .downloader import (
    apply_mirror, set_model_dir, get_model_dir,
    get_current_mirror_info, patch_insightface_from_env,
)

logger = logging.getLogger(__name__)


class InsightFaceModel(FaceModel):
    """InsightFace 人脸识别模型"""

    def __init__(self, model_variant: str = "arcface"):
        """
        model_variant:
          - "arcface":   buffalo_l (高精度)
          - "mobilefacenet": buffalo_s (轻量)
        """
        self.model_variant = model_variant
        self._app = None
        self._model_name = "buffalo_l" if model_variant == "arcface" else "buffalo_s"
        self._current_device = "cpu"
        self._loaded = False

    def load(self, device: str = "auto", mirror: str = None, model_dir: str = None):
        """加载 InsightFace 模型

        Args:
            device: "auto" | "cpu" | "cuda"
            mirror: 镜像源标识，如 "github", "ghproxy"，None 则从环境变量读取
            model_dir: 模型存储目录，None 则从环境变量读取
        """
        # 0. 应用镜像源和模型目录（必须在 import insightface 之前生效）
        if mirror:
            apply_mirror(mirror)
        if model_dir:
            set_model_dir(model_dir)
        # 从环境变量 patch（如果已导入）
        patch_insightface_from_env()

        try:
            import insightface
            from insightface.app import FaceAnalysis
        except ImportError:
            raise ImportError(
                "请安装 insightface: pip install insightface\n"
            )

        # 1. 获取模型目录
        model_root = get_model_dir()

        # 2. 解析设备，获取正确的 providers
        providers, ctx_id, resolved_device = self._resolve_providers(device)

        logger.info(
            f"加载 InsightFace 模型: {self._model_name}, "
            f"device={resolved_device}, ctx_id={ctx_id}, "
            f"providers={providers}, model_dir={model_root}"
        )

        # 3. 加载模型（传入自定义目录）
        try:
            self._app = FaceAnalysis(
                name=self._model_name,
                root=model_root,
                providers=providers,
            )
            self._app.prepare(ctx_id=ctx_id, det_size=(640, 640))
        except Exception as e:
            # 如果 GPU 加载失败，尝试自动回退到 CPU
            if resolved_device != "cpu":
                logger.warning(f"GPU 加载失败 ({e})，自动回退到 CPU...")
                providers = ["CPUExecutionProvider"]
                ctx_id = -1
                self._app = FaceAnalysis(
                    name=self._model_name,
                    root=model_root,
                    providers=providers,
                )
                self._app.prepare(ctx_id=-1, det_size=(640, 640))
                resolved_device = "cpu"
            else:
                raise

        self._current_device = resolved_device
        self._loaded = True
        logger.info(f"InsightFace 模型加载完成: {self._model_name} (device={resolved_device})")

    def _resolve_providers(self, device: str) -> Tuple[List[str], int, str]:
        """解析设备配置，返回 (providers, ctx_id, resolved_device)"""
        try:
            import onnxruntime as ort
        except ImportError:
            raise ImportError(
                "请安装 onnxruntime: pip install onnxruntime\n"
                "如果有 NVIDIA GPU + CUDA，可安装 GPU 版获得加速:\n"
                "  pip install onnxruntime-gpu"
            )

        available = ort.get_available_providers()
        has_cuda = "CUDAExecutionProvider" in available
        has_tensorrt = "TensorrtExecutionProvider" in available

        logger.info(
            f"ONNX Runtime 可用 providers: {available} "
            f"(CUDA={'✓' if has_cuda else '✗'}, TensorRT={'✓' if has_tensorrt else '✗'})"
        )

        # ── 用户强制 CPU ──
        if device == "cpu":
            return ["CPUExecutionProvider"], -1, "cpu"

        # ── 用户强制 CUDA ──
        if device == "cuda":
            if not has_cuda:
                logger.warning("用户指定 CUDA，但系统不可用，回退到 CPU")
                return ["CPUExecutionProvider"], -1, "cpu"
            return ["CUDAExecutionProvider", "CPUExecutionProvider"], 0, "cuda"

        # ── 自动检测 ──
        if device == "auto":
            if has_cuda:
                logger.info("✓ 检测到 CUDA，使用 GPU 推理")
                return ["CUDAExecutionProvider", "CPUExecutionProvider"], 0, "cuda"
            else:
                logger.info("未检测到 CUDA，使用 CPU 推理")
                return ["CPUExecutionProvider"], -1, "cpu"

        # 兜底
        return ["CPUExecutionProvider"], -1, "cpu"

    def unload(self):
        """卸载模型"""
        self._app = None
        self._loaded = False
        logger.info("InsightFace 模型已卸载")

    def detect_faces(self, image_path: str) -> List[dict]:
        """检测图片中的人脸"""
        if not self._loaded or self._app is None:
            raise RuntimeError("模型未加载，请先调用 load()")

        # 使用 imdecode 支持中文路径
        import numpy as np
        img = cv2.imdecode(np.fromfile(image_path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"无法读取图片: {image_path}")

        faces = self._app.get(img)
        results = []

        for idx, face in enumerate(faces):
            bbox = face.bbox.astype(float).tolist()  # [x1, y1, x2, y2]
            results.append({
                "face_index": idx,
                "bbox": {
                    "x1": float(bbox[0]),
                    "y1": float(bbox[1]),
                    "x2": float(bbox[2]),
                    "y2": float(bbox[3]),
                },
                "confidence": float(face.det_score),
                "embedding": face.normed_embedding.astype(np.float32),
                "landmarks": face.landmark.astype(float).tolist() if face.landmark is not None else [],
            })

        return results

    def compute_similarity(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """余弦相似度"""
        emb1 = emb1 / np.linalg.norm(emb1)
        emb2 = emb2 / np.linalg.norm(emb2)
        return float(np.dot(emb1, emb2))

    def get_model_info(self) -> dict:
        import os
        from .downloader import get_model_dir
        model_path = os.path.join(get_model_dir(), "models", self._model_name) if self._loaded else ""
        return {
            "key": f"insightface_{self.model_variant}",
            "name": f"InsightFace {'ArcFace (R100)' if self.model_variant == 'arcface' else 'MobileFaceNet'}",
            "description": "高精度人脸识别，支持多脸检测，亚洲人脸优化",
            "accuracy": "99.83%" if self.model_variant == "arcface" else "99.68%",
            "model_size": "210MB" if self.model_variant == "arcface" else "15MB",
            "speed": "中等" if self.model_variant == "arcface" else "快",
            "is_active": self._loaded,
            "model_path": model_path,
        }


# 注册到注册表
ModelRegistry.register("insightface_arcface", lambda: InsightFaceModel("arcface"))
ModelRegistry.register("insightface_mobilefacenet", lambda: InsightFaceModel("mobilefacenet"))