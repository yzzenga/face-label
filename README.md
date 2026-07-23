# FaceLabel — 图片人物识别与标注系统

基于开源人脸识别模型的图片人物标注与搜索工具，支持**单图多人脸检测**、**批量/分组标注姓名**、**按人物搜索照片**、**已标注人员管理**。

---

## ✨ 功能特性

| 功能 | 说明 |
|---|---|
| 🏷️ **批量标注** | 扫描目录 → 自动检测所有人脸 → 输入姓名标记 → 下次自动识别 |
| 📊 **分组扫描** | 按人脸相似度聚类分组，同一人多张图自动归组，批量标注 |
| 🔎 **人物搜索** | 上传参考照片 → 在指定目录中搜索匹配该人物的所有图片 |
| 👥 **从标注人员选取** | 从已标注人脸库中选取人员，自动使用其所有标注照片作为参考 |
| 🗂️ **已标注人员管理** | 按姓名分组展示，支持单选/多选/全选批量删除，支持更新名字 |
| 🖼️ **预览图** | 人脸缩略图预览，点击弹窗查看原图，支持循环切换 |
| ⚙️ **模型切换** | 内置多种模型，可在设置页自由切换，适应不同精度/速度需求 |
| 🌐 **镜像源切换** | 支持 GitHub 官方、ghproxy 国内加速、HF Mirror 等下载源 |
| 💻 **CPU/GPU 自适应** | 自动检测 CUDA，有 GPU 则加速，无 GPU 则 CPU 推理，无需手动配置 |
| 📂 **自定义模型目录** | 模型文件可存储到任意目录，方便管理 |

---

## 🚀 快速开始

### 环境要求

- Python 3.8+
- 可选：NVIDIA GPU + CUDA（用于加速）

### 安装

```bash
# 1. 克隆或下载项目
cd face-label

# 2. 安装依赖（CPU 环境）
pip install -r requirements.txt

# 3. 如果有 NVIDIA GPU，额外安装 GPU 加速
pip install -r requirements-gpu.txt
```

### 启动

```bash
python main.py
```

浏览器打开 **http://localhost:8000** 即可使用。

> 首次启动会自动下载人脸识别模型（约 210MB），请保持网络畅通。
> 国内用户可在启动后进入「设置 → 镜像源」切换为 ghproxy 或 HF Mirror 加速下载。

---

## 🖥️ 界面预览

### 批量标注（逐张扫描）
```
选择图片目录 → 系统自动扫描 → 展示带检测框的图片
→ 右侧列出所有人脸缩略图 → 输入姓名 → 独立保存或批量保存
→ 下次同一人出现时自动识别并预填姓名
```

### 批量标注（分组扫描）
```
选择图片目录 → 点击「📊 分组扫描」
→ 系统按人脸相似度聚类分组
→ 每组展示该人物的所有照片缩略图
→ 输入姓名 → 一键批量标注该组所有人脸
→ 支持切换「待标注」/「已标注」视图
```

### 人物搜索
```
选择参考照片（支持文件选择或从标注人员选取）
→ 选择搜索目录 → 调整匹配阈值 → 开始搜索
→ 结果按参考图片分组逐行展示
→ 参考图在第一列，匹配结果横向滚动
→ 勾选结果导出到新目录
```

### 模型设置
```
切换模型：InsightFace ArcFace / MobileFaceNet / DeepFace FaceNet512
调整阈值：严格/宽松
切换设备：自动检测 / 强制 GPU / 强制 CPU
切换镜像源：GitHub / ghproxy / HF Mirror
自定义模型目录
管理已注册人脸库（单选/多选/全选批量删除）
```

---

## 🧠 支持的模型

| 模型 | 准确率 (LFW) | 速度 | 大小 | 适用场景 |
|---|---|---|---|---|
| **InsightFace ArcFace (R100)** | 99.83% | 中等 | 210MB | 精度优先，推荐有 GPU |
| **InsightFace MobileFaceNet** | 99.68% | 快 | 15MB | 轻量快速，CPU 友好 |
| **DeepFace FaceNet512** | 99.65% | 较慢 | ~300MB | 多模型对比，MIT 许可 |

### 模型文件与镜像下载对照

| 模型 | 下载文件名 | 镜像源 | 下载地址拼接规则 |
|---|---|---|---|
| **ArcFace (R100)** | `buffalo_l.zip` | ghproxy | `https://ghproxy.com/https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip` |
| | | HF Mirror | `https://hf-mirror.com/InsightFace-REST/buffalo_l/resolve/main/buffalo_l.zip` |
| **MobileFaceNet** | `buffalo_s.zip` | ghproxy | `https://ghproxy.com/https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip` |
| | | HF Mirror | `https://hf-mirror.com/InsightFace-REST/buffalo_l/resolve/main/buffalo_s.zip` |
| **FaceNet512** | 自动下载 | DeepFace | 首次使用模型时自动从 DeepFace 官方源下载（约 300MB） |

> **说明：** 模型文件由 insightface 库自动拼接 `镜像源 base_url + /{pack_name}.zip` 进行下载。HF Mirror 镜像仅托管 InsightFace REST 系列的 buffalo_l 模型包，下载 MobileFaceNet 时请切换至 ghproxy 镜像源。

---

## 🌐 模型下载镜像源

