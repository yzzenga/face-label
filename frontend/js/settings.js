/* ============================================================
   FaceLabel - 模型设置模块
   ============================================================ */

// ─── DOM 引用 ───
const modelSelect = document.getElementById('modelSelect');
const applyModel = document.getElementById('applyModel');
const modelAccuracy = document.getElementById('modelAccuracy');
const modelSize = document.getElementById('modelSize');
const modelSpeed = document.getElementById('modelSpeed');
const modelActive = document.getElementById('modelActive');
const configThreshold = document.getElementById('configThreshold');
const thresholdDisplay = document.getElementById('thresholdDisplay');
const deviceSelect = document.getElementById('deviceSelect');
const saveConfigBtn = document.getElementById('saveConfig');
const knownFacesList = document.getElementById('knownFacesList');
const clearAllFaces = document.getElementById('clearAllFaces');
const mirrorSelect = document.getElementById('mirrorSelect');
const mirrorDesc = document.getElementById('mirrorDesc');
const applyMirror = document.getElementById('applyMirror');
const modelDirInput = document.getElementById('modelDirInput');
const browseModelDir = document.getElementById('browseModelDir');
const saveModelDir = document.getElementById('saveModelDir');

// ─── 初始化 ───
document.addEventListener('DOMContentLoaded', () => {
    loadModelList();
    loadConfig();
    loadMirrors();
    loadModelDir();
    loadKnownFaces();

    // 阈值滑块
    configThreshold.addEventListener('input', () => {
        thresholdDisplay.textContent = parseFloat(configThreshold.value).toFixed(2);
    });

    // 应用模型 → 同时使用当前设备选择
    applyModel.addEventListener('click', switchModel);

    // 保存配置
    saveConfigBtn.addEventListener('click', saveConfig);

    // 应用镜像源
    applyMirror.addEventListener('click', switchMirror);

    // 模型目录
    browseModelDir.addEventListener('click', () => {
        window.openDirModal((path) => {
            if (path) modelDirInput.value = path;
        });
    });
    saveModelDir.addEventListener('click', saveModelDirHandler);
});

// ─── 加载模型列表 ───
async function loadModelList() {
    // 先加载模型列表（独立 try，确保列表总能显示）
    try {
        const models = await window.apiGet('/models');
        modelSelect.innerHTML = '';
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.key;
            opt.textContent = `${m.name} (${m.accuracy})`;
            if (m.is_active) opt.selected = true;
            modelSelect.appendChild(opt);
        });
    } catch (e) {
        console.warn('加载模型列表失败:', e);
        window.showToast('加载模型列表失败: ' + e.message, 'error');
    }

    // 再加载当前模型信息（独立 try，失败不影响列表）
    try {
        const current = await window.apiGet('/models/current');
        updateModelInfo(current);
    } catch (e) {
        console.warn('加载当前模型信息失败:', e);
    }
}

// ─── 加载保存的配置到 UI ───
async function loadConfig() {
    try {
        const config = await window.apiGet('/config');
        if (config.match_threshold) {
            configThreshold.value = config.match_threshold;
            thresholdDisplay.textContent = parseFloat(config.match_threshold).toFixed(2);
        }
        if (config.device) {
            deviceSelect.value = config.device;
        }
        window.AppState.config = config;
    } catch (e) {
        console.warn('加载配置失败:', e);
    }
}

// ─── 更新模型信息 ───
function updateModelInfo(info) {
    modelAccuracy.textContent = info.accuracy || '-';
    modelSize.textContent = info.model_size || '-';
    modelSpeed.textContent = info.speed || '-';
    modelActive.textContent = info.is_active ? '✅ 已加载' : '❌ 未加载';
    modelActive.style.color = info.is_active ? '#22c55e' : '#ef4444';
}

