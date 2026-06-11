let searchResults = [];
let selectedIndex = -1;

function showCloudsaver() {
    document.getElementById('cloudSaverModal').style.display = 'block';
    document.body.classList.add('modal-open');
    document.getElementById('searchInput').focus();

    document.getElementById('cloudSaverModal').addEventListener('click', (e) => {
        if (e.target.id === 'cloudSaverModal') {
            closeCloudsaver();
        }
    });
}

function closeCloudsaver() {
    document.getElementById('cloudSaverModal').style.display = 'none';
    document.body.classList.remove('modal-open');
    // 重置状态
    searchResults = [];
    selectedIndex = -1;
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResults').style.display = 'none';
}

async function searchResources() {
    const keyword = document.getElementById('searchInput').value.trim();
    if (!keyword) {
        message.warning('请输入搜索关键字');
        return;
    }
    try {
        loading.show();
        const response = await fetch(`/api/cloudsaver/search?keyword=${keyword}`);
        const data = await response.json();
        if (data.success) {
            searchResults = data.data;
            renderResults();
        } else {
            message.error(data.error); 
        }
    } catch (error) {
        console.error('搜索失败:', error);
        message.error('搜索失败');
    } finally {
        loading.hide();
    }
}

function getCloudSaverResultLink(resource) {
    const cloudLink = resource.cloudLinks?.[0];
    return typeof cloudLink === 'string' ? cloudLink : cloudLink?.link || '';
}

function getCloudSaverCloudTypeFromLink(link) {
    let text = (link || '').trim();
    try {
        text = decodeURIComponent(text);
    } catch (error) {
        // 如果不是合法的 URL 编码，继续使用原文本判断。
    }
    if (/pan\.quark\.cn|drive\.quark\.cn|quark\.cn\/s\//i.test(text)) {
        return 'quark';
    }
    if (/cloud\.189\.cn|h5\.cloud\.189\.cn|content\.21cn\.com/i.test(text)) {
        return 'cloud189';
    }
    return '';
}

function getCloudSaverCloudTypeMeta(resource) {
    const cloudLink = resource.cloudLinks?.[0];
    const cloudType = resource.cloudType
        || (typeof cloudLink === 'string' ? '' : cloudLink?.cloudType)
        || getCloudSaverCloudTypeFromLink(getCloudSaverResultLink(resource));

    return cloudType === 'quark'
        ? { label: '夸克', className: 'cloud-tag-quark' }
        : { label: '天翼', className: 'cloud-tag-cloud189' };
}

function renderResults() {
    const resultsDiv = document.querySelector('.cloudsaver-results-list');
    document.querySelector('.cloudsaver-action-buttons').style.display = 'none';
    if (searchResults.length === 0) {
        resultsDiv.innerHTML = `
            <div style="padding: 8px; color: #999; font-size: 12px;">未搜索到任何资源</div>
        `;
    } else {
        document.querySelector('.cloudsaver-action-buttons').style.display = 'flex';
        resultsDiv.innerHTML = `
            <div style="padding: 8px; color: #999; font-size: 12px;">以下资源来自 <a href="https://github.com/jiangrui1994/cloudsaver" target="_blank" style="color: #666; text-decoration: underline;">CloudSaver</a></div>
            ${searchResults.map((item, index) => {
                const cloudTypeMeta = getCloudSaverCloudTypeMeta(item);
                return `
                <div class="cloudsaver-result-item" onclick="selectItem(${index})" data-index="${index}">
                    <span class="cloudsaver-cloud-tag ${cloudTypeMeta.className}">${cloudTypeMeta.label}</span>
                    <span class="cloudsaver-result-title">${escapeHtml(item.title)}</span>
                </div>
            `;
            }).join('')}
        `;
    }
    document.getElementById('searchResults').style.display = 'block';
}

function selectItem(index) {
    selectedIndex = index;
    document.querySelectorAll('.cloudsaver-result-item').forEach(item => {
        item.classList.remove('selected');
    });
    document.querySelector(`[data-index="${index}"]`).classList.add('selected');
}

function handleSelectedResource(action) {
    if (selectedIndex === -1) {
        message.warning('请先选择一个资源');
        return;
    }

    const resource = searchResults[selectedIndex];
    const link = getCloudSaverResultLink(resource);
    if (action === 'open') {
        window.open(link, '_blank');
    } else if (action === 'create') {
        document.getElementById('shareLink').value = link;
        // 触发 blur 事件
        document.getElementById('shareLink').dispatchEvent(new Event('blur'));
        closeCloudsaver();
        openCreateTaskModal();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                searchResources();
            }
        });
    }
});