| 镜像源 | 下载地址 | 适用地区 |
|---|---|---|
| GitHub (官方) | `github.com/deepinsight/insightface/releases` | 全球（国内可能较慢） |
| ghproxy (国内加速) | `ghproxy.com` 代理加速 | 🇨🇳 国内推荐 |
| HF Mirror (国内镜像) | `hf-mirror.com` | 🇨🇳 国内备选 |

镜像源可在「设置 → 模型下载镜像源」中切换，切换后需重新加载模型。

---

## 📁 项目结构

```
face-label/
├── main.py                  # 入口：FastAPI 服务
├── config.py                # 全局配置
├── requirements.txt         # CPU 依赖
├── requirements-gpu.txt     # GPU 额外依赖
├── .gitignore
│
├── backend/
│   ├── database.py          # SQLite 数据库
│   ├── face_engine.py       # 人脸识别引擎（检测/识别/搜索/分组）
│   ├── router.py            # REST API 路由（16+ 接口）
│   ├── schemas.py           # Pydantic 数据模型
│   └── models/
│       ├── base.py          # 模型抽象基类 + 注册表
│       ├── downloader.py    # 模型下载管理器（镜像源/目录）
│       ├── insightface_model.py  # InsightFace 封装（ArcFace/MobileFaceNet）
│       └── deepface_model.py     # DeepFace 封装（FaceNet512）
│
├── frontend/
│   ├── index.html           # 单页应用
│   ├── css/style.css        # 样式
│   └── js/
│       ├── app.js           # 主逻辑（API 封装、弹窗、选项卡切换）
│       ├── batch-tag.js     # 批量标注模块（逐张/分组扫描、人脸列表）
│       ├── search.js        # 人物搜索模块
│       └── settings.js      # 设置模块（模型、镜像源、人脸库管理）
│
├── data/                    # 运行时数据（自动创建，不提交到 git）
│   ├── tags.db              # 标注数据库（SQLite）
│   └── face_db/             # 人脸特征文件
│
└── output/                  # 搜索结果导出目录（不提交到 git）
```

---

## 📡 API 接口

| 方法 | 端点 | 说明 |
|---|---|---|
| `GET` | `/api/scan?dir=xxx` | 扫描目录，逐张检测并识别人脸 |
| `GET` | `/api/scan-grouped?dir=xxx` | 扫描目录，按人脸相似度分组检测 |
| `POST` | `/api/tag-with-embedding` | 标注人脸（含特征向量） |
| `GET` | `/api/faces/known` | 获取已注册人脸库摘要 |
| `GET` | `/api/faces/grouped` | 获取按姓名分组的人脸列表（含图片路径和边框） |
| `DELETE` | `/api/faces/name/{name}` | 删除某人的所有标注 |
| `POST` | `/api/search` | 根据参考照片搜索（按参考图片分组返回） |
| `POST` | `/api/export` | 导出搜索结果 |
| `GET` | `/api/face-thumbnail` | 获取裁剪的人脸缩略图 |
| `GET` | `/api/preview/{path}` | 获取原始图片 |
| `GET` | `/api/models` | 获取可用模型列表 |
| `POST` | `/api/models/switch` | 切换模型 |
| `GET` | `/api/mirrors` | 获取镜像源列表 |
| `POST` | `/api/mirrors/switch` | 切换镜像源 |
| `GET` | `/api/model-dir` | 获取模型目录 |
| `POST` | `/api/model-dir` | 设置模型目录 |
| `GET` | `/api/config` | 获取配置 |
| `POST` | `/api/config` | 更新配置 |
| `GET` | `/api/browse` | 浏览目录（前端文件选择器） |
| `GET` | `/health` | 健康检查 |

---

## 🛠️ 技术栈

| 层级 | 技术 |
|---|---|
| 后端框架 | FastAPI (Python) |
| 前端 | 纯 HTML + CSS + JavaScript（无框架，单页应用） |
| 人脸检测 | SCRFD (InsightFace) |
| 人脸识别 | ArcFace / MobileFaceNet / FaceNet512 |
| 数据库 | SQLite（标签 + 配置） |
| 推理引擎 | ONNX Runtime（CPU）/ ONNX Runtime GPU |

---

## 💡 常见问题

**Q: 启动后无法访问 http://localhost:8000？**
A: 确认终端没有报错，检查端口是否被占用，可修改 `main.py` 中的 `port` 参数。

**Q: 模型下载失败？**
A: 进入「设置 → 模型下载镜像源」，切换为 ghproxy 或 HF Mirror 重试。

**Q: 识别准确率不高？**
A: 尝试在「设置」中降低匹配阈值，或切换到 InsightFace ArcFace 模型。

**Q: 如何批量标注大量图片？**
A: 两种方式：① 逐张扫描：逐张浏览标注；② 分组扫描：自动聚类分组，一次性批量标注整组。

**Q: 中文文件名图片无法读取？**
A: 系统已修复 Windows 下 OpenCV 不支持中文路径的问题，现在支持中文文件名。

**Q: 标注数据会随 git 提交吗？**
A: 不会。`data/` 和 `output/` 目录已配置在 `.gitignore` 中，标注数据仅保存在本地。

---

## 📄 许可证

本项目基于 MIT 许可证开源。

> **注意**: InsightFace 官方预训练模型（buffalo_l / buffalo_s）标注为非商业科研用途。
> 如需商用，建议使用 MIT 许可的替代模型（如 DeepFace FaceNet512）或自行训练。