// ─── 切换模型（含下载检查） ───
async function switchModel() {
    const modelKey = modelSelect.value;
    const device = deviceSelect.value;

    // 1. 检查模型是否已在本地
    let checkResult;
    try {
        checkResult = await window.apiGet(`/models/check-availability?model_key=${encodeURIComponent(modelKey)}`);
    } catch (e) {
        console.warn('模型可用性检查失败，直接尝试加载:', e);
        checkResult = { available: false };
    }

    // 2. 如果模型不可用，弹出确认对话框
    if (checkResult.available === false) {
        const modelName = checkResult.model_name || modelKey;
        const modelSize = checkResult.model_size || '未知';
        const mirrorKey = mirrorSelect.value;
        const mirrorName = mirrorSelect.options[mirrorSelect.selectedIndex]?.text || '当前镜像源';

        const shouldDownload = await showDownloadConfirm(modelName, modelSize, mirrorName);
        if (!shouldDownload) {
            return; // 用户取消，不做任何操作
        }
    } else if (checkResult.available === 'ondemand') {
        // DeepFace 按需下载，直接提示
        window.showToast('DeepFace 模型将在首次使用时自动下载', 'info');
    }

    // 3. 执行切换
    window.showLoading(`正在加载模型...`);
    try {
        const result = await window.apiPost('/models/switch', {
            model_key: modelKey,
            device: device,
        });
        window.showToast(result.message, 'success');
        updateModelInfo(result.data);

        // 更新全局状态
        window.AppState.currentModel = result.data;
        // 更新导航栏状态
        const statusEl = document.getElementById('modelStatus');
        statusEl.className = 'status-indicator active';
        statusEl.textContent = `✓ ${result.data.name}`;
    } catch (e) {
        window.showToast('模型切换失败: ' + e.message, 'error');
    } finally {
        window.hideLoading();
    }
}

// ─── 下载确认弹窗 ───
function showDownloadConfirm(modelName, modelSize, mirrorName) {
    return new Promise((resolve) => {
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';

        overlay.innerHTML = `
            <div class="modal" style="width:460px;">
                <div class="modal-header">
                    <h3>⬇️ 下载模型</h3>
                    <button class="modal-close" id="downloadConfirmClose">✕</button>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <div style="text-align:center;margin-bottom:16px;">
                        <span style="font-size:48px;">📦</span>
                    </div>
                    <p style="font-size:15px;margin-bottom:12px;text-align:center;">
                        <strong>${modelName}</strong> 尚未下载
                    </p>
                    <div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;">
                        <div style="display:flex;justify-content:space-between;padding:4px 0;">
                            <span style="color:var(--text-secondary);">模型大小</span>
                            <span>${modelSize}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:4px 0;">
                            <span style="color:var(--text-secondary);">下载镜像</span>
                            <span>${mirrorName}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:4px 0;">
                            <span style="color:var(--text-secondary);">存储位置</span>
                            <span style="font-size:11px;word-break:break-all;max-width:240px;text-align:right;">${modelDirInput.value}</span>
                        </div>
                    </div>
                    <p style="font-size:12px;color:var(--text-light);text-align:center;">
                        ⚠️ 首次下载需要联网，下载完成后自动加载
                    </p>
                </div>
                <div class="modal-footer" style="justify-content:center;gap:12px;">
                    <button class="btn btn-secondary" id="downloadCancel" style="padding:10px 24px;">取消</button>
                    <button class="btn btn-primary" id="downloadConfirm" style="padding:10px 24px;">⬇️ 确认下载</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => {
            overlay.remove();
            resolve(false);
        };
        const confirm = () => {
            overlay.remove();
            resolve(true);
        };

        overlay.querySelector('#downloadConfirmClose').onclick = close;
        overlay.querySelector('#downloadCancel').onclick = close;
        overlay.querySelector('#downloadConfirm').onclick = confirm;
        // 点击遮罩背景不关闭，防止误操作
    });
}

// ─── 保存配置 ───
async function saveConfig() {
    const threshold = parseFloat(configThreshold.value);
    const device = deviceSelect.value;

    try {
        await window.apiPost('/config', { key: 'match_threshold', value: String(threshold) });
        await window.apiPost('/config', { key: 'device', value: device });

        window.AppState.config.match_threshold = threshold;
        window.AppState.config.device = device;

        window.showToast('配置已保存', 'success');
    } catch (e) {
        window.showToast('保存配置失败: ' + e.message, 'error');
    }
}

// ─── 加载已知人脸库 ───
async function loadKnownFaces() {
    try {
        const faces = await window.apiGet('/faces/known');
        window.AppState.knownFaces = faces;

        if (faces.length === 0) {
            knownFacesList.innerHTML = `<p class="text-muted">暂无已标注的人脸，请先在批量标注中添加</p>`;
            clearAllFaces.style.display = 'none';
            return;
        }

        clearAllFaces.style.display = 'inline-flex';

        let html = '';
        faces.forEach(face => {
            html += `
                <div class="known-face-item">
                    <div class="known-face-name">
                        👤 ${face.name}
                        <span class="known-face-count">${face.sample_count} 张样本</span>
                    </div>
                    <button class="known-face-delete" data-name="${face.name}">删除</button>
                </div>
            `;
        });
        knownFacesList.innerHTML = html;

        // 绑定删除事件
        knownFacesList.querySelectorAll('.known-face-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const name = btn.dataset.name;
                if (!confirm(`确定要删除「${name}」的所有标注吗？`)) return;
                try {
                    await window.apiDelete(`/faces/name/${encodeURIComponent(name)}`);
                    window.showToast(`已删除「${name}」`, 'success');
                    loadKnownFaces();
                } catch (e) {
                    window.showToast('删除失败: ' + e.message, 'error');
                }
            });
        });

        // 清空所有人脸库
        clearAllFaces.onclick = async () => {
            if (!confirm('确定要清空所有人脸库吗？此操作不可恢复！')) return;
            let deleted = 0;
            for (const face of faces) {
                try {
                    await window.apiDelete(`/faces/name/${encodeURIComponent(face.name)}`);
                    deleted++;
                } catch (e) {
                    console.warn(`删除 ${face.name} 失败:`, e);
                }
            }
            window.showToast(`已清空 ${deleted} 个人脸`, 'success');
            loadKnownFaces();
        };

    } catch (e) {
        knownFacesList.innerHTML = `<p class="text-muted">加载失败: ${e.message}</p>`;
    }
}

// ─── 加载镜像源列表 ───
async function loadMirrors() {
    try {
        const data = await window.apiGet('/mirrors');
        const mirrors = data.mirrors || [];
        const current = data.current || {};

        mirrorSelect.innerHTML = '';
        mirrors.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.key;
            opt.textContent = m.name;
            if (m.key === current.key) opt.selected = true;
            mirrorSelect.appendChild(opt);
        });

        // 显示当前镜像源描述
        updateMirrorDesc(current.key, mirrors);
    } catch (e) {
        mirrorSelect.innerHTML = '<option>加载失败</option>';
        console.warn('加载镜像源列表失败:', e);
    }
}

function updateMirrorDesc(key, mirrors) {
    const m = (mirrors || []).find(x => x.key === key);
    if (m) {
        mirrorDesc.textContent = m.description;
    }
}

// ─── 切换镜像源 ───
async function switchMirror() {
    const mirrorKey = mirrorSelect.value;
    if (!mirrorKey) return;

    const reload = confirm('切换镜像源后需要重新加载模型才能生效，是否立即重新加载？');

    window.showLoading('正在切换镜像源...');
    try {
        const result = await window.apiPost('/mirrors/switch', {
            mirror_key: mirrorKey,
            reload_model: reload,
        });
        window.showToast(result.message, 'success');

        // 更新镜像源描述
        updateMirrorDesc(mirrorKey);

        // 如果重新加载了模型，更新模型状态
        if (reload) {
            const modelInfo = await window.apiGet('/models/current');
            updateModelInfo(modelInfo);
            const statusEl = document.getElementById('modelStatus');
            statusEl.className = 'status-indicator active';
            statusEl.textContent = `✓ ${modelInfo.name}`;
            window.AppState.currentModel = modelInfo;
        }

        // 保存到配置
        await window.apiPost('/config', { key: 'mirror', value: mirrorKey });
    } catch (e) {
        window.showToast('镜像源切换失败: ' + e.message, 'error');
    } finally {
        window.hideLoading();
    }
}

// ─── 加载模型目录 ───
async function loadModelDir() {
    try {
        const data = await window.apiGet('/model-dir');
        modelDirInput.value = data.current_dir || '未知';
    } catch (e) {
        modelDirInput.value = '加载失败';
        console.warn('加载模型目录失败:', e);
    }
}

// ─── 保存模型目录 ───
async function saveModelDirHandler() {
    const newDir = modelDirInput.value.trim();
    if (!newDir) {
        window.showToast('请先选择目录', 'warning');
        return;
    }

    window.showLoading('正在保存模型目录...');
    try {
        const result = await window.apiPost('/model-dir', { dir: newDir });
        window.showToast(result.message, 'success');
        // 也保存到配置
        await window.apiPost('/config', { key: 'model_dir', value: newDir });
    } catch (e) {
        window.showToast('保存失败: ' + e.message, 'error');
    } finally {
        window.hideLoading();
    }
}