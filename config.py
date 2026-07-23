"""全局配置"""

import os
from pathlib import Path

# 项目根目录
BASE_DIR = Path(__file__).parent

# 数据目录
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "output"

# 确保目录存在
DATA_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# 数据库路径
DB_PATH = DATA_DIR / "tags.db"

# 人脸特征存储目录
FACE_DB_DIR = DATA_DIR / "face_db"
FACE_DB_DIR.mkdir(exist_ok=True)

# 支持的图片格式
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# 默认配置
DEFAULT_CONFIG = {
    "current_model": "insightface_arcface",  # 当前使用的模型
    "detector": "scrfd",                      # 检测器
    "device": "auto",                         # auto / cpu / cuda
    "match_threshold": 0.55,                  # 人脸匹配阈值
    "max_face_size": 640,                     # 检测最大尺寸
    "mirror": "hf_mirror",                    # 模型下载镜像源（默认 hf-mirror）
    "model_dir": "~/.insightface",            # 模型存储目录
}

# 可用模型列表
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

# 图片扫描配置
SCAN_BATCH_SIZE = 50  # 每批扫描图片数量