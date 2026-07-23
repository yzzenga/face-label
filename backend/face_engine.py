"""人脸识别引擎 - 统一管理模型和识别逻辑"""

import os
import logging
from typing import List, Optional, Tuple
from pathlib import Path
import numpy as np

logger = logging.getLogger(__name__)

from backend.database import (
    get_all_face_embeddings, get_config, set_config
)
from backend.models.base import ModelRegistry

# 导入模型模块以触发 ModelRegistry.register() 注册
import backend.models.insightface_model  # noqa: F401
import backend.models.deepface_model     # noqa: F401

# 硬编码模型列表和默认配置，避免 import config 可能引入错误模块的问题
AVAILABLE_MODELS = {
    "insightface_arcface": {
        "name": "InsightFace ArcFace (R100)",
        "description": "高精度，推荐有 GPU 时使用",
        "accuracy": "99.83%",
        "model_size": "210MB",
        "speed": "中等",
    },
    "insightface_mobilefacenet": {
        "name": "InsightFace MobileFaceNet",
        "description": "轻量快速，适合 CPU 或无 GPU 环境",
        "accuracy": "99.68%",
        "model_size": "15MB",
        "speed": "快",
    },
    "deepface_facenet512": {
        "name": "DeepFace FaceNet512",
        "description": "Google FaceNet 架构，512维嵌入，MIT 许可",
        "accuracy": "99.65%",
        "model_size": "~300MB",
        "speed": "较慢",
    },
}

DEFAULT_MODEL = "insightface_arcface"
DEFAULT_DEVICE = "auto"
DEFAULT_THRESHOLD = 0.55


