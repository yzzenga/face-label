"""模型下载管理器
支持镜像源切换、自定义模型目录、异步下载进度追踪。
通过 patch insightface 的 BASE_REPO_URL 实现下载源切换。
"""

import os
import io
import json
import uuid
import time
import logging
import zipfile
import threading
from pathlib import Path
from typing import Optional, Dict, Any

import requests

logger = logging.getLogger(__name__)

# ─── 镜像源配置 ───
MIRRORS = {
    "hf_mirror": {
        "name": "HF Mirror (国内镜像)",
        "description": "通过 hf-mirror.com 镜像加速下载，国内推荐",
        "base_url": "https://hf-mirror.com/InsightFace-REST/buffalo_l/resolve/main",
    },
    "ghproxy": {
        "name": "ghproxy.net (国内加速)",
        "description": "通过 ghproxy.net 代理加速 GitHub 下载",
        "base_url": "https://ghproxy.net/https://github.com/deepinsight/insightface/releases/download/v0.7",
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

# ─── 下载 URL 构建 ───

# InsightFace 模型包名 → zip 文件名
MODEL_ZIP_MAP = {
    "insightface_arcface": "buffalo_l.zip",
    "insightface_mobilefacenet": "buffalo_s.zip",
}

def get_model_download_url(model_key: str, mirror_key: str = None) -> Optional[str]:
    """获取模型的直接下载链接

    Args:
        model_key: 模型标识 (如 insightface_arcface)
        mirror_key: 镜像源标识，None 则使用 hf_mirror

    Returns:
        完整的下载 URL，如果模型或镜像源不支持则返回 None
    """
    zip_name = MODEL_ZIP_MAP.get(model_key)
    if not zip_name:
        return None  # DeepFace 等非 zip 下载的模型

    if mirror_key is None:
        mirror_key = "hf_mirror"

    if mirror_key not in MIRRORS:
        return None

    base_url = MIRRORS[mirror_key]["base_url"]
    return f"{base_url}/{zip_name}"


# ─── 异步下载管理器 ───

_download_tasks: Dict[str, Dict[str, Any]] = {}
_tasks_lock = threading.Lock()
# 防止频繁导入 requests（已在模块顶部导入）

def _do_download(task_id: str, model_key: str, mirror_key: str, model_dir: str):
    """后台线程：下载模型 zip 包并解压到目标目录"""
    pack_name = MODEL_PACK_MAP.get(model_key)
    if not pack_name:
        _update_task(task_id, status="error", error=f"未知模型: {model_key}")
        return

    zip_name = f"{pack_name}.zip"
    mirror = MIRRORS.get(mirror_key)
    if not mirror:
        _update_task(task_id, status="error", error=f"未知镜像源: {mirror_key}")
        return

    download_url = f"{mirror['base_url']}/{zip_name}"
    models_root = os.path.join(model_dir, "models")
    target_dir = os.path.join(models_root, pack_name)
    zip_path = os.path.join(models_root, zip_name)

    os.makedirs(models_root, exist_ok=True)

    try:
        _update_task(task_id, status="downloading", download_url=download_url)

        logger.info(f"开始下载模型: {download_url}")
        response = requests.get(download_url, stream=True, timeout=30)
        response.raise_for_status()

        total = int(response.headers.get("content-length", 0))
        _update_task(task_id, total_bytes=total)

        downloaded = 0
        start_time = time.time()
        chunk_size = 128 * 1024  # 128KB

        # 边下载边写入临时文件
        with open(zip_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if not chunk:
                    continue
                f.write(chunk)
                downloaded += len(chunk)
                elapsed = time.time() - start_time
                if elapsed > 0:
                    speed = downloaded / elapsed  # bytes/sec
                    speed_mbps = speed / (1024 * 1024)

                progress = round(downloaded / total * 100, 1) if total else 0
                _update_task(
                    task_id,
                    bytes_downloaded=downloaded,
                    speed_mbps=round(speed_mbps, 2),
                    progress=progress,
                )

        logger.info(f"模型下载完成 ({downloaded / 1024 / 1024:.1f} MB)，正在解压...")
        _update_task(task_id, status="extracting", progress=99)

        # 解压 zip
        os.makedirs(target_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(target_dir)
        os.remove(zip_path)

        # 检查解压后的模型文件
        onnx_files = [f for f in os.listdir(target_dir) if f.endswith(".onnx")]
        logger.info(f"模型解压完成: {len(onnx_files)} 个 onnx 文件 → {target_dir}")

        _update_task(task_id, status="completed", progress=100)

    except requests.exceptions.RequestException as e:
        error_msg = f"网络下载失败: {e}"
        logger.error(error_msg)
        _update_task(task_id, status="error", error=error_msg)
    except zipfile.BadZipFile as e:
        error_msg = f"ZIP 文件损坏: {e}"
        logger.error(error_msg)
        _update_task(task_id, status="error", error=error_msg)
    except Exception as e:
        error_msg = f"下载失败: {e}"
        logger.error(error_msg, exc_info=True)
        _update_task(task_id, status="error", error=error_msg)
    finally:
        # 清理临时 zip 文件
        if os.path.exists(zip_path):
            try:
                os.remove(zip_path)
            except OSError:
                pass


def _update_task(task_id: str, **kwargs):
    """线程安全地更新下载任务状态"""
    with _tasks_lock:
        if task_id in _download_tasks:
            _download_tasks[task_id].update(kwargs)


def start_async_download(model_key: str, mirror_key: str, model_dir: str) -> str:
    """启动异步模型下载

    在后台线程中下载并解压模型，返回 task_id 用于查询进度。

    Returns:
        task_id: 下载任务标识
    """
    task_id = uuid.uuid4().hex[:12]

    with _tasks_lock:
        _download_tasks[task_id] = {
            "task_id": task_id,
            "model_key": model_key,
            "status": "starting",
            "progress": 0,
            "bytes_downloaded": 0,
            "total_bytes": 0,
            "speed_mbps": 0,
            "download_url": None,
            "error": None,
        }

    thread = threading.Thread(
        target=_do_download,
        args=(task_id, model_key, mirror_key, model_dir),
        daemon=True,
        name=f"model-dl-{task_id}",
    )
    thread.start()

    return task_id


def get_download_progress(task_id: str) -> Optional[Dict[str, Any]]:
    """获取下载任务进度"""
    with _tasks_lock:
        task = _download_tasks.get(task_id)
        if task is None:
            return None
        return dict(task)


def cleanup_download_task(task_id: str):
    """清理已完成/失败的下载任务"""
    with _tasks_lock:
        _download_tasks.pop(task_id, None)


def get_active_downloads() -> list:
    """获取所有活跃（进行中）的下载任务"""
    with _tasks_lock:
        return [
            {"task_id": tid, "model_key": t["model_key"], "progress": t["progress"]}
            for tid, t in _download_tasks.items()
            if t["status"] in ("starting", "downloading", "extracting")
        ]


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