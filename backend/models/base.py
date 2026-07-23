"""人脸识别模型抽象基类"""

from abc import ABC, abstractmethod
from typing import List, Optional, Tuple
import numpy as np


class FaceModel(ABC):
    """人脸识别模型统一接口"""

    @abstractmethod
    def load(self, device: str = "auto"):
        """加载模型"""
        ...

    @abstractmethod
    def unload(self):
        """卸载模型，释放资源"""
        ...

    @abstractmethod
    def detect_faces(self, image_path: str) -> List[dict]:
        """
        检测图片中的人脸
        返回: [{
            "face_index": int,
            "bbox": {"x1": float, "y1": float, "x2": float, "y2": float},
            "confidence": float,
            "embedding": np.ndarray,
            "landmarks": [[x,y], ...]  # 可选
        }, ...]
        """
        ...

    @abstractmethod
    def compute_similarity(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """计算两个特征向量的相似度 (0~1)"""
        ...

    @abstractmethod
    def get_model_info(self) -> dict:
        """返回模型信息"""
        ...

    def find_best_match(self, query_emb: np.ndarray,
                        known_embeddings: List[Tuple[str, np.ndarray]]) -> Tuple[Optional[str], float]:
        """
        在已知人脸库中查找最佳匹配
        返回: (name, score)
        """
        best_name = None
        best_score = 0.0

        for name, known_emb in known_embeddings:
            score = self.compute_similarity(query_emb, known_emb)
            if score > best_score:
                best_score = score
                best_name = name

        return best_name, best_score


class ModelRegistry:
    """模型注册表"""

    _models = {}
    _registered = False

    @classmethod
    def register(cls, key: str, model_class):
        cls._models[key] = model_class

    @classmethod
    def _ensure_loaded(cls):
        """确保所有模型模块已导入（懒加载）"""
        if cls._registered:
            return
        # 导入模型模块以触发 register() 调用
        import backend.models.insightface_model  # noqa: F401
        import backend.models.deepface_model     # noqa: F401
        cls._registered = True

    @classmethod
    def get_model_class(cls, key: str):
        cls._ensure_loaded()
        if key not in cls._models:
            raise ValueError(f"未知模型: {key}，可用模型: {list(cls._models.keys())}")
        return cls._models[key]

    @classmethod
    def list_models(cls) -> dict:
        cls._ensure_loaded()
        return dict(cls._models)