class FaceEngine:
    """人脸识别引擎，管理模型加载、切换、识别的核心类"""

    def __init__(self):
        self._model = None
        self._model_key = None
        self._known_embeddings_cache = []  # [(name, embedding), ...]
        self._cache_dirty = True

    # ─── 模型管理 ───

    def load_model(self, model_key: str = None, device: str = None):
        """加载指定的模型

        Args:
            model_key: 模型标识，None 则从配置读取
            device: "auto" | "cpu" | "cuda"，None 则从配置读取
        """
        # 读取保存的配置
        if model_key is None:
            model_key = get_config("current_model", DEFAULT_MODEL)
        if device is None:
            device = get_config("device", DEFAULT_DEVICE)

        if model_key not in AVAILABLE_MODELS:
            logger.warning(f"未知模型: {model_key}，使用默认模型")
            model_key = DEFAULT_MODEL

        # 如果已加载相同模型且设备相同，跳过
        if (self._model_key == model_key
                and self._model is not None
                and getattr(self._model, '_current_device', None) == device):
            logger.info(f"模型 {model_key} 已加载 (device={device})")
            return True

        # 卸载旧模型
        self.unload_model()

        logger.info(f"正在加载模型: {model_key}, device={device}...")
        try:
            # 直接按模型标识导入并创建实例，不依赖 ModelRegistry
            if model_key == "insightface_arcface":
                from backend.models.insightface_model import InsightFaceModel
                self._model = InsightFaceModel("arcface")
            elif model_key == "insightface_mobilefacenet":
                from backend.models.insightface_model import InsightFaceModel
                self._model = InsightFaceModel("mobilefacenet")
            elif model_key == "deepface_facenet512":
                from backend.models.deepface_model import DeepFaceModel
                self._model = DeepFaceModel("Facenet512")
            else:
                raise ValueError(f"不支持的模型: {model_key}，可选: {list(AVAILABLE_MODELS.keys())}")

            self._model.load(device=device)
            self._model_key = model_key
            set_config("current_model", model_key)
            set_config("device", device)
            self._cache_dirty = True
            logger.info(f"模型加载成功: {model_key} (device={device})")
            return True
        except Exception as e:
            import traceback
            logger.error(f"模型加载失败 [{model_key}]: {e}")
            traceback.print_stack()
            self._model = None
            self._model_key = None
            raise

    def unload_model(self):
        """卸载当前模型"""
        if self._model is not None:
            try:
                self._model.unload()
            except Exception as e:
                logger.warning(f"模型卸载异常: {e}")
            self._model = None
            self._model_key = None

    def switch_model(self, model_key: str, device: str = "auto") -> dict:
        """切换模型"""
        # 直接加载，不依赖任何外部配置检查
        self.load_model(model_key, device)
        return self.get_model_info()

    def get_model_info(self) -> dict:
        """获取当前模型信息"""
        if self._model is None:
            return {
                "key": "",
                "name": "未加载",
                "description": "请先加载模型",
                "accuracy": "-",
                "model_size": "-",
                "speed": "-",
                "is_active": False,
            }
        return self._model.get_model_info()

    def get_available_models(self) -> list:
        """获取所有可用模型列表"""
        results = []
        for key, info in AVAILABLE_MODELS.items():
            results.append({
                "key": key,
                **info,
                "is_active": (key == self._model_key),
            })
        return results

    # ─── 人脸检测 ───

    def detect_faces(self, image_path: str) -> List[dict]:
        """检测图片中的人脸（含特征提取）"""
        if self._model is None:
            raise RuntimeError("模型未加载，请先调用 load_model()")
        return self._model.detect_faces(image_path)

    # ─── 人脸识别 ───

    def recognize_faces(self, image_path: str, threshold: float = None) -> List[dict]:
        """
        检测并识别图片中的人脸
        返回每个检测到的人脸，包含预测的姓名和置信度
        """
        if threshold is None:
            threshold = float(get_config("match_threshold", str(DEFAULT_THRESHOLD)))

        # 1. 检测人脸
        faces = self.detect_faces(image_path)

        # 2. 获取已知人脸库
        known_embeddings = self._get_known_embeddings()

        if not known_embeddings:
            # 没有已知人脸，返回未识别
            for face in faces:
                face["predicted_name"] = None
                face["predicted_score"] = None
            return faces

        # 3. 逐个人脸匹配
        for face in faces:
            query_emb = face["embedding"]
            best_name, best_score = self._model.find_best_match(query_emb, known_embeddings)

            if best_score >= threshold:
                face["predicted_name"] = best_name
                face["predicted_score"] = round(best_score, 4)
            else:
                face["predicted_name"] = None
                face["predicted_score"] = None

        return faces

    def _get_known_embeddings(self) -> List[Tuple[str, np.ndarray]]:
        """获取已知人脸特征缓存"""
        if self._cache_dirty:
            self._known_embeddings_cache = get_all_face_embeddings()
            self._cache_dirty = False
        return self._known_embeddings_cache

    def invalidate_cache(self):
        """使缓存失效（标注新数据后调用）"""
        self._cache_dirty = True

    # ─── 搜索功能 ───

    def search_by_reference(self, reference_images: List[str],
                            target_dir: str,
                            threshold: float = 0.55) -> List[dict]:
        """
        根据参考图片搜索目标目录中匹配的人脸
        返回按参考图片分组的匹配结果
        """
        from config import SUPPORTED_EXTENSIONS

        # 1. 提取每张参考图片中的人脸特征，并记录对应的参考图片路径
        ref_groups = []  # [{"ref_path": str, "embeddings": [np.ndarray]}, ...]
        for img_path in reference_images:
            if not os.path.isfile(img_path):
                logger.warning(f"参考图片不存在: {img_path}")
                continue
            try:
                faces = self.detect_faces(img_path)
                embs = [face["embedding"] for face in faces]
                if embs:
                    ref_groups.append({
                        "ref_path": img_path,
                        "embeddings": embs,
                    })
            except Exception as e:
                logger.warning(f"处理参考图片失败 [{img_path}]: {e}")

        if not ref_groups:
            raise ValueError("参考图片中未检测到任何人脸")

        # 2. 扫描目标目录
        target_dir = Path(target_dir)
        if not target_dir.is_dir():
            raise ValueError(f"目标目录不存在: {target_dir}")

        image_files = []
        for ext in SUPPORTED_EXTENSIONS:
            image_files.extend(target_dir.rglob(f"*{ext}"))
            image_files.extend(target_dir.rglob(f"*{ext.upper()}"))

        # 去重
        image_files = list(dict.fromkeys(image_files))

        # 3. 逐张识别，按参考图片分组
        # 先收集所有匹配结果，再按参考图片分组
        all_matches = []  # [{"ref_path": str, "image_path": str, "image_name": str, "matched_faces": [...], "similarity": float}]
        for img_path in image_files:
            try:
                faces = self.detect_faces(str(img_path))
                if not faces:
                    continue

                for ref_group in ref_groups:
                    best_score = 0.0
                    for face in faces:
                        for ref_emb in ref_group["embeddings"]:
                            score = self._model.compute_similarity(face["embedding"], ref_emb)
                            if score > best_score:
                                best_score = score

                    if best_score >= threshold:
                        matched_faces = []
                        for face in faces:
                            face_score = 0.0
                            for ref_emb in ref_group["embeddings"]:
                                s = self._model.compute_similarity(face["embedding"], ref_emb)
                                face_score = max(face_score, s)
                            matched_faces.append({
                                "bbox": face["bbox"],
                                "confidence": float(face["confidence"]),
                                "similarity": round(float(face_score), 4),
                            })

                        all_matches.append({
                            "ref_path": ref_group["ref_path"],
                            "image_path": str(img_path),
                            "image_name": img_path.name,
                            "matched_faces": matched_faces,
                            "similarity": round(float(best_score), 4),
                        })

            except Exception as e:
                logger.warning(f"处理图片失败 [{img_path}]: {e}")
                continue

        # 4. 按参考图片分组
        grouped = {}
        for m in all_matches:
            ref = m["ref_path"]
            if ref not in grouped:
                grouped[ref] = {
                    "ref_path": ref,
                    "ref_name": Path(ref).name,
                    "matches": [],
                }
            grouped[ref]["matches"].append(m)

        # 每组内按相似度降序，组间按匹配数降序
        result = []
        for ref, g in grouped.items():
            g["matches"].sort(key=lambda x: x["similarity"], reverse=True)
            result.append(g)

        result.sort(key=lambda g: len(g["matches"]), reverse=True)
        return result

    # ─── 图片扫描 ───

    def scan_directory(self, directory: str, threshold: float = None) -> dict:
        """
        扫描目录，检测所有图片中的人脸并识别
        """
        from config import SUPPORTED_EXTENSIONS

        scan_dir = Path(directory)
        if not scan_dir.is_dir():
            raise ValueError(f"目录不存在: {directory}")

        image_files = []
        for ext in SUPPORTED_EXTENSIONS:
            image_files.extend(scan_dir.rglob(f"*{ext}"))
            image_files.extend(scan_dir.rglob(f"*{ext.upper()}"))

        # 去重（Windows 文件系统不区分大小写，*.jpg 和 *.JPG 会匹配到相同文件）
        image_files = list(dict.fromkeys(image_files))

        # 按文件名排序
        image_files.sort(key=lambda p: p.name)

        all_images = []
        total_faces = 0

        for img_path in image_files:
            try:
                # 获取图片尺寸
                import cv2
                import numpy as np
                img = cv2.imdecode(np.fromfile(str(img_path), dtype=np.uint8), cv2.IMREAD_COLOR)
                if img is None:
                    continue
                h, w = img.shape[:2]

                # 识别
                faces = self.recognize_faces(str(img_path), threshold)

                # 格式化输出（移除 embedding 以减少传输）
                formatted_faces = []
                for face in faces:
                    formatted_faces.append({
                        "face_index": face["face_index"],
                        "bbox": face["bbox"],
                        "confidence": round(float(face["confidence"]), 4),
                        "predicted_name": face.get("predicted_name"),
                        "predicted_score": face.get("predicted_score"),
                    })

                all_images.append({
                    "image_path": str(img_path),
                    "image_name": img_path.name,
                    "width": w,
                    "height": h,
                    "faces": formatted_faces,
                })
                total_faces += len(formatted_faces)

            except Exception as e:
                logger.warning(f"扫描图片失败 [{img_path}]: {e}")
                continue

        return {
            "total_images": len(all_images),
            "total_faces": total_faces,
            "images": all_images,
        }

    # ─── 按人脸相似度分组扫描 ───

    def scan_grouped_faces(self, directory: str, threshold: float = None) -> dict:
        """
        扫描目录，检测所有图片中的人脸，并按相似度分组
        返回分组结果，每组包含相似的人脸缩略图信息
        """
        from config import SUPPORTED_EXTENSIONS
        import numpy as np
        import cv2

        scan_dir = Path(directory)
        if not scan_dir.is_dir():
            raise ValueError(f"目录不存在: {directory}")

        image_files = []
        for ext in SUPPORTED_EXTENSIONS:
            image_files.extend(scan_dir.rglob(f"*{ext}"))
            image_files.extend(scan_dir.rglob(f"*{ext.upper()}"))
        image_files = list(dict.fromkeys(image_files))
        image_files.sort(key=lambda p: p.name)

        if threshold is None:
            threshold = float(get_config("match_threshold", str(DEFAULT_THRESHOLD)))

        # 收集所有检测到的人脸（含embedding）
        all_faces = []
        for img_path in image_files:
            try:
                img = cv2.imdecode(np.fromfile(str(img_path), dtype=np.uint8), cv2.IMREAD_COLOR)
                if img is None:
                    continue
                h, w = img.shape[:2]
                # 使用 detect_faces 获取含 embedding 的检测结果
                faces = self._model.detect_faces(str(img_path))
                for face in faces:
                    all_faces.append({
                        "image_path": str(img_path),
                        "image_name": img_path.name,
                        "face_index": face["face_index"],
                        "bbox": face["bbox"],
                        "confidence": round(float(face["confidence"]), 4),
                        "embedding": face["embedding"],
                        "width": w,
                        "height": h,
                    })
            except Exception as e:
                logger.warning(f"扫描图片失败 [{img_path}]: {e}")
                continue

        if not all_faces:
            return {"total_groups": 0, "total_faces": 0, "groups": []}

        # 按embedding相似度分组（改进贪心聚类：与组内所有人脸比较）
        groups = []
        used = [False] * len(all_faces)

        for i in range(len(all_faces)):
            if used[i]:
                continue
            # 新组，包含当前人脸
            group = {
                "faces": [self._format_group_face(all_faces[i])],
                "embeddings": [all_faces[i]["embedding"]],  # 保存组内所有embedding
            }
            used[i] = True

            # 迭代扩展：持续扫描，直到没有新成员加入
            changed = True
            while changed:
                changed = False
                for j in range(len(all_faces)):
                    if used[j]:
                        continue
                    # 与组内任意一张人脸比较
                    for ref_emb in group["embeddings"]:
                        sim = self._model.compute_similarity(ref_emb, all_faces[j]["embedding"])
                        if sim >= threshold:
                            group["faces"].append(self._format_group_face(all_faces[j]))
                            group["embeddings"].append(all_faces[j]["embedding"])
                            used[j] = True
                            changed = True
                            break  # 已归入当前组，跳出embedding比较循环

            groups.append(group)

        # 按每组人脸数降序排列
        groups.sort(key=lambda g: len(g["faces"]), reverse=True)

        # 移除embedding，只返回前端需要的数据
        result_groups = []
        for g in groups:
            result_groups.append({
                "face_count": len(g["faces"]),
                "faces": g["faces"],
            })

        return {
            "total_groups": len(result_groups),
            "total_faces": len(all_faces),
            "groups": result_groups,
        }

    def _format_group_face(self, face_data: dict) -> dict:
        """格式化分组中的人脸数据（移除embedding）"""
        return {
            "image_path": face_data["image_path"],
            "image_name": face_data["image_name"],
            "face_index": face_data["face_index"],
            "bbox": face_data["bbox"],
            "confidence": face_data["confidence"],
            "width": face_data.get("width", 0),
            "height": face_data.get("height", 0),
        }


# 全局单例
engine = FaceEngine()