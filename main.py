"""FaceLabel - 图片人物识别与标注系统
启动入口: uvicorn main:app --reload
"""

import os
import sys
import logging
from pathlib import Path

# 确保项目根目录在 sys.path 中
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import uvicorn

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# 初始化数据库
from backend.database import init_db
init_db()
logger.info("数据库初始化完成")

# 创建 FastAPI 应用
app = FastAPI(
    title="FaceLabel - 图片人物识别与标注系统",
    description="基于开源人脸识别模型的图片人物标注与搜索工具",
    version="1.0.0",
)

# 注册 API 路由
from backend.router import router
app.include_router(router)

# 挂载前端静态文件
frontend_dir = Path(__file__).parent / "frontend"
if frontend_dir.is_dir():
    # 添加缓存控制中间件，防止浏览器缓存旧的前端文件
    @app.middleware("http")
    async def add_cache_control(request, call_next):
        response = await call_next(request)
        path = request.url.path
        # 对 HTML 和 JS/CSS 文件禁用缓存
        if path == "/" or path.endswith(".html") or path.endswith(".js") or path.endswith(".css"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

    app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="frontend")

    @app.get("/")
    def index():
        return FileResponse(str(frontend_dir / "index.html"))
else:
    logger.warning(f"前端目录不存在: {frontend_dir}")

# 启动时自动加载模型
from backend.face_engine import engine
from backend.database import get_config
from config import DEFAULT_CONFIG


@app.on_event("startup")
async def startup():
    # 从数据库读取配置，优先使用用户保存的设备设置
    model_key = get_config("current_model", DEFAULT_CONFIG["current_model"])
    device = get_config("device", DEFAULT_CONFIG["device"])

    logger.info(f"启动配置: model={model_key}, device={device}")
    # 不再自动加载模型（改为由用户在前端手动点击「应用模型」触发）
    # 避免首次启动时因大模型下载阻塞服务器
    logger.info("模型将在用户点击「应用模型」后加载")
    # 输出运行时信息
    logger.info(f"ONNX Runtime 模式: {device}")
    if device == "cpu":
        logger.info("💡 提示: 如果有 NVIDIA GPU，可安装 onnxruntime-gpu 获得加速")
        logger.info("   pip install onnxruntime-gpu")


@app.on_event("shutdown")
async def shutdown():
    engine.unload_model()
    logger.info("模型已卸载，服务关闭")


@app.get("/health")
def health():
    """健康检查"""
    model_info = engine.get_model_info()
    return {
        "status": "ok",
        "model_loaded": model_info["is_active"],
        "model_name": model_info["name"],
    }


if __name__ == "__main__":
    print("""
    ╔══════════════════════════════════════════════╗
    ║         FaceLabel 图片人物识别系统            ║
    ║                                              ║
    ║  启动后请访问: http://localhost:8000           ║
    ║                                              ║
    ║  功能:                                       ║
    ║  ① 批量标注 - 检测图片中的人物并标记姓名       ║
    ║  ② 人物搜索 - 根据照片搜索匹配的图片           ║
    ║  ③ 模型切换 - 选择不同的人脸识别模型           ║
    ╚══════════════════════════════════════════════╝
    """)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)