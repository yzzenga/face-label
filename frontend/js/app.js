/* ============================================================
   FaceLabel - 主应用逻辑
   ============================================================ */

// ─── 全局状态 ───
const AppState = {
    currentModel: null,
    config: { match_threshold: 0.55, device: 'auto' },
    knownFaces: [],
    scanResults: null,
    searchResults: null,
};

// ─── API 基础路径 ───
const API = '/api';

// ─── 工具函数 ───
async function apiGet(url) {
    const resp = await fetch(`${API}${url}`);
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    return resp.json();
}

async function apiPost(url, data) {
    const resp = await fetch(`${API}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    return resp.json();
}

async function apiDelete(url) {
    const resp = await fetch(`${API}${url}`, { method: 'DELETE' });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    return resp.json();
}

// ─── Toast 消息 ───
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ─── 加载遮罩 ───
function showLoading(text = '处理中...') {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

// ─── 模型状态更新 ───
async function updateModelStatus() {
    try {
        const info = await apiGet('/models/current');
        AppState.currentModel = info;
        const el = document.getElementById('modelStatus');
        if (info.is_active) {
            el.className = 'status-indicator active';
            el.textContent = `✓ ${info.name}`;
        } else {
            el.className = 'status-indicator error';
            el.textContent = '✗ 模型未加载';
        }
    } catch (e) {
        document.getElementById('modelStatus').className = 'status-indicator error';
        document.getElementById('modelStatus').textContent = '✗ 连接失败';
    }
}

// ─── 选项卡切换 ───
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

    // 切换到搜索tab时刷新已标注人员下拉框
    if (tabId === 'search' && typeof window.loadKnownPersons === 'function') {
        window.loadKnownPersons();
    }
}

// ─── 目录浏览模态框 ───
function openDirModal(callback, mode = 'dir') {
    const modal = document.getElementById('dirModal');
    const list = document.getElementById('modalFileList');
    const pathEl = document.getElementById('modalCurrentPath');
    modal.style.display = 'flex';
    let currentPath = '';

    async function loadDir(path) {
        showLoading('加载目录...');
        try {
            const data = await apiGet(`/browse?path=${encodeURIComponent(path)}`);
            currentPath = data.current;
            pathEl.textContent = currentPath;

            list.innerHTML = '';
            if (data.parent && data.parent !== currentPath) {
                const item = document.createElement('div');
                item.className = 'modal-file-item';
                item.innerHTML = `<span class="file-icon">📂</span><span class="file-name">..</span>`;
                item.addEventListener('click', () => loadDir(data.parent));
                list.appendChild(item);
            }

            for (const entry of data.items) {
                if (entry.type !== 'dir' && mode === 'dir') continue;
                const item = document.createElement('div');
                item.className = 'modal-file-item';
                const icon = entry.type === 'dir' ? '📁' : '🖼️';
                item.innerHTML = `
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${entry.name}</span>
                    <span class="file-type">${entry.type === 'dir' ? '目录' : '图片'}</span>
                `;
                item.addEventListener('click', () => {
                    if (entry.type === 'dir') loadDir(entry.path);
                });
                item.style.cursor = entry.type === 'dir' ? 'pointer' : 'default';
                list.appendChild(item);
            }
        } catch (e) {
            showToast('加载目录失败: ' + e.message, 'error');
        } finally {
            hideLoading();
        }
    }

    document.getElementById('dirModalConfirm').onclick = () => {
        modal.style.display = 'none';
        callback(currentPath);
    };

    document.getElementById('dirModalCancel').onclick = () => modal.style.display = 'none';
    document.getElementById('dirModalClose').onclick = () => modal.style.display = 'none';

    // 初始加载
    loadDir('');
}

// ─── 文件选择模态框（多选图片） ───
function openFileSelector(callback) {
    const modal = document.getElementById('refModal');
    const list = document.getElementById('refModalFileList');
    const pathEl = document.getElementById('refModalCurrentPath');
    modal.style.display = 'flex';
    let currentPath = '';
    const selectedFiles = new Set();

    async function loadDir(path) {
        showLoading('加载目录...');
        try {
            const data = await apiGet(`/browse?path=${encodeURIComponent(path)}`);
            currentPath = data.current;
            pathEl.textContent = currentPath;

            list.innerHTML = '';
            if (data.parent && data.parent !== currentPath) {
                const item = document.createElement('div');
                item.className = 'modal-file-item';
                item.innerHTML = `<span class="file-icon">📂</span><span class="file-name">..</span>`;
                item.addEventListener('click', () => loadDir(data.parent));
                list.appendChild(item);
            }

            for (const entry of data.items) {
                const item = document.createElement('div');
                item.className = 'modal-file-item';
                const isDir = entry.type === 'dir';
                const icon = isDir ? '📁' : '🖼️';
                const ext = entry.name.toLowerCase().split('.').pop();
                const isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext);

                item.innerHTML = `
                    ${isDir ? '' : '<input type="checkbox" class="file-checkbox" ' + (selectedFiles.has(entry.path) ? 'checked' : '') + '>'}
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${entry.name}</span>
                    <span class="file-type">${isDir ? '目录' : (isImage ? '图片' : ext)}</span>
                `;

                if (isDir) {
                    item.addEventListener('click', () => loadDir(entry.path));
                    item.style.cursor = 'pointer';
                } else if (isImage) {
                    const cb = item.querySelector('.file-checkbox');
                    item.addEventListener('click', (e) => {
                        if (e.target !== cb) cb.checked = !cb.checked;
                        if (cb.checked) selectedFiles.add(entry.path);
                        else selectedFiles.delete(entry.path);
                    });
                    cb.addEventListener('change', () => {
                        if (cb.checked) selectedFiles.add(entry.path);
                        else selectedFiles.delete(entry.path);
                    });
                }
                list.appendChild(item);
            }
        } catch (e) {
            showToast('加载目录失败: ' + e.message, 'error');
        } finally {
            hideLoading();
        }
    }

    document.getElementById('refModalConfirm').onclick = () => {
        modal.style.display = 'none';
        callback(Array.from(selectedFiles));
    };

    document.getElementById('refModalCancel').onclick = () => modal.style.display = 'none';
    document.getElementById('refModalClose').onclick = () => modal.style.display = 'none';

    loadDir('');
}

// ─── 图片预览弹窗 ───
function openPreviewModal(imagePath, name) {
    const modal = document.getElementById('previewModal');
    const img = document.getElementById('previewModalImage');
    const title = document.getElementById('previewImageName');
    if (!modal || !img) return;

    img.src = `/api/preview/${encodeURIComponent(imagePath)}`;
    if (title) title.textContent = name || '图片预览';
    modal.style.display = 'flex';
}

// ─── 参考图堆叠弹窗 ───
function openRefStackModal() {
    const files = window.selectedRefFiles || [];
    const name = window.selectedPersonName || '参考照片';
    if (files.length === 0) return;
    const modal = document.getElementById('previewModal');
    const img = document.getElementById('previewModalImage');
    const title = document.getElementById('previewImageName');
    if (!modal || !img) return;

    // 用第一张图作为预览，标题显示张数
    img.src = `/api/preview/${encodeURIComponent(files[0])}`;
    if (title) title.textContent = `${name} (共 ${files.length} 张)`;
    modal.style.display = 'flex';

    // 点击图片切换下一张
    let currentIdx = 0;
    const nextImg = () => {
        currentIdx = (currentIdx + 1) % files.length;
        img.src = `/api/preview/${encodeURIComponent(files[currentIdx])}`;
        if (title) title.textContent = `${name} (${currentIdx + 1}/${files.length})`;
    };
    img.style.cursor = 'pointer';
    img.onclick = nextImg;
}

// ─── 初始化 ───
document.addEventListener('DOMContentLoaded', async () => {
    // ★ 先暴露全局函数，确保其他模块立即可用（必须在任何 await 之前）
    window.AppState = AppState;
    window.apiGet = apiGet;
    window.apiPost = apiPost;
    window.apiDelete = apiDelete;
    window.showToast = showToast;
    window.showLoading = showLoading;
    window.hideLoading = hideLoading;
    window.openDirModal = openDirModal;
    window.openFileSelector = openFileSelector;
    window.openPreviewModal = openPreviewModal;

    // 图片预览弹窗关闭事件
    const previewModal = document.getElementById('previewModal');
    const previewClose = document.getElementById('previewModalClose');
    if (previewModal && previewClose) {
        previewClose.addEventListener('click', () => { previewModal.style.display = 'none'; });
        previewModal.addEventListener('click', (e) => {
            if (e.target === previewModal) previewModal.style.display = 'none';
        });
    }

    // 更新模型状态
    await updateModelStatus();

    // 定时刷新模型状态（每30秒）
    setInterval(updateModelStatus, 30000);

    // 选项卡切换
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // 全局配置加载
    try {
        const config = await apiGet('/config');
        AppState.config = config;
        document.getElementById('configThreshold').value = config.match_threshold || 0.55;
        document.getElementById('thresholdDisplay').textContent = config.match_threshold || 0.55;
    } catch (e) {
        console.warn('加载配置失败:', e);
    }
});