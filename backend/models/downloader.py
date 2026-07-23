"""模型下载管理器
支持镜像源切换和自定义模型目录。
通过 patch insightface 的 BASE_REPO_URL 实现下载源切换。
"""

import os
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ─── 镜像源配置 ───
MIRRORS = {
    "github": {
        "name": "GitHub (官方)",
        "description": "直接从 GitHub Release 下载，国内可能需要代理",
        "base_url": "https://github.com/deepinsight/insightface/releases/download/v0.7",
    },
    "ghproxy": {
        "name": "ghproxy (国内加速)",
        "description": "通过 ghproxy.com 代理加速 GitHub 下载",
        "base_url": "https://ghproxy.com/https://github.com/deepinsight/insightface/releases/download/v0.7",
    },
    "hf_mirror": {
        "name": "HF Mirror (国内镜像)",
        "description": "通过 hf-mirror.com 代理加速下载",
        "base_url": "https://hf-mirror.com/InsightFace-REST/buffalo_l/resolve/main",
    },
}

# 默认模型目录
DEFAULT_MODEL_DIR = os.path.expanduser("~/.insightface")


def get_model_dir() -> str:
    """获取当前模型存储目录"""
    return os.environ.get("INSIGHTFACE_HOME", DEFAULT_MODEL_DIR)


def set_model_dir(path: str) -> str:
    """设置模型存储目录，目录不存在则自动创建"""
    path = os.path.expanduser(path)
    abs_path = str(Path(path).resolve())
    os.makedirs(abs_path, exist_ok=True)
    os.environ["INSIGHTFACE_HOME"] = abs_path
    logger.info(f"模型目录已设置为: {abs_path}")
    return abs_path


def get_available_mirrors() -> list:
    """获取可用镜像源列表"""
    return [
        {
            "key": key,
            "name": info["name"],
            "description": info["description"],
            "base_url": info["base_url"],
        }
        for key, info in MIRRORS.items()
    ]


def apply_mirror(mirror_key: str) -> dict:
    """应用镜像源配置（patch insightface 的下载地址）

    Args:
        mirror_key: 镜像源标识，如 "github", "ghproxy"

    Returns:
        镜像源信息 dict
    """
    if mirror_key not in MIRRORS:
        logger.warning(f"未知镜像源: {mirror_key}，使用 GitHub 官方")
        mirror_key = "github"

    mirror = MIRRORS[mirror_key]
    base_url = mirror["base_url"]

    # 1. 存到环境变量（供后续进程使用）
    os.environ["INSIGHTFACE_BASE_REPO_URL"] = base_url

    # 2. 如果 insightface 已导入，直接 patch 模块变量
    try:
        import insightface.utils.storage as storage
        old_url = getattr(storage, 'BASE_REPO_URL', '(无)')
        storage.BASE_REPO_URL = base_url
        logger.info(
            f"已 patch insightface 下载源: {old_url} → {base_url}"
        )
    except ImportError:
        logger.info(
            f"insightface 尚未导入，将 IDE 环境变量生效: "
            f"INSIGHTFACE_BASE_REPO_URL={base_url}"
        )

    logger.info(f"镜像源已切换至: {mirror['name']} ({base_url})")
    return mirror


def patch_insightface_from_env():
    """从环境变量读取镜像配置并 patch insightface（启动时调用）"""
    base_url = os.environ.get("INSIGHTFACE_BASE_REPO_URL")
    if not base_url:
        return

    try:
        import insightface.utils.storage as storage
        if storage.BASE_REPO_URL != base_url:
            logger.info(
                f"从环境变量 patch 下载源: {storage.BASE_REPO_URL} → {base_url}"
            )
            storage.BASE_REPO_URL = base_url
    except ImportError:
        pass


def get_current_mirror_info() -> dict:
    """获取当前生效的镜像源信息"""
    current_url = os.environ.get("INSIGHTFACE_BASE_REPO_URL", "")

    # 尝试从已导入的 insightface 读取
    if not current_url:
        try:
            import insightface.utils.storage as storage
            current_url = getattr(storage, 'BASE_REPO_URL', '')
        except ImportError:
            pass

    # 匹配已知镜像源
    for key, info in MIRRORS.items():
        if info["base_url"] == current_url:
            return {
                "key": key,
                "name": info["name"],
                "description": info["description"],
                "base_url": current_url,
            }

    # 自定义 URL
    return {
        "key": "custom",
        "name": "自定义",
        "description": "用户自定义下载源",
        "base_url": current_url or MIRRORS["github"]["base_url"],
    }


# ─── 模型可用性检查 ───

# 模型名称 → InsightFace 模型包名映射
MODEL_PACK_MAP = {
    "insightface_arcface": "buffalo_l",
    "insightface_mobilefacenet": "buffalo_s",
}

def check_model_available(model_key: str) -> dict:
    """检查模型文件是否已经在本地存在

    Returns:
        {"available": bool, "path": str|None, "size_mb": float|None}
    """
    model_dir = get_model_dir()
    models_root = os.path.join(model_dir, "models")

    # 检查 InsightFace 模型
    if model_key in MODEL_PACK_MAP:
        pack_name = MODEL_PACK_MAP[model_key]
        pack_dir = os.path.join(models_root, pack_name)
        if os.path.isdir(pack_dir):
            # 查找 .onnx 文件
            onnx_files = [f for f in os.listdir(pack_dir) if f.endswith(".onnx")]
            if onnx_files:
                total_size = sum(
                    os.path.getsize(os.path.join(pack_dir, f))
                    for f in onnx_files
                    if os.path.isfile(os.path.join(pack_dir, f))
                )
                return {
                    "available": True,
                    "path": pack_dir,
                    "size_mb": round(total_size / (1024 * 1024), 1),
                    "file_count": len(onnx_files),
                }
        return {
            "available": False,
            "path": pack_dir,
            "size_mb": None,
            "file_count": 0,
        }

    # DeepFace 模型 — 首次使用自动下载，标记为"按需下载"
    if model_key == "deepface_facenet512":
        return {
            "available": "ondemand",
            "path": None,
            "size_mb": None,
            "file_count": 0,
        }

    return {
        "available": False,
        "path": None,
        "size_mb": None,
        "file_count": 0,
    }