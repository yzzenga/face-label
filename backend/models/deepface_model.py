"""DeepFace 模型封装 (FaceNet512)"""

import logging
from typing import List, Optional
import numpy as np

from .base import FaceModel, ModelRegistry

logger = logging.getLogger(__name__)


class DeepFaceModel(FaceModel):
    """DeepFace 人脸识别模型封装"""

    def __init__(self, backend: str = "Facenet512"):
        self.backend = backend
        self._loaded = False
        self._detector_backend = "retinaface"

    def load(self, device: str = "auto"):
        """加载 DeepFace 模型"""
        try:
            from deepface import DeepFace
            self._deepface = DeepFace
        except ImportError:
            raise ImportError("请安装 deepface: pip install deepface")

        # DeepFace 惰性加载，首次调用时自动下载模型
        self._loaded = True
        logger.info(f"DeepFace 模型就绪: backend={self.backend}")

    def unload(self):
        """卸载模型"""
        self._deepface = None
        self._loaded = False
        logger.info("DeepFace 模型已卸载")

    def detect_faces(self, image_path: str) -> List[dict]:
        """检测图片中的人脸并提取特征"""
        if not self._loaded:
            raise RuntimeError("模型未加载，请先调用 load()")

        try:
            # 使用 DeepFace.represent 检测 + 提取特征
            results = self._deepface.represent(
                img_path=image_path,
                model_name=self.backend,
                detector_backend=self._detector_backend,
                enforce_detection=False,  # 即使检测不到人脸也不报错
            )
        except Exception as e:
            logger.warning(f"DeepFace 处理失败 [{image_path}]: {e}")
            return []

        faces = []
        for idx, result in enumerate(results):
            area = result.get("area", {})
            bbox = {
                "x1": float(area.get("x", 0)),
                "y1": float(area.get("y", 0)),
                "x2": float(area.get("x", 0) + area.get("w", 0)),
                "y2": float(area.get("y", 0) + area.get("h", 0)),
            }
            embedding = np.array(result["embedding"], dtype=np.float32)

            faces.append({
                "face_index": idx,
                "bbox": bbox,
                "confidence": float(result.get("face_confidence", 1.0)),
                "embedding": embedding,
                "landmarks": [],
            })

        return faces

    def compute_similarity(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """余弦相似度"""
        emb1 = emb1 / np.linalg.norm(emb1)
        emb2 = emb2 / np.linalg.norm(emb2)
        return float(np.dot(emb1, emb2))

    def get_model_info(self) -> dict:
        return {
            "key": "deepface_facenet512",
            "name": f"DeepFace {self.backend}",
            "description": "Google FaceNet 架构，512维嵌入，MIT 许可",
            "accuracy": "99.65%",
            "model_size": "~300MB",
            "speed": "较慢",
            "is_active": self._loaded,
        }


# 注册到注册表
ModelRegistry.register("deepface_facenet512", lambda: DeepFaceModel("Facenet512"))