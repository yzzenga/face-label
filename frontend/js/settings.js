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
const modelPathDisplay = document.getElementById('modelPathDisplay');
const configThreshold = document.getElementById('configThreshold');
const thresholdDisplay = document.getElementById('thresholdDisplay');
const deviceSelect = document.getElementById('deviceSelect');
const saveConfigBtn = document.getElementById('saveConfig');
const mirrorSelect = document.getElementById('mirrorSelect');
const mirrorDesc = document.getElementById('mirrorDesc');
const applyMirror = document.getElementById('applyMirror');
const modelDirInput = document.getElementById('modelDirInput');
const browseModelDir = document.getElementById('browseModelDir');
const saveModelDir = document.getElementById('saveModelDir');

// ─── 下载相关 DOM 引用 ───
const downloadSection = document.getElementById('downloadSection');
const downloadUrlDisplay = document.getElementById('downloadUrlDisplay');
const progressSection = document.getElementById('progressSection');
const progressPercent = document.getElementById('progressPercent');
const progressSpeed = document.getElementById('progressSpeed');
const progressBytes = document.getElementById('progressBytes');
const progressFill = document.getElementById('progressFill');
const progressStatus = document.getElementById('progressStatus');

// ─── 初始化 ───
document.addEventListener('DOMContentLoaded', () => {
    loadModelList();
    loadConfig();
    loadMirrors();
    loadModelDir();
    // 已注册人脸库已移除（批量标注和人物搜索中已有）

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
    // 仅已加载时展示具体模型路径
    if (info.is_active && info.model_path) {
        modelPathDisplay.textContent = info.model_path;
    } else {
        modelPathDisplay.textContent = '-';
    }
}

// ─── 显示下载完成后的模型状态 ───
function onModelLoaded(modelInfo, message) {
    updateModelInfo(modelInfo);
    // 更新全局状态
    window.AppState.currentModel = modelInfo;
    // 更新导航栏状态
    const statusEl = document.getElementById('modelStatus');
    statusEl.className = 'status-indicator active';
    statusEl.textContent = `✓ ${modelInfo.name}`;
    // 隐藏下载区并显示成功
    downloadSection.style.display = 'none';
    window.showToast(message || `模型已就绪: ${modelInfo.name}`, 'success');
}

// ─── 通过 SSE 监听下载进度 ───
function listenDownloadProgress(taskId, modelKey, device) {
    downloadSection.style.display = 'block';
    progressSection.style.display = 'block';
    progressStatus.textContent = '正在连接下载服务...';

    const evtSource = new EventSource(`/api/models/download-progress/${taskId}`);

    evtSource.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        const status = data.status;

        if (status === 'not_found') {
            progressStatus.textContent = '下载任务不存在或已过期';
            evtSource.close();
            window.hideLoading();
            return;
        }

        if (status === 'starting') {
            progressStatus.textContent = '准备下载...';
            return;
        }

        if (status === 'downloading') {
            const pct = data.progress || 0;
            const speed = data.speed_mbps || 0;
            const downloaded = (data.bytes_downloaded || 0) / (1024 * 1024);
            const total = (data.total_bytes || 1) / (1024 * 1024);

            progressFill.style.width = pct + '%';
            progressPercent.textContent = pct + '%';
            progressSpeed.textContent = speed > 0 ? speed.toFixed(2) + ' MB/s' : '-- MB/s';
            progressBytes.textContent = downloaded.toFixed(1) + ' / ' + total.toFixed(0) + ' MB';
            progressStatus.textContent = `正在下载... ${speed > 0 ? speed.toFixed(2) + ' MB/s' : ''}`;
            return;
        }

        if (status === 'extracting') {
            progressStatus.textContent = '下载完成，正在解压模型文件...';
            progressFill.style.width = '99%';
            progressPercent.textContent = '99%';
            return;
        }

        if (status === 'completed') {
            progressFill.style.width = '100%';
            progressPercent.textContent = '100%';
            progressStatus.textContent = '✅ 下载完成，正在加载模型...';
            evtSource.close();

            // 自动加载模型
            try {
                const result = await window.apiPost('/models/switch', {
                    model_key: modelKey,
                    device: device,
                });
                onModelLoaded(result.data, result.message);
            } catch (e) {
                progressStatus.textContent = '❌ 模型加载失败: ' + e.message;
                window.showToast('模型加载失败: ' + e.message, 'error');
            } finally {
                window.hideLoading();
            }
            return;
        }

        if (status === 'error') {
            progressStatus.textContent = '❌ 下载失败: ' + (data.error || '未知错误');
            progressFill.style.width = '0%';
            progressPercent.textContent = '失败';
            progressSpeed.textContent = '-- MB/s';
            evtSource.close();
            window.hideLoading();
            window.showToast('模型下载失败: ' + (data.error || '未知错误'), 'error');
            return;
        }
    };

    evtSource.onerror = () => {
        progressStatus.textContent = '⚠️ 下载进度连接中断，请查看控制台日志';
        // 不关闭，SSE 会自动重连
    };
}

// ─── 显示下载链接 ───
async function showDownloadUrl(modelKey) {
    const mirrorKey = mirrorSelect.value;
    try {
        const resp = await window.apiGet(
            `/models/download-url?model_key=${encodeURIComponent(modelKey)}&mirror_key=${encodeURIComponent(mirrorKey)}`
        );
        if (resp.url) {
            downloadUrlDisplay.innerHTML = `<a href="${resp.url}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:underline;">${resp.url}</a>`;
            downloadSection.style.display = 'block';
            progressSection.style.display = 'none';
        } else {
            downloadSection.style.display = 'none';
        }
    } catch (e) {
        console.warn('获取下载链接失败:', e);
        downloadSection.style.display = 'none';
    }
}

// ─── 切换模型（含异步下载 + 进度展示） ───
async function switchModel() {
    const modelKey = modelSelect.value;
    const device = deviceSelect.value;

    // 0. 先在模型信息下方显示下载链接
    await showDownloadUrl(modelKey);

    // 1. 检查模型是否已在本地
    let checkResult;
    try {
        checkResult = await window.apiGet(`/models/check-availability?model_key=${encodeURIComponent(modelKey)}`);
    } catch (e) {
        console.warn('模型可用性检查失败，直接尝试加载:', e);
        checkResult = { available: false };
    }

    // 2. 如果模型已在本地，直接切换
    if (checkResult.available === true) {
        window.showLoading(`正在加载模型...`);
        try {
            const result = await window.apiPost('/models/switch', {
                model_key: modelKey,
                device: device,
            });
            onModelLoaded(result.data, result.message);
        } catch (e) {
            window.showToast('模型切换失败: ' + e.message, 'error');
        } finally {
            window.hideLoading();
        }
        return;
    }

    // DeepFace 按需下载
    if (checkResult.available === 'ondemand') {
        window.showToast('DeepFace 模型将在首次使用时自动下载', 'info');
        return;
    }

    // 3. 模型未下载，弹出确认对话框
    const modelName = checkResult.model_name || modelKey;
    const modelSz = checkResult.model_size || '未知';
    const mirrorKey = mirrorSelect.value;
    const mirrorName = mirrorSelect.options[mirrorSelect.selectedIndex]?.text || '当前镜像源';

    const shouldDownload = await showDownloadConfirm(modelName, modelSz, mirrorName, modelKey, mirrorKey);
    if (!shouldDownload) {
        return; // 用户取消
    }

    // 4. 启动异步下载
    window.showLoading('正在启动下载...');
    try {
        const resp = await window.apiPost('/models/download', {
            model_key: modelKey,
            mirror_key: mirrorKey,
            device: device,
        });

        if (resp.status === 'already_downloaded') {
            // 已在下载前被下载（并发安全）
            onModelLoaded(resp.model_info, resp.message);
            window.hideLoading();
            return;
        }

        if (resp.status === 'ondemand') {
            window.showToast(resp.message, 'info');
            window.hideLoading();
            return;
        }

        // 开始监听 SSE 进度
        window.hideLoading();
        listenDownloadProgress(resp.task_id, modelKey, device);
    } catch (e) {
        window.hideLoading();
        window.showToast('启动下载失败: ' + e.message, 'error');
    }
}

// ─── 下载确认弹窗（含下载链接展示） ───
function showDownloadConfirm(modelName, modelSize, mirrorName, modelKey, mirrorKey) {
    return new Promise((resolve) => {
        // 异步获取下载链接
        let downloadLink = '获取中...';
        window.apiGet(`/models/download-url?model_key=${encodeURIComponent(modelKey)}&mirror_key=${encodeURIComponent(mirrorKey)}`)
            .then(r => { if (r.url) downloadLink = r.url; })
            .catch(() => {});

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';

        overlay.innerHTML = `
            <div class="modal" style="width:500px;">
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
                            <span style="font-size:11px;word-break:break-all;max-width:260px;text-align:right;">${modelDirInput.value}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;padding:4px 0;align-items:flex-start;">
                            <span style="color:var(--text-secondary);flex-shrink:0;">下载链接</span>
                            <span id="confirmDownloadUrl" style="font-size:10px;word-break:break-all;max-width:280px;text-align:right;color:var(--primary);margin-left:8px;">${downloadLink}</span>
                        </div>
                    </div>
                    <p style="font-size:12px;color:var(--text-light);text-align:center;">
                        ⚠️ 首次下载需要联网，下载完成后自动加载<br>
                        <span style="font-size:11px;">下载过程中会实时显示进度和速度</span>
                    </p>
                </div>
                <div class="modal-footer" style="justify-content:center;gap:12px;">
                    <button class="btn btn-secondary" id="downloadCancel" style="padding:10px 24px;">取消</button>
                    <button class="btn btn-primary" id="downloadConfirm" style="padding:10px 24px;">⬇️ 确认下载</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // 异步填充链接
        setTimeout(async () => {
            try {
                const r = await window.apiGet(`/models/download-url?model_key=${encodeURIComponent(modelKey)}&mirror_key=${encodeURIComponent(mirrorKey)}`);
                const el = document.getElementById('confirmDownloadUrl');
                if (el && r.url) {
                    el.innerHTML = `<a href="${r.url}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:underline;">${r.url}</a>`;
                }
            } catch (_) {}
        }, 50);

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