/* ============================================================
   FaceLabel - 批量标注模块
   ============================================================ */

// ─── 状态 ───
let scanData = [];            // 扫描结果 [{image_path, image_name, width, height, faces}]
let currentIndex = 0;         // 当前查看的图片索引
let pendingTags = {};         // 暂存未提交的标注 {faceIndex: name}
let allTags = {};             // 已提交的标注 {faceIndex: name}

// ─── DOM 引用 ───
const scanDirInput = document.getElementById('scanDir');
const browseScanDir = document.getElementById('browseScanDir');
const startScan = document.getElementById('startScan');
const startGroupedScan = document.getElementById('startGroupedScan');
const scanProgress = document.getElementById('scanProgress');
const batchWorkspace = document.getElementById('batchWorkspace');
const batchBottomBar = document.getElementById('batchBottomBar');
const imageCounter = document.getElementById('imageCounter');
const faceCounter = document.getElementById('faceCounter');
const prevImage = document.getElementById('prevImage');
const nextImage = document.getElementById('nextImage');
const saveAllTags = document.getElementById('saveAllTags');
const skipImage = document.getElementById('skipImage');

// ─── 初始化 ───
document.addEventListener('DOMContentLoaded', () => {
    // 浏览目录
    browseScanDir.addEventListener('click', () => {
        window.openDirModal((path) => {
            if (path) scanDirInput.value = path;
            updateScanButtons();
        });
    });

    // 输入框变化（含粘贴）→ 更新按钮状态
    scanDirInput.addEventListener('input', updateScanButtons);
    scanDirInput.addEventListener('paste', () => {
        // 粘贴后异步等待值更新再检查
        setTimeout(updateScanButtons, 50);
    });

    // 初始禁用按钮
    updateScanButtons();

    // 开始扫描
    startScan.addEventListener('click', async () => {
        const dir = scanDirInput.value.trim();
        if (!dir) {
            window.showToast('请先选择图片目录', 'warning');
            return;
        }
        await scanDirectory(dir);
    });

    // 分组扫描
    startGroupedScan.addEventListener('click', async () => {
        const dir = scanDirInput.value.trim();
        if (!dir) {
            window.showToast('请先选择图片目录', 'warning');
            return;
        }
        await scanGrouped(dir);
    });

    // 翻页
    prevImage.addEventListener('click', () => navigateImage(-1));
    nextImage.addEventListener('click', () => navigateImage(1));

    // 保存标注
    saveAllTags.addEventListener('click', saveCurrentTags);

    // 跳过
    skipImage.addEventListener('click', () => navigateImage(1));

    // 加载已标注人员列表
    loadFaceGroupList();

    // 刷新按钮
    const refreshBtn = document.getElementById('refreshFaceGroups');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadFaceGroupList();
            window.showToast('已刷新人员列表', 'success');
        });
    }
});

// ─── 路径检测：空路径时禁用扫描按钮 ───
function updateScanButtons() {
    const hasPath = scanDirInput.value.trim().length > 0;
    startScan.disabled = !hasPath;
    startGroupedScan.disabled = !hasPath;
}

// ─── 分组扫描 ───
async function scanGrouped(dir) {
    window.showLoading('正在分组扫描并识别图片中的人脸...');
    batchBottomBar.style.display = 'none';
    try {
        const result = await window.apiGet(`/scan-grouped?dir=${encodeURIComponent(dir)}`);
        scanProgress.textContent = `共 ${result.total_groups || 0} 个分组，${result.total_faces || 0} 张人脸`;

        if (!result.groups || result.groups.length === 0) {
            batchWorkspace.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <h3>未检测到人脸</h3>
                    <p>该目录下没有检测到人脸，请确认图片中包含清晰的人脸</p>
                </div>
            `;
            window.hideLoading();
            return;
        }

        renderGroupedResults(result);
    } catch (e) {
        window.showToast('分组扫描失败: ' + e.message, 'error');
        batchWorkspace.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">❌</div>
                <h3>扫描出错</h3>
                <p>${e.message}</p>
            </div>
        `;
    } finally {
        window.hideLoading();
    }
}

// ─── 渲染分组扫描结果 ───
function renderGroupedResults(result) {
    const groups = result.groups || [];
    const container = document.createElement('div');
    container.className = 'grouped-scan-container';

    // 添加标签切换
    const tabBar = document.createElement('div');
    tabBar.className = 'grouped-tab-bar';
    tabBar.innerHTML = `
        <button class="grouped-tab active" data-tab="pending">📋 待标注 (${groups.length} 组)</button>
        <button class="grouped-tab" data-tab="labeled">✅ 已标注</button>
    `;
    container.appendChild(tabBar);

    // 待标注内容区
    const pendingContent = document.createElement('div');
    pendingContent.className = 'grouped-tab-content';
    pendingContent.id = 'groupedPendingContent';

    groups.forEach((group, gIdx) => {
        const firstFace = group.faces[0];
        const coverUrl = firstFace
            ? `/api/face-thumbnail?image_path=${encodeURIComponent(firstFace.image_path)}&x1=${firstFace.bbox.x1}&y1=${firstFace.bbox.y1}&x2=${firstFace.bbox.x2}&y2=${firstFace.bbox.y2}&size=120`
            : '';

        const faceItems = group.faces.map((f, fi) => {
            const itemThumbUrl = `/api/face-thumbnail?image_path=${encodeURIComponent(f.image_path)}&x1=${f.bbox.x1}&y1=${f.bbox.y1}&x2=${f.bbox.x2}&y2=${f.bbox.y2}&size=100`;
            return `
                <div class="grouped-face-item" data-image="${encodeURIComponent(f.image_path)}" data-bbox='${JSON.stringify(f.bbox)}'>
                    <img class="grouped-face-thumb" src="${itemThumbUrl}" alt="" loading="lazy"
                         onerror="this.style.display='none'">
                    <div class="grouped-face-name" title="${f.image_name}">${f.image_name}</div>
                </div>
            `;
        }).join('');

        const groupCard = document.createElement('div');
        groupCard.className = 'grouped-group-card';
        groupCard.innerHTML = `
            <div class="grouped-group-header">
                <img class="grouped-group-cover" src="${coverUrl}" alt="" loading="lazy"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 120 120%22><rect fill=%22%23e2e8f0%22 width=%22120%22 height=%22120%22/><text x=%2260%22 y=%2268%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-size=%2236%22>👤</text></svg>'">
                <div class="grouped-group-info">
                    <div class="grouped-group-title">人物组 #${gIdx + 1}</div>
                    <div class="grouped-group-count">${group.face_count} 张人脸</div>
                </div>
                <div class="grouped-group-actions">
                    <input type="text" class="grouped-group-name-input" placeholder="输入姓名批量标注..." data-group="${gIdx}">
                    <button class="btn btn-success btn-sm grouped-group-save" data-group="${gIdx}">💾 批量标注</button>
                </div>
            </div>
            <div class="grouped-group-grid">
                ${faceItems}
            </div>
        `;
        pendingContent.appendChild(groupCard);

        // 批量标注按钮
        const saveBtn = groupCard.querySelector('.grouped-group-save');
        const nameInput = groupCard.querySelector('.grouped-group-name-input');
        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) {
                window.showToast('请输入姓名', 'warning');
                nameInput.focus();
                return;
            }
            window.showLoading(`正在批量标注「${name}」...`);
            let saved = 0;
            try {
                for (const face of group.faces) {
                    await window.apiPost('/tag-with-embedding', {
                        image_path: face.image_path,
                        face_index: face.face_index,
                        name: name,
                        bbox: face.bbox,
                        embedding: undefined,
                    });
                    saved++;
                }
                window.showToast(`已保存 ${saved} 张人脸为「${name}」`, 'success');
                loadFaceGroupList();
            } catch (e) {
                window.showToast('批量标注失败: ' + e.message, 'error');
            } finally {
                window.hideLoading();
            }
        });

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveBtn.click();
        });

        groupCard.querySelectorAll('.grouped-face-item').forEach(el => {
            el.addEventListener('click', () => {
                const imagePath = decodeURIComponent(el.dataset.image);
                const name = el.querySelector('.grouped-face-name')?.textContent || '图片预览';
                window.openPreviewModal(imagePath, name);
            });
        });
    });
    container.appendChild(pendingContent);

    // 已标注内容区（由 loadFaceGroupList 填充）
    const labeledContent = document.createElement('div');
    labeledContent.className = 'grouped-tab-content';
    labeledContent.id = 'groupedLabeledContent';
    labeledContent.style.display = 'none';
    labeledContent.innerHTML = `
        <div class="grouped-labeled-placeholder" id="groupedLabeledPlaceholder">
            <div class="empty-state" style="padding:20px;">
                <p style="font-size:13px;color:var(--text-light);">加载中...</p>
            </div>
        </div>
    `;
    container.appendChild(labeledContent);

    // 标签切换事件
    tabBar.querySelectorAll('.grouped-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            tabBar.querySelectorAll('.grouped-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabId = tab.dataset.tab;
            document.getElementById('groupedPendingContent').style.display = tabId === 'pending' ? 'block' : 'none';
            document.getElementById('groupedLabeledContent').style.display = tabId === 'labeled' ? 'block' : 'none';
            if (tabId === 'labeled') {
                // 将已标注列表渲染到此处
                loadFaceGroupListTo('groupedLabeledPlaceholder');
            }
        });
    });

    batchWorkspace.innerHTML = '';
    batchWorkspace.appendChild(container);
}

// ─── 将已标注人员列表渲染到指定容器 ───
async function loadFaceGroupListTo(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    try {
        const groups = await window.apiGet('/faces/grouped');
        if (!Array.isArray(groups) || groups.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding:20px;">
                    <p style="font-size:13px;color:var(--text-light);">暂无已标注人员</p>
                </div>
            `;
            return;
        }
        container.innerHTML = '';
        groups.forEach((group, idx) => {
            const firstFace = group.faces && group.faces[0];
            const thumbUrl = firstFace
                ? `/api/face-thumbnail?image_path=${encodeURIComponent(firstFace.image_path)}&x1=${firstFace.bbox.x1}&y1=${firstFace.bbox.y1}&x2=${firstFace.bbox.x2}&y2=${firstFace.bbox.y2}&size=60`
                : '';
            const faceItems = group.faces.map((f, fi) => {
                const itemThumbUrl = `/api/face-thumbnail?image_path=${encodeURIComponent(f.image_path)}&x1=${f.bbox.x1}&y1=${f.bbox.y1}&x2=${f.bbox.x2}&y2=${f.bbox.y2}&size=40`;
                return `
                    <div class="face-group-item">
                        <img class="face-group-item-thumb" src="${itemThumbUrl}" alt="" loading="lazy"
                             onerror="this.style.display='none'">
                        <span class="face-group-item-path" title="${f.image_path}">
                            ${f.image_path.split(/[\\/]/).pop()}
                        </span>
                        <span class="face-group-item-time">${f.created_at ? f.created_at.slice(0, 10) : ''}</span>
                    </div>
                `;
            }).join('');
            const card = document.createElement('div');
            card.className = 'face-group-card';
            card.innerHTML = `
                <div class="face-group-header" data-group="${idx}">
                    <img class="face-group-thumb" src="${thumbUrl}" alt="" loading="lazy"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 60%22><rect fill=%22%23e2e8f0%22 width=%2260%22 height=%2260%22/><text x=%2230%22 y=%2236%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-size=%2220%22>👤</text></svg>'">
                    <span class="face-group-name">${group.name}</span>
                    <span class="face-group-count" style="cursor:pointer;" title="点击修改名字">✏️ ${group.sample_count} 张</span>
                    <span class="face-group-toggle">▶</span>
                </div>
                <div class="face-group-body" id="labeledGroupBody_${idx}" style="display:none;">
                    ${faceItems}
                </div>
            `;
            container.appendChild(card);

            // 点击展开/收起
            const header = card.querySelector('.face-group-header');
            header.addEventListener('click', (e) => {
                if (e.target.closest('.face-group-count')) {
                    // 点击计数区域：修改名字
                    const newName = prompt('输入新名字:', group.name);
                    if (newName && newName.trim() !== group.name) {
                        // 先删除旧名字的所有标注，再重新保存
                        // 简化：直接调用API重命名
                        window.showToast('重命名功能开发中，请先删除后重新标注', 'info');
                    }
                    return;
                }
                const body = document.getElementById(`labeledGroupBody_${idx}`);
                const toggle = header.querySelector('.face-group-toggle');
                const isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : 'block';
                toggle.textContent = isOpen ? '▶' : '▼';
            });
        });
    } catch (e) {
        container.innerHTML = `<div class="empty-state" style="padding:20px;"><p style="font-size:13px;color:var(--text-light);">加载失败: ${e.message}</p></div>`;
    }
}
async function scanDirectory(dir) {
    window.showLoading('正在扫描并识别图片中的人脸...');
    try {
        const result = await window.apiGet(`/scan?dir=${encodeURIComponent(dir)}`);
        scanData = result.images || [];
        currentIndex = 0;
        pendingTags = {};
        allTags = {};

        scanProgress.textContent = `共 ${result.total_images} 张图片，检测到 ${result.total_faces} 张人脸`;

        if (scanData.length === 0) {
            batchWorkspace.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <h3>未找到图片</h3>
                    <p>该目录下没有支持的图片格式（jpg/png/webp/bmp）</p>
                </div>
            `;
            batchBottomBar.style.display = 'none';
            window.hideLoading();
            return;
        }

        batchBottomBar.style.display = 'flex';
        renderCurrentImage();
    } catch (e) {
        window.showToast('扫描失败: ' + e.message, 'error');
        batchWorkspace.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">❌</div>
                <h3>扫描出错</h3>
                <p>${e.message}</p>
            </div>
        `;
    } finally {
        window.hideLoading();
    }
}

// ─── 渲染当前图片 ───
function renderCurrentImage() {
    if (scanData.length === 0) return;
    const item = scanData[currentIndex];
    imageCounter.textContent = `第 ${currentIndex + 1} / ${scanData.length} 张`;
    faceCounter.textContent = `共检测到 ${item.faces.length} 张人脸`;
    const countEl = document.getElementById('sidebarCurrentCount');
    if (countEl) countEl.textContent = `${item.faces.length} 张`;

    // 构建工作区（仅图片预览）
    const layout = document.createElement('div');
    layout.className = 'batch-layout';

    // 左侧：图片预览
    const imagePanel = document.createElement('div');
    imagePanel.className = 'batch-image-panel';
    imagePanel.id = 'batchImagePanel';

    const img = document.createElement('img');
    img.src = `/api/preview/${encodeURIComponent(item.image_path)}`;
    img.alt = item.image_name;
    imagePanel.appendChild(img);

    // 用 canvas 绘制人脸框
    const canvas = document.createElement('canvas');
    canvas.id = 'batchCanvas';
    imagePanel.appendChild(canvas);

    layout.appendChild(imagePanel);

    batchWorkspace.innerHTML = '';
    batchWorkspace.appendChild(layout);

    // 在图片加载完成后绘制人脸框
    img.onload = () => drawFaceBoxes(img, canvas, item.faces);

    // 渲染人脸卡片（到静态侧边栏）
    renderFaceCards(item);
}

// ─── 在图片上绘制人脸框 ───
function drawFaceBoxes(img, canvas, faces) {
    const rect = img.getBoundingClientRect();
    const panel = document.getElementById('batchImagePanel');
    const panelRect = panel.getBoundingClientRect();

    canvas.width = panelRect.width - 32;
    canvas.height = panelRect.height - 32;
    canvas.style.width = (panelRect.width - 32) + 'px';
    canvas.style.height = (panelRect.height - 32) + 'px';

    const ctx = canvas.getContext('2d');
    const scaleX = canvas.width / img.naturalWidth;
    const scaleY = canvas.height / img.naturalHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const colors = ['#4f6ef7', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

    faces.forEach((face, idx) => {
        const color = colors[idx % colors.length];
        const x = face.bbox.x1 * scaleX;
        const y = face.bbox.y1 * scaleY;
        const w = (face.bbox.x2 - face.bbox.x1) * scaleX;
        const h = (face.bbox.y2 - face.bbox.y1) * scaleY;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // 标签背景
        const label = face.predicted_name || `人脸${face.face_index + 1}`;
        ctx.fillStyle = color;
        const labelWidth = ctx.measureText(label).width + 16;
        if (labelWidth > 0) {
            ctx.fillRect(x, y - 24, Math.min(labelWidth, w + 8), 22);
            ctx.fillStyle = '#fff';
            ctx.font = '12px sans-serif';
            ctx.fillText(label, x + 8, y - 8);
        }

        // 序号
        ctx.fillStyle = color;
        const numSize = 20;
        ctx.beginPath();
        ctx.arc(x + numSize/2, y + numSize/2, numSize/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(face.face_index + 1, x + numSize/2, y + numSize/2);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    });
}

// ─── 渲染人脸卡片 ───
function renderFaceCards(item) {
    const list = document.getElementById('batchFaceList');
    if (!list) return;

    list.innerHTML = '';
    const threshold = parseFloat(window.AppState.config.match_threshold || 0.55);

    item.faces.forEach((face) => {
        const card = document.createElement('div');
        const hasMatch = face.predicted_name && face.predicted_score >= threshold;
        const isNew = !face.predicted_name;
        const isUnmatched = face.predicted_name && face.predicted_score < threshold;

        let badgeClass = 'badge-new';
        let badgeText = '新人物';
        let statusClass = 'new';

        if (hasMatch) {
            badgeClass = 'badge-matched';
            badgeText = `已匹配 (${(face.predicted_score * 100).toFixed(0)}%)`;
            statusClass = 'matched';
        } else if (isUnmatched) {
            badgeClass = 'badge-unmatched';
            badgeText = `低置信度 (${(face.predicted_score * 100).toFixed(0)}%)`;
            statusClass = 'unmatched';
        }

        card.className = `face-card ${statusClass}`;
        card.innerHTML = `
            <div class="face-thumb" style="background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:20px;color:#94a3b8;">
                👤
            </div>
            <div class="face-card-info">
                <div class="face-card-label">
                    <span class="face-card-badge ${badgeClass}">${badgeText}</span>
                </div>
                <input type="text" class="face-card-name-input" 
                       placeholder="输入姓名..."
                       value="${face.predicted_name || ''}"
                       data-face-index="${face.face_index}">
                <div class="face-card-conf">
                    置信度: ${(face.confidence * 100).toFixed(1)}%
                    ${face.face_index >= 0 ? `| 人脸 #${face.face_index + 1}` : ''}
                </div>
                <button class="btn btn-success btn-sm face-save-btn" data-face-index="${face.face_index}" style="margin-top:6px;width:100%;">
                    💾 保存此标注
                </button>
            </div>
        `;

        list.appendChild(card);

        // 输入事件
        const input = card.querySelector('.face-card-name-input');
        input.addEventListener('input', () => {
            const name = input.value.trim();
            if (name) {
                pendingTags[face.face_index] = name;
            } else {
                delete pendingTags[face.face_index];
            }
        });

        // 独立保存按钮
        const saveBtn = card.querySelector('.face-save-btn');
        saveBtn.addEventListener('click', async () => {
            const name = input.value.trim();
            if (!name) {
                window.showToast('请先输入姓名', 'warning');
                input.focus();
                return;
            }
            pendingTags[face.face_index] = name;
            await saveSingleFace(item, face.face_index, name);
        });
    });
}

// ─── 导航 ───
function navigateImage(delta) {
    const newIndex = currentIndex + delta;
    if (newIndex < 0 || newIndex >= scanData.length) {
        window.showToast(scanData.length === 0 ? '没有更多图片' :
            (newIndex < 0 ? '已是第一张' : '已是最后一张'), 'info');
        return;
    }
    currentIndex = newIndex;
    renderCurrentImage();
}

// ─── 加载已标注人员列表（按姓名分组） ───
async function loadFaceGroupList() {
    const listEl = document.getElementById('batchFaceGroupList');
    const countEl = document.getElementById('faceGroupCount');
    if (!listEl || !countEl) return;

    try {
        const groups = await window.apiGet('/faces/grouped');
        if (!Array.isArray(groups) || groups.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state" style="padding:20px;">
                    <p style="font-size:13px;color:var(--text-light);">暂无标注人员，请先进行批量标注</p>
                </div>
            `;
            countEl.textContent = '';
            return;
        }

        countEl.textContent = `共 ${groups.length} 人`;

        // 先渲染批量删除工具栏（如果有多人）
        let batchHtml = '';
        if (groups.length > 1) {
            batchHtml = `
                <div class="face-group-batch-bar" id="batchDeleteBar">
                    <label class="batch-checkbox-label">
                        <input type="checkbox" id="selectAllGroups"> 全选
                    </label>
                    <button class="btn btn-sm btn-danger" id="batchDeleteBtn" disabled>🗑️ 批量删除</button>
                </div>
            `;
        }

        listEl.innerHTML = batchHtml;
        groups.forEach((group, idx) => {
            // 取第一张脸的 bbox 作为组头像
            const firstFace = group.faces && group.faces[0];
            const thumbUrl = firstFace
                ? `/api/face-thumbnail?image_path=${encodeURIComponent(firstFace.image_path)}&x1=${firstFace.bbox.x1}&y1=${firstFace.bbox.y1}&x2=${firstFace.bbox.x2}&y2=${firstFace.bbox.y2}&size=60`
                : '';

            // 为每个子项生成缩略图 URL
            const faceItems = group.faces.map((f, fi) => {
                const itemThumbUrl = `/api/face-thumbnail?image_path=${encodeURIComponent(f.image_path)}&x1=${f.bbox.x1}&y1=${f.bbox.y1}&x2=${f.bbox.x2}&y2=${f.bbox.y2}&size=40`;
                return `
                    <div class="face-group-item">
                        <img class="face-group-item-thumb" src="${itemThumbUrl}" alt="" loading="lazy"
                             onerror="this.style.display='none'">
                        <span class="face-group-item-path" title="${f.image_path}">
                            ${f.image_path.split(/[\\/]/).pop()}
                        </span>
                        <span class="face-group-item-time">${f.created_at ? f.created_at.slice(0, 10) : ''}</span>
                    </div>
                `;
            }).join('');

            const card = document.createElement('div');
            card.className = 'face-group-card';
            card.dataset.name = group.name;
            card.innerHTML = `
                <div class="face-group-header" data-group="${idx}">
                    <input type="checkbox" class="group-select-cb" data-name="${group.name}" style="margin:0;flex-shrink:0;">
                    <img class="face-group-thumb" src="${thumbUrl}" alt="" loading="lazy"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 60%22><rect fill=%22%23e2e8f0%22 width=%2260%22 height=%2260%22/><text x=%2230%22 y=%2236%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-size=%2220%22>👤</text></svg>'">
                    <span class="face-group-name">${group.name}</span>
                    <span class="face-group-count">${group.sample_count} 张</span>
                    <button class="btn btn-sm btn-danger face-group-del-btn" data-name="${group.name}" title="删除此人员">🗑️</button>
                    <span class="face-group-toggle">▶</span>
                </div>
                <div class="face-group-body" id="faceGroupBody_${idx}" style="display:none;">
                    ${faceItems}
                </div>
            `;
            listEl.appendChild(card);

            // 点击展开/收起（排除删除按钮和复选框的点击）
            const header = card.querySelector('.face-group-header');
            header.addEventListener('click', (e) => {
                if (e.target.closest('.face-group-del-btn')) return;
                if (e.target.closest('.group-select-cb')) return;
                const body = document.getElementById(`faceGroupBody_${idx}`);
                const toggle = header.querySelector('.face-group-toggle');
                const isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : 'block';
                toggle.textContent = isOpen ? '▶' : '▼';
            });

            // 复选框选中状态变化时更新批量删除按钮
            const cb = card.querySelector('.group-select-cb');
            cb.addEventListener('change', () => {
                updateBatchDeleteBar();
            });

            // 单个删除按钮
            const delBtn = card.querySelector('.face-group-del-btn');
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const name = delBtn.dataset.name;
                if (!confirm(`确定要删除「${name}」的所有标注吗？`)) return;
                try {
                    await window.apiDelete(`/faces/name/${encodeURIComponent(name)}`);
                    window.showToast(`已删除「${name}」`, 'success');
                    loadFaceGroupList();
                } catch (e) {
                    window.showToast('删除失败: ' + e.message, 'error');
                }
            });
        });

        // 初始化批量删除工具栏
        updateBatchDeleteBar();
    } catch (e) {
        console.warn('加载已标注人员列表失败:', e);
        listEl.innerHTML = `
            <div class="empty-state" style="padding:20px;">
                <p style="font-size:13px;color:var(--text-light);">加载失败: ${e.message}</p>
            </div>
        `;
    }
}

// ─── 更新批量删除工具栏状态 ───
function updateBatchDeleteBar() {
    const selectAllCb = document.getElementById('selectAllGroups');
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    if (!selectAllCb || !batchDeleteBtn) return;

    const allCbs = document.querySelectorAll('.group-select-cb');
    const checkedCbs = document.querySelectorAll('.group-select-cb:checked');

    // 更新全选状态
    if (allCbs.length > 0) {
        selectAllCb.checked = checkedCbs.length === allCbs.length;
        selectAllCb.indeterminate = checkedCbs.length > 0 && checkedCbs.length < allCbs.length;
    }

    // 更新批量删除按钮
    batchDeleteBtn.disabled = checkedCbs.length === 0;
    batchDeleteBtn.textContent = checkedCbs.length > 0
        ? `🗑️ 批量删除 (${checkedCbs.length})`
        : '🗑️ 批量删除';

    // 全选事件（只绑定一次）
    selectAllCb.onchange = () => {
        document.querySelectorAll('.group-select-cb').forEach(cb => {
            cb.checked = selectAllCb.checked;
        });
        updateBatchDeleteBar();
    };

    // 批量删除事件（只绑定一次）
    batchDeleteBtn.onclick = async () => {
        const selected = [...document.querySelectorAll('.group-select-cb:checked')].map(cb => cb.dataset.name);
        if (selected.length === 0) {
            window.showToast('请先选择要删除的人员', 'warning');
            return;
        }
        if (!confirm(`确定要删除选中 ${selected.length} 位人员的所有标注吗？\n\n${selected.join('、')}`)) return;
        window.showLoading(`正在删除 ${selected.length} 位人员...`);
        let deleted = 0;
        try {
            for (const name of selected) {
                await window.apiDelete(`/faces/name/${encodeURIComponent(name)}`);
                deleted++;
            }
            window.showToast(`已删除 ${deleted} 位人员`, 'success');
            loadFaceGroupList();
        } catch (e) {
            window.showToast('批量删除失败: ' + e.message, 'error');
        } finally {
            window.hideLoading();
        }
    };
}

async function saveCurrentTags() {
    const item = scanData[currentIndex];
    const inputs = document.querySelectorAll('.face-card-name-input');
    const tagsToSave = [];

    inputs.forEach(input => {
        const name = input.value.trim();
        const faceIndex = parseInt(input.dataset.faceIndex);
        if (name && !isNaN(faceIndex)) {
            const face = item.faces.find(f => f.face_index === faceIndex);
            if (face) {
                tagsToSave.push({ faceIndex, name, bbox: face.bbox, embedding: face.embedding });
            }
        }
    });

    if (tagsToSave.length === 0) {
        window.showToast('请先输入姓名', 'warning');
        return;
    }

    window.showLoading('保存标注...');
    let saved = 0;
    try {
        for (const tag of tagsToSave) {
            await window.apiPost('/tag-with-embedding', {
                image_path: item.image_path,
                face_index: tag.faceIndex,
                name: tag.name,
                bbox: tag.bbox,
                embedding: tag.embedding,
            });
            saved++;
            allTags[tag.faceIndex] = tag.name;
        }
        window.showToast(`已保存 ${saved} 条标注`, 'success');
        // 清除已保存的暂存
        tagsToSave.forEach(t => delete pendingTags[t.faceIndex]);
        // 刷新已标注人员列表
        loadFaceGroupList();
    } catch (e) {
        window.showToast('保存失败: ' + e.message, 'error');
    } finally {
        window.hideLoading();
    }
}

// ─── 保存单个人脸标注 ───
async function saveSingleFace(item, faceIndex, name) {
    const face = item.faces.find(f => f.face_index === faceIndex);
    if (!face) {
        window.showToast('未找到人脸数据', 'error');
        return;
    }
    try {
        await window.apiPost('/tag-with-embedding', {
            image_path: item.image_path,
            face_index: faceIndex,
            name: name,
            bbox: face.bbox,
            embedding: face.embedding,
        });
        allTags[faceIndex] = name;
        delete pendingTags[faceIndex];
        window.showToast(`已标注为「${name}」`, 'success');
        // 刷新已标注人员列表
        loadFaceGroupList();
    } catch (e) {
        window.showToast('保存失败: ' + e.message, 'error');
    }
}