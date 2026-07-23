"""SQLite 数据库操作"""

import sqlite3
import json
import numpy as np
from typing import Optional, List, Tuple
from datetime import datetime
from pathlib import Path

from config import DB_PATH


def get_connection() -> sqlite3.Connection:
    """获取数据库连接"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    """初始化数据库表"""
    conn = get_connection()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                image_path TEXT NOT NULL,
                face_index INTEGER NOT NULL,
                bbox_x1 REAL,
                bbox_y1 REAL,
                bbox_x2 REAL,
                bbox_y2 REAL,
                name TEXT NOT NULL,
                embedding BLOB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
            CREATE INDEX IF NOT EXISTS idx_tags_image ON tags(image_path);
        """)
        conn.commit()
    finally:
        conn.close()


# ─── 标签操作 ───

def save_tag(image_path: str, face_index: int, bbox: dict, name: str,
             embedding: Optional[np.ndarray] = None) -> int:
    """保存一条标注记录"""
    conn = get_connection()
    try:
        emb_bytes = embedding.tobytes() if embedding is not None else None
        cur = conn.execute(
            """INSERT INTO tags (image_path, face_index, bbox_x1, bbox_y1, bbox_x2, bbox_y2, name, embedding)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (image_path, face_index, bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"], name, emb_bytes)
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def get_tags_by_image(image_path: str) -> List[dict]:
    """获取某张图片的所有标注"""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM tags WHERE image_path = ? ORDER BY face_index",
            (image_path,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_all_known_names() -> List[str]:
    """获取所有已标注的姓名列表"""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT DISTINCT name FROM tags ORDER BY name"
        ).fetchall()
        return [r["name"] for r in rows]
    finally:
        conn.close()


def get_known_faces(name: str) -> List[dict]:
    """获取某个姓名的所有人脸记录"""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM tags WHERE name = ? ORDER BY created_at DESC",
            (name,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_face_embeddings_by_name(name: str) -> List[np.ndarray]:
    """获取某个姓名对应的所有特征向量"""
    rows = get_known_faces(name)
    embeddings = []
    for r in rows:
        if r["embedding"]:
            emb = np.frombuffer(r["embedding"], dtype=np.float32)
            embeddings.append(emb)
    return embeddings


def get_all_face_embeddings() -> List[Tuple[str, np.ndarray]]:
    """获取所有已标注的人脸特征（姓名, 向量）"""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT name, embedding FROM tags WHERE embedding IS NOT NULL"
        ).fetchall()
        results = []
        for r in rows:
            emb = np.frombuffer(r["embedding"], dtype=np.float32)
            results.append((r["name"], emb))
        return results
    finally:
        conn.close()


def delete_tag(tag_id: int) -> bool:
    """删除标注"""
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_tags_by_name(name: str) -> int:
    """删除某个姓名的所有标注"""
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM tags WHERE name = ?", (name,))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


# ─── 配置操作 ───

def get_config(key: str, default: Optional[str] = None) -> Optional[str]:
    """获取配置项"""
    conn = get_connection()
    try:
        row = conn.execute("SELECT value FROM config WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default
    finally:
        conn.close()


def set_config(key: str, value: str):
    """设置配置项"""
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
            (key, value, value)
        )
        conn.commit()
    finally:
        conn.close()


def get_all_config() -> dict:
    """获取所有配置"""
    conn = get_connection()
    try:
        rows = conn.execute("SELECT key, value FROM config").fetchall()
        return {r["key"]: r["value"] for r in rows}
    finally:
        conn.close()


def get_known_faces_summary() -> List[dict]:
    """获取人脸库摘要（姓名 + 样本数）"""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT name, COUNT(*) as sample_count,
                      MIN(created_at) as created_at
               FROM tags
               GROUP BY name
               ORDER BY name"""
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_faces_grouped_by_name() -> List[dict]:
    """获取按姓名分组的人脸列表（含图片路径和边界框）"""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT name, image_path, face_index,
                      bbox_x1, bbox_y1, bbox_x2, bbox_y2,
                      created_at
               FROM tags
               ORDER BY name, created_at DESC"""
        ).fetchall()
        # 按姓名分组
        groups = {}
        for r in rows:
            name = r["name"]
            if name not in groups:
                groups[name] = {
                    "name": name,
                    "sample_count": 0,
                    "faces": [],
                }
            groups[name]["sample_count"] += 1
            groups[name]["faces"].append({
                "image_path": r["image_path"],
                "face_index": r["face_index"],
                "bbox": {
                    "x1": r["bbox_x1"],
                    "y1": r["bbox_y1"],
                    "x2": r["bbox_x2"],
                    "y2": r["bbox_y2"],
                },
                "created_at": str(r["created_at"]) if r["created_at"] else "",
            })
        return list(groups.values())
    finally:
        conn.close()