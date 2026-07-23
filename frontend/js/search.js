/* ============================================================
   FaceLabel - 人物搜索模块
   ============================================================ */

// ─── 状态 ───
let selectedRefFiles = [];
let selectedPersonName = ''; // 从标注人员选取时记录人名
let searchResults = [];
let selectedResults = new Set();

// ─── DOM 引用 ───
const refImagesInput = document.getElementById('refImages');
const browseRefBtn = document.getElementById('browseRefImages');
const refImageCount = document.getElementById('refImageCount');
const knownPersonSelect = document.getElementById('knownPersonSelect');
const useKnownPersonBtn = document.getElementById('useKnownPerson');
const refreshKnownPersonsBtn = document.getElementById('refreshKnownPersons');
const searchTargetDir = document.getElementById('searchTargetDir');
const browseSearchDir = document.getElementById('browseSearchDir');
const searchThreshold = document.getElementById('searchThreshold');
const searchThresholdValue = document.getElementById('searchThresholdValue');
const startSearchBtn = document.getElementById('startSearch');
const searchWorkspace = document.getElementById('searchWorkspace');
const searchBottomBar = document.getElementById('searchBottomBar');
const searchResultCount = document.getElementById('searchResultCount');
const exportResultsBtn = document.getElementById('exportResults');

// ─── 初始化 ───
document.addEventListener('DOMContentLoaded', () => {
    // 选择参考图片
    browseRefBtn.addEventListener('click', () => {
        window.openFileSelector((files) => {
            selectedRefFiles = files;
            selectedPersonName = ''; // 清空人名
            refImagesInput.value = files.length > 0 ? `${files.length} 张图片已选择` : '';
            refImageCount.textContent = `已选 ${files.length} 张`;
            // 清空已选标注人员
            if (files.length > 0 && knownPersonSelect) {
                knownPersonSelect.value = '';
            }
        });
    });

    // 从已标注人员选取参考照片
    useKnownPersonBtn.addEventListener('click', async () => {
        const name = knownPersonSelect.value;
        if (!name) {
            window.showToast('请先选择一位已标注人员', 'warning');
            return;
        }
        try {
            const groups = await window.apiGet('/faces/grouped');
            const group = groups.find(g => g.name === name);
            if (!group || !group.faces || group.faces.length === 0) {
                window.showToast(`「${name}」没有已标注的人脸照片`, 'warning');
                return;
            }
            // 去重取唯一图片路径（所有标注图片）
            const paths = [...new Set(group.faces.map(f => f.image_path))];
            selectedRefFiles = paths;
            selectedPersonName = name; // 记录人名
            refImagesInput.value = `已选 ${paths.length} 张（来自「${name}」）`;
            refImageCount.textContent = `已选 ${paths.length} 张`;
            window.showToast(`已加载「${name}」的 ${paths.length} 张标注照片`, 'success');
        } catch (e) {
            window.showToast('加载失败: ' + e.message, 'error');
        }
    });

    // 浏览搜索目录
    browseSearchDir.addEventListener('click', () => {
        window.openDirModal((path) => {
            if (path) searchTargetDir.value = path;
        });
    });

    // 阈值滑块
    searchThreshold.addEventListener('input', () => {
        searchThresholdValue.textContent = parseFloat(searchThreshold.value).toFixed(2);
    });

    // 开始搜索
    startSearchBtn.addEventListener('click', startSearch);

    // 导出结果
    exportResultsBtn.addEventListener('click', exportResults);

    // 刷新已标注人员下拉框
    if (refreshKnownPersonsBtn) {
        refreshKnownPersonsBtn.addEventListener('click', () => {
            loadKnownPersons();
            window.showToast('已刷新人员列表', 'success');
        });
    }

    // 加载已标注人员列表
    loadKnownPersons();
});

// ─── 加载已标注人员到下拉框 ───
async function loadKnownPersons() {
    if (!knownPersonSelect) return;
    try {
        // 保留第一个占位选项
        knownPersonSelect.innerHTML = '<option value="">-- 选择已标注人员 --</option>';
        const groups = await window.apiGet('/faces/grouped');
        if (!Array.isArray(groups)) return;
        groups.forEach(group => {
            const opt = document.createElement('option');
            opt.value = group.name;
            opt.textContent = `${group.name} (${group.sample_count} 张)`;
            knownPersonSelect.appendChild(opt);
        });
    } catch (e) {
        console.warn('加载已标注人员列表失败:', e);
    }
}

// 暴露到全局，供 tab 切换时调用
window.loadKnownPersons = loadKnownPersons;
// 暴露参考文件数据，供堆叠弹窗使用
window.selectedRefFiles = selectedRefFiles;
Object.defineProperty(window, 'selectedRefFiles', { get: () => selectedRefFiles });
Object.defineProperty(window, 'selectedPersonName', { get: () => selectedPersonName });

// ─── 开始搜索 ───
async function startSearch() {
    if (selectedRefFiles.length === 0) {
        window.showToast('请先选择参考照片', 'warning');
        return;
    }
    const targetDir = searchTargetDir.value.trim();
    if (!targetDir) {
        window.showToast('请选择搜索目录', 'warning');
        return;
    }

    const threshold = parseFloat(searchThreshold.value);

    window.showLoading(`正在搜索 ${targetDir} 中的人物...`);
    try {
        // 注意：后端返回的是按参考图片分组的数组
        const groups = await window.apiPost('/search', {
            reference_images: selectedRefFiles,
            target_dir: targetDir,
            threshold: threshold,
        });

        searchResults = groups || [];
        selectedResults = new Set();
        renderSearchResults(groups);
    } catch (e) {
        window.showToast('搜索失败: ' + e.message, 'error');
        searchWorkspace.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">❌</div>
                <h3>搜索出错</h3>
                <p>${e.message}</p>
            </div>
        `;
    } finally {
        window.hideLoading();
    }
}

// ─── 渲染搜索结果 ───
function renderSearchResults(groups) {
    // 计算总匹配数
    const totalMatches = groups.reduce((sum, g) => sum + (g.matches ? g.matches.length : 0), 0);
    searchResultCount.textContent = `找到 ${totalMatches} 张匹配图片（共 ${groups.length} 组参考）`;

    if (totalMatches === 0) {
        searchWorkspace.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <h3>未找到匹配结果</h3>
                <p>尝试降低匹配阈值，或更换参考照片</p>
            </div>
        `;
        searchBottomBar.style.display = 'none';
        return;
    }

    searchBottomBar.style.display = 'flex';

    // 按参考图片分组，每组一行展示
    const container = document.createElement('div');
    container.className = 'search-compare-layout';

    const rightPanel = document.createElement('div');
    rightPanel.className = 'search-result-panel';
    rightPanel.style.display = 'flex';
    rightPanel.style.flexDirection = 'column';
    rightPanel.style.gap = '6px';
    rightPanel.style.padding = '12px';
    rightPanel.style.overflowY = 'auto';

    // 表头行
    const headerRow = document.createElement('div');
    headerRow.className = 'search-result-row search-result-row-header';
    headerRow.innerHTML = `
        <div class="search-result-row-ref" style="font-weight:600;font-size:12px;color:var(--text-secondary);border:none;">参考图</div>
        <div class="search-result-row-matches" style="font-weight:600;font-size:12px;color:var(--text-secondary);">匹配结果</div>
    `;
    rightPanel.appendChild(headerRow);

    groups.forEach((group, gIdx) => {
        const matches = group.matches || [];
        if (matches.length === 0) return;

        const refName = selectedPersonName || `参考图 ${gIdx + 1}`;
        const refThumbUrl = `/api/face-thumbnail?image_path=${encodeURIComponent(group.ref_path)}&x1=0&y1=0&x2=0&y2=0&size=80`;

        // 每一行 = 一个参考人组
        const row = document.createElement('div');
        row.className = 'search-result-row';

        // 第一列：参考图
        const refCell = document.createElement('div');
        refCell.className = 'search-result-row-ref';
        refCell.innerHTML = `
            <div class="search-result-row-ref-inner" onclick="window.openPreviewModal('${group.ref_path.replace(/\\/g, '\\\\')}', '${refName}')">
                <img class="search-result-row-ref-img" src="${refThumbUrl}" alt=""
                     onerror="this.src='/api/preview/${encodeURIComponent(group.ref_path)}'">
                <span class="search-result-row-ref-name">${refName}</span>
                <span class="search-result-row-ref-count">参考图</span>
            </div>
        `;
        row.appendChild(refCell);

        // 第二列：匹配结果（横向滚动）
        const matchesCell = document.createElement('div');
        matchesCell.className = 'search-result-row-matches';

        const matchesScroll = document.createElement('div');
        matchesScroll.className = 'search-result-matches-scroll';

        matches.forEach((match, mIdx) => {
            const bestScore = match.matched_faces && match.matched_faces.length > 0
                ? Math.max(...match.matched_faces.map(f => f.similarity))
                : match.similarity;

            const card = document.createElement('div');
            card.className = 'search-result-card';
            const globalIdx = `${gIdx}-${mIdx}`;
            card.dataset.index = globalIdx;

            card.innerHTML = `
                <div style="position:relative;width:120px;flex-shrink:0;">
                    <img src="/api/preview/${encodeURIComponent(match.image_path)}"
                         alt="${match.image_name}"
                         loading="lazy"
                         onclick="window.openPreviewModal('${match.image_path.replace(/\\/g, '\\\\')}', '${match.image_name}')"
                         style="cursor:pointer;width:120px;height:100px;object-fit:cover;display:block;"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22100%22><rect fill=%22%23e2e8f0%22 width=%22120%22 height=%22100%22/><text x=%2260%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-size=%2212%22>加载失败</text></svg>'">
                    ${match.matched_faces && match.matched_faces.length > 1
                        ? `<span style="position:absolute;top:2px;left:2px;background:rgba(0,0,0,0.6);color:#fff;padding:1px 5px;border-radius:3px;font-size:10px;">${match.matched_faces.length} 人</span>`
                        : ''}
                </div>
                <div class="search-result-info" style="width:120px;">
                    <span class="search-result-name" title="${match.image_name}">${match.image_name}</span>
                    <span class="search-result-score">相似度 ${(bestScore * 100).toFixed(1)}%</span>
                </div>
            `;

            card.addEventListener('click', () => {
                card.classList.toggle('selected');
                if (card.classList.contains('selected')) {
                    selectedResults.add(globalIdx);
                } else {
                    selectedResults.delete(globalIdx);
                }
            });

            matchesScroll.appendChild(card);
        });

        matchesCell.appendChild(matchesScroll);
        row.appendChild(matchesCell);
        rightPanel.appendChild(row);
    });

    container.appendChild(rightPanel);

    searchWorkspace.innerHTML = '';
    searchWorkspace.appendChild(container);
}

// ─── 导出结果 ───
async function exportResults() {
    let paths = [];
    if (selectedResults.size > 0) {
        // 从 selectedResults 的 globalIdx 中提取路径
        paths = Array.from(selectedResults).map(key => {
            const [gIdx, mIdx] = key.split('-').map(Number);
            const group = searchResults[gIdx];
            if (group && group.matches && group.matches[mIdx]) {
                return group.matches[mIdx].image_path;
            }
            return null;
        }).filter(Boolean);
    }

    if (paths.length === 0) {
        // 如果未选择，提示是否全部导出
        if (!confirm('未选择特定图片，是否导出全部搜索结果？')) return;
        // 收集所有组的所有匹配图片
        for (const group of searchResults) {
            if (group.matches) {
                for (const match of group.matches) {
                    paths.push(match.image_path);
                }
            }
        }
    }

    window.showLoading(`正在导出 ${paths.length} 张图片...`);
    try {
        const result = await window.apiPost('/export', {
            image_paths: paths,
            export_dir: 'search_results',
        });
        window.showToast(result.message, 'success');
    } catch (e) {
        window.showToast('导出失败: ' + e.message, 'error');
    } finally {
        window.hideLoading();
    }
}