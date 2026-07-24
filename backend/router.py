"""FastAPI 路由"""

import os
import io
import json
import logging
import shutil
import zipfile
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException, Query, Body
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from config import OUTPUT_DIR, DEFAULT_CONFIG, AVAILABLE_MODELS
from backend.schemas import (
    ScanResult, TagRequest, TagResponse, KnownFace,
    SearchRequest, SearchMatch, SearchResult,
    ModelInfo, ConfigUpdate, StatusResponse,
)
from backend.database import (
    save_tag, delete_tag, delete_tags_by_name,
    get_all_known_names, get_known_faces_summary,
    get_faces_grouped_by_name,
    get_config, set_config, get_all_config,
)
from backend.face_engine import engine
from backend.models.downloader import (
    get_available_mirrors, apply_mirror,
    get_model_dir, set_model_dir,
    get_current_mirror_info, check_model_available,
    get_model_download_url, start_async_download,
    get_download_progress, cleanup_download_task,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


# ─── 模型管理 ───

@router.get("/models", response_model=List[ModelInfo])
def list_models():
    """获取可用模型列表"""
    return engine.get_available_models()


@router.get("/models/current", response_model=ModelInfo)
def current_model():
    """获取当前模型信息"""
    return engine.get_model_info()


@router.get("/models/check-availability")
def check_model_availability(model_key: str = Query(..., description="模型标识")):
    """检查模型文件是否已下载到本地"""
    result = check_model_available(model_key)
    # 同时获取模型基本信息
    model_info = AVAILABLE_MODELS.get(model_key, {})
    result["model_name"] = model_info.get("name", model_key)
    result["model_size"] = model_info.get("model_size", "未知")
    return result


@router.post("/models/switch", response_model=StatusResponse)
def switch_model(data: dict = Body(...)):
    """切换模型"""
    model_key = data.get("model_key", "")
    device = data.get("device", "auto")

    if not model_key:
        raise HTTPException(400, "model_key 是必填项")

    try:
        info = engine.switch_model(model_key, device)
        return StatusResponse(success=True, message=f"已切换到 {info['name']}", data=info)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("模型切换失败")
        raise HTTPException(500, f"模型切换失败: {str(e)}")


@router.get("/models/download-url")
def get_model_download_url_api(
    model_key: str = Query(..., description="模型标识"),
    mirror_key: str = Query(None, description="镜像源标识"),
):
    """获取模型的直接下载链接"""
    url = get_model_download_url(model_key, mirror_key)
    if url is None:
        return {"url": None, "message": "该模型不支持直接下载（如 DeepFace 模型在首次使用时自动下载）"}
    return {"url": url, "message": None}


@router.post("/models/download")
async def start_model_download(data: dict = Body(...)):
    """异步启动模型下载，返回 task_id 用于查询进度"""
    model_key = data.get("model_key", "")
    mirror_key = data.get("mirror_key")
    device = data.get("device", "auto")

    if not model_key:
        raise HTTPException(400, "model_key 是必填项")

    # 检查模型是否已存在
    avail = check_model_available(model_key)
    if avail.get("available") is True:
        # 已下载，直接加载
        try:
            info = engine.switch_model(model_key, device)
            return {
                "task_id": None,
                "status": "already_downloaded",
                "message": f"模型已存在，已切换到 {info['name']}",
                "model_info": info,
            }
        except Exception as e:
            raise HTTPException(500, f"模型加载失败: {e}")

    # DeepFace 等非 zip 下载模型
    if avail.get("available") == "ondemand":
        return {
            "task_id": None,
            "status": "ondemand",
            "message": "DeepFace 模型将在首次使用时自动下载",
        }

    # 启动异步下载
    try:
        model_dir = get_model_dir()
        task_id = start_async_download(model_key, mirror_key or "hf_mirror", model_dir)
        return {
            "task_id": task_id,
            "status": "started",
            "message": "模型下载已启动",
        }
    except Exception as e:
        raise HTTPException(500, f"启动下载失败: {e}")


@router.get("/models/download-progress/{task_id}")
async def download_progress_sse(task_id: str):
    """SSE 推送下载进度"""
    from fastapi.responses import StreamingResponse
    import asyncio
    import json

    async def event_generator():
        while True:
            task = get_download_progress(task_id)
            if task is None:
                yield f"data: {json.dumps({'status': 'not_found'})}\n\n"
                break

            yield f"data: {json.dumps(task)}\n\n"

            if task["status"] in ("completed", "error"):
                break

            await asyncio.sleep(0.3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── 目录扫描与识别 ───

@router.get("/scan", response_model=ScanResult)
def scan_directory(dir: str = Query(..., description="图片目录路径"),
                   threshold: float = Query(None, description="匹配阈值")):
    """扫描目录，检测并识别人脸"""
    if not os.path.isdir(dir):
        raise HTTPException(400, f"目录不存在: {dir}")

    try:
        result = engine.scan_directory(dir, threshold)
        return result
    except Exception as e:
        logger.exception("扫描失败")
        raise HTTPException(500, f"扫描失败: {str(e)}")


@router.get("/scan-grouped")
def scan_grouped(dir: str = Query(..., description="图片目录路径"),
                 threshold: float = Query(None, description="匹配阈值")):
    """扫描目录，按人脸相似度分组检测结果"""
    if not os.path.isdir(dir):
        raise HTTPException(400, f"目录不存在: {dir}")

    if engine._model is None:
        raise HTTPException(400, "模型未加载，请先在设置页加载模型")

    try:
        result = engine.scan_grouped_faces(dir, threshold)
        return result
    except Exception as e:
        logger.exception("分组扫描失败")
        raise HTTPException(500, f"分组扫描失败: {str(e)}")


@router.get("/preview/{image_path:path}")
def preview_image(image_path: str):
    """返回原始图片（用于前端展示）"""
    if not os.path.isfile(image_path):
        raise HTTPException(404, f"图片不存在: {image_path}")
    return FileResponse(image_path)


@router.get("/face-thumbnail")
def face_thumbnail(
    image_path: str = Query(...),
    x1: float = Query(...), y1: float = Query(...),
    x2: float = Query(...), y2: float = Query(...),
    size: int = Query(120, description="缩略图尺寸"),
):
    """返回裁剪的人脸缩略图"""
    import cv2
    import numpy as np
    if not os.path.isfile(image_path):
        raise HTTPException(404, f"图片不存在: {image_path}")
    img = cv2.imdecode(np.fromfile(image_path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, f"无法读取图片: {image_path}")
    h, w = img.shape[:2]
    # 边界保护
    x1_i, y1_i = max(0, int(x1)), max(0, int(y1))
    x2_i, y2_i = min(w, int(x2)), min(h, int(y2))
    if x2_i <= x1_i or y2_i <= y1_i:
        raise HTTPException(400, "无效的边界框")
    face_img = img[y1_i:y2_i, x1_i:x2_i]
    # 缩放到统一尺寸
    face_img = cv2.resize(face_img, (size, size))
    _, buf = cv2.imencode(".jpg", face_img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    from fastapi.responses import Response
    return Response(content=buf.tobytes(), media_type="image/jpeg")


# ─── 标注管理 ───

@router.post("/tag", response_model=TagResponse)
def tag_face(data: TagRequest):
    """标注人脸"""
    # 保存标注
    tag_id = save_tag(
        image_path=data.image_path,
        face_index=data.face_index,
        bbox=data.bbox.dict(),
        name=data.name,
        embedding=None,  # 在标注时无需传 embedding，由后续识别自动匹配
    )

    # 使缓存失效，下次识别时重新加载
    engine.invalidate_cache()

    return TagResponse(
        id=tag_id,
        image_path=data.image_path,
        face_index=data.face_index,
        name=data.name,
        success=True,
        message=f"已标注为「{data.name}」",
    )


@router.post("/tag-with-embedding", response_model=TagResponse)
def tag_face_with_embedding(data: dict = Body(...)):
    """标注人脸（含特征向量，由前端在检测后提交）"""
    import numpy as np

    image_path = data["image_path"]
    face_index = data["face_index"]
    name = data["name"]
    bbox = data["bbox"]

    # 将 embedding 转回 numpy
    emb_list = data.get("embedding")
    embedding = np.array(emb_list, dtype=np.float32) if emb_list else None

    tag_id = save_tag(
        image_path=image_path,
        face_index=face_index,
        bbox=bbox,
        name=name,
        embedding=embedding,
    )

    engine.invalidate_cache()

    return TagResponse(
        id=tag_id,
        image_path=image_path,
        face_index=face_index,
        name=name,
        success=True,
        message=f"已标注为「{name}」",
    )


@router.get("/faces/known", response_model=List[KnownFace])
def list_known_faces():
    """获取已标注的人脸库"""
    summary = get_known_faces_summary()
    return [
        KnownFace(
            id=idx,
            name=item["name"],
            sample_count=item["sample_count"],
            created_at=item.get("created_at", ""),
        )
        for idx, item in enumerate(summary)
    ]


@router.get("/faces/grouped")
def list_faces_grouped():
    """获取按姓名分组的人脸列表（含图片路径和边界框）"""
    return get_faces_grouped_by_name()


@router.delete("/tag/{tag_id}", response_model=StatusResponse)
def remove_tag(tag_id: int):
    """删除标注"""
    success = delete_tag(tag_id)
    engine.invalidate_cache()
    return StatusResponse(
        success=success,
        message="删除成功" if success else "未找到该标注",
    )


@router.delete("/faces/name/{name}", response_model=StatusResponse)
def remove_face_by_name(name: str):
    """删除某个姓名的所有标注"""
    count = delete_tags_by_name(name)
    engine.invalidate_cache()
    return StatusResponse(
        success=count > 0,
        message=f"已删除「{name}」的 {count} 条标注",
    )


# ─── 搜索 ───

@router.post("/search")
def search_faces(data: SearchRequest):
    """根据参考图片搜索目标目录"""
    if not data.reference_images:
        raise HTTPException(400, "请至少提供一张参考图片")

    for path in data.reference_images:
        if not os.path.isfile(path):
            raise HTTPException(400, f"参考图片不存在: {path}")

    if not os.path.isdir(data.target_dir):
        raise HTTPException(400, f"目标目录不存在: {data.target_dir}")

    try:
        result = engine.search_by_reference(
            reference_images=data.reference_images,
            target_dir=data.target_dir,
            threshold=data.threshold,
        )
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("搜索失败")
        raise HTTPException(500, f"搜索失败: {str(e)}")


@router.post("/export", response_model=StatusResponse)
def export_results(data: dict = Body(...)):
    """导出搜索结果到目录"""
    image_paths = data.get("image_paths", [])
    export_dir_name = data.get("export_dir", "search_results")

    export_path = OUTPUT_DIR / export_dir_name
    export_path.mkdir(parents=True, exist_ok=True)

    copied = 0
    for src in image_paths:
        if os.path.isfile(src):
            dst = export_path / Path(src).name
            # 避免重名
            if dst.exists():
                dst = export_path / f"{Path(src).stem}_1{Path(src).suffix}"
            shutil.copy2(src, str(dst))
            copied += 1

    return StatusResponse(
        success=True,
        message=f"已导出 {copied} 张图片到 {export_path}",
        data={"export_dir": str(export_path), "count": copied},
    )


@router.post("/export-zip")
def export_results_zip(data: dict = Body(...)):
    """导出所选图片为 zip 压缩包下载（去重后打包）"""
    image_paths = data.get("image_paths", [])

    if not image_paths:
        raise HTTPException(400, "请至少选择一张图片")

    # 1. 去重（保留首次出现的路径）
    seen = set()
    unique_paths = []
    for p in image_paths:
        p = p.replace("\\", "/")  # 统一路径格式
        if p not in seen:
            seen.add(p)
            unique_paths.append(p)

    # 2. 检查文件是否存在
    valid_paths = [p for p in unique_paths if os.path.isfile(p)]
    if not valid_paths:
        raise HTTPException(400, "所选图片均不存在于磁盘")

    # 3. 打包为 zip（内存中）
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for src in valid_paths:
            arcname = Path(src).name
            # 避免 zip 内文件名重复
            if arcname in zf.namelist():
                stem = Path(arcname).stem
                suffix = Path(arcname).suffix
                counter = 1
                while f"{stem}_{counter}{suffix}" in zf.namelist():
                    counter += 1
                arcname = f"{stem}_{counter}{suffix}"
            zf.write(src, arcname)

    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="search_results_{Path(valid_paths[0]).parent.name}.zip"',
            "Content-Length": str(buf.getbuffer().nbytes),
        },
    )


# ─── 配置管理 ───

@router.get("/config")
def get_config_api():
    """获取所有配置"""
    config = get_all_config()
    # 合并默认值
    for key, default_val in DEFAULT_CONFIG.items():
        if key not in config:
            config[key] = default_val
    return config


@router.post("/config", response_model=StatusResponse)
def update_config(data: ConfigUpdate):
    """更新配置"""
    if data.key not in DEFAULT_CONFIG:
        raise HTTPException(400, f"未知配置项: {data.key}")

    set_config(data.key, data.value)

    # 如果修改了阈值，清理缓存
    if data.key == "match_threshold":
        engine.invalidate_cache()

    return StatusResponse(
        success=True,
        message=f"配置已更新: {data.key} = {data.value}",
    )


# ─── 镜像源管理 ───

@router.get("/mirrors")
def list_mirrors():
    """获取可用镜像源列表"""
    mirrors = get_available_mirrors()
    current = get_current_mirror_info()
    return {
        "mirrors": mirrors,
        "current": current,
    }


@router.post("/mirrors/switch", response_model=StatusResponse)
def switch_mirror(data: dict = Body(...)):
    """切换镜像源"""
    mirror_key = data.get("mirror_key", "github")
    reload_model = data.get("reload_model", True)

    if mirror_key not in {m["key"] for m in get_available_mirrors()}:
        raise HTTPException(400, f"不支持的镜像源: {mirror_key}")

    try:
        mirror_info = apply_mirror(mirror_key)
        set_config("mirror", mirror_key)

        # 可选：重新加载模型使镜像生效
        if reload_model and engine._model is not None:
            device = get_config("device", DEFAULT_CONFIG["device"])
            model_key = get_config("current_model", DEFAULT_CONFIG["current_model"])
            engine.load_model(model_key, device=device)

        return StatusResponse(
            success=True,
            message=f"镜像源已切换至: {mirror_info['name']}",
            data=mirror_info,
        )
    except Exception as e:
        raise HTTPException(500, f"镜像源切换失败: {str(e)}")


# ─── 模型目录管理 ───

@router.get("/model-dir")
def get_model_dir_api():
    """获取当前模型存储目录"""
    return {
        "current_dir": get_model_dir(),
    }


@router.post("/model-dir", response_model=StatusResponse)
def set_model_dir_api(data: dict = Body(...)):
    """设置模型存储目录"""
    new_dir = data.get("dir", "")
    if not new_dir:
        raise HTTPException(400, "目录路径不能为空")

    try:
        abs_path = set_model_dir(new_dir)
        set_config("model_dir", new_dir)

        return StatusResponse(
            success=True,
            message=f"模型目录已设置为: {abs_path}",
            data={"dir": abs_path},
        )
    except Exception as e:
        raise HTTPException(500, f"设置模型目录失败: {str(e)}")


# ─── 目录浏览 ───

@router.get("/browse")
def browse_directory(path: str = Query("", description="目录路径")):
    """浏览目录（用于前端选择目录）"""
    if not path or path == "":
        # 返回根目录列表
        if os.name == "nt":  # Windows
            import string
            drives = [f"{d}:\\" for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]
            return {"current": "", "items": [{"name": d, "path": d, "type": "dir"} for d in drives]}
        else:
            return {"current": "/", "items": [{"name": "/", "path": "/", "type": "dir"}]}

    path = Path(path)
    if not path.is_dir():
        raise HTTPException(400, f"不是有效目录: {path}")

    items = []
    try:
        for entry in sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if entry.name.startswith("."):
                continue
            items.append({
                "name": entry.name,
                "path": str(entry),
                "type": "dir" if entry.is_dir() else "file",
            })
    except PermissionError:
        pass

    return {
        "current": str(path),
        "parent": str(path.parent) if str(path) != str(path.parent) else None,
        "items": items,
    }