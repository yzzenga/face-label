"""Pydantic 数据模型"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class BBox(BaseModel):
    """人脸边界框"""
    x1: float
    y1: float
    x2: float
    y2: float


class DetectedFace(BaseModel):
    """检测到的人脸"""
    face_index: int
    bbox: BBox
    confidence: float
    # 识别结果（如果是已知人脸）
    predicted_name: Optional[str] = None
    predicted_score: Optional[float] = None


class ScannedImage(BaseModel):
    """扫描到的图片及其人脸"""
    image_path: str
    image_name: str
    width: int
    height: int
    faces: List[DetectedFace]


class ScanResult(BaseModel):
    """扫描目录结果"""
    total_images: int
    total_faces: int
    images: List[ScannedImage]


class TagRequest(BaseModel):
    """标注请求"""
    image_path: str
    face_index: int
    name: str
    bbox: BBox


class TagResponse(BaseModel):
    """标注响应"""
    id: int
    image_path: str
    face_index: int
    name: str
    success: bool
    message: str


class KnownFace(BaseModel):
    """已知人脸库条目"""
    id: int
    name: str
    sample_count: int
    created_at: str


class SearchRequest(BaseModel):
    """搜索请求"""
    reference_images: List[str] = Field(..., description="参考图片路径列表")
    target_dir: str = Field(..., description="待搜索目录")
    threshold: float = Field(default=0.55, ge=0.1, le=1.0)


class SearchMatch(BaseModel):
    """搜索结果中的匹配项"""
    image_path: str
    image_name: str
    matched_faces: List[dict]  # 每个人脸的匹配信息
    similarity: float


class SearchResult(BaseModel):
    """搜索结果"""
    total_scanned: int
    total_matches: int
    matches: List[SearchMatch]


class ModelInfo(BaseModel):
    """模型信息"""
    key: str
    name: str
    description: str
    accuracy: str
    model_size: str
    speed: str
    is_active: bool


class ConfigUpdate(BaseModel):
    """配置更新"""
    key: str
    value: str


class StatusResponse(BaseModel):
    """通用状态响应"""
    success: bool
    message: str
    data: Optional[dict] = None