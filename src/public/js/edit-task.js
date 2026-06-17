// 修改任务相关功能
let shareFolderSelector = new FolderSelector({
    apiUrl: "/api/share/folders",
    onSelect: ({ id, name, path }) => {
        document.getElementById('shareFolder').value = path;
        document.getElementById('shareFolderId').value = id;
    },
    buildParams: (accountId, folderId) => {
        const taskId = document.getElementById('editTaskId').value;
        let params = `${accountId}?folderId=${folderId}&taskId=${taskId}`;
        // 链接被改动时, 用新链接实时解析源目录(否则仍读取任务存储的旧分享)
        const shareLink = (document.getElementById('editShareLink')?.value || '').trim();
        const accessCode = (document.getElementById('editAccessCode')?.value || '').trim();
        if (shareLink && shareLink !== (editTaskOriginal.shareLink || '').trim()) {
            params += `&shareLink=${encodeURIComponent(shareLink)}`;
            if (accessCode) params += `&accessCode=${encodeURIComponent(accessCode)}`;
        }
        return params;
    }
});

let editFolderSelector = new FolderSelector({
    onSelect: ({ id, name, path }) => {
        document.getElementById('editRealFolder').value = path;
        document.getElementById('editRealFolderId').value = id;
    }
});

// 记录打开弹窗时任务的原始账号与保存目录, 用于在切换账号时判断是否需要重选目录
let editTaskOriginal = {};

// 渲染编辑弹窗的账号下拉(复用 accounts.js 的全局 accountsList)
function populateEditAccountOptions(selectedAccountId) {
    const select = document.getElementById('editAccountId');
    if (!select) return;
    select.innerHTML = '';
    (accountsList || []).forEach(account => {
        // n_打头的账号不显示在下拉列表中
        if (account.original_username?.startsWith('n_')) return;
        const cloudType = account.cloudType || (account.original_username?.startsWith('q_') ? 'quark' : 'cloud189');
        const cloudTypeName = cloudType === 'quark' ? '夸克网盘' : '天翼云盘';
        const option = document.createElement('option');
        option.value = account.id;
        option.dataset.cloudType = cloudType;
        option.textContent = `${cloudTypeName} - ${account.username}`;
        if (String(account.id) === String(selectedAccountId)) option.selected = true;
        select.appendChild(option);
    });
}

// 根据分享链接网盘类型禁用不匹配的账号选项
function syncEditTaskAccountOptions() {
    const select = document.getElementById('editAccountId');
    if (!select) return;
    const shareLink = document.getElementById('editShareLink')?.value || '';
    const shareCloudType = getShareLinkCloudType(shareLink);
    const options = Array.from(select.options);
    options.forEach(option => {
        const shouldDisable = !!shareCloudType && option.dataset.cloudType !== shareCloudType;
        option.disabled = shouldDisable;
        option.hidden = shouldDisable;
    });
    const selectedOption = select.selectedOptions[0];
    if (selectedOption && selectedOption.disabled) {
        const firstAvailableOption = options.find(option => !option.disabled);
        select.value = firstAvailableOption ? firstAvailableOption.value : '';
        select.dispatchEvent(new Event('change'));
    }
}

// 切换账号或分享链接后同步保存目录/源目录:
// - 保存目录(realFolder): 仅在账号与原任务一致时保留, 否则清空要求重选
// - 源目录(shareFolder): 仅在账号且链接都与原任务一致时保留, 否则清空(后端默认取新分享根目录)
function syncEditFolders() {
    const accountId = document.getElementById('editAccountId').value;
    const shareLink = (document.getElementById('editShareLink').value || '').trim();
    const accountUnchanged = String(accountId) === String(editTaskOriginal.accountId);
    const linkUnchanged = shareLink === (editTaskOriginal.shareLink || '').trim();

    if (accountUnchanged) {
        document.getElementById('editRealFolder').value = editTaskOriginal.realFolderName || '';
        document.getElementById('editRealFolderId').value = editTaskOriginal.realFolderId || '';
    } else {
        document.getElementById('editRealFolder').value = '';
        document.getElementById('editRealFolderId').value = '';
    }

    if (accountUnchanged && linkUnchanged) {
        document.getElementById('shareFolder').value = editTaskOriginal.shareFolderName || '';
        document.getElementById('shareFolderId').value = editTaskOriginal.shareFolderId || '';
    } else {
        document.getElementById('shareFolder').value = '';
        document.getElementById('shareFolderId').value = '';
    }
}

function showEditTaskModal(id) {
    const task = getTaskById(id)
    editTaskOriginal = {
        accountId: task.accountId,
        shareLink: task.shareLink,
        realFolderId: task.realFolderId,
        realFolderName: task.realFolderName ? task.realFolderName : task.realFolderId,
        shareFolderId: task.shareFolderId,
        shareFolderName: task.shareFolderName
    };
    document.getElementById('editTaskId').value = id;
    populateEditAccountOptions(task.accountId);
    document.getElementById('editAccountId').value = task.accountId;
    document.getElementById('editShareLink').value = task.shareLink;
    document.getElementById('editAccessCode').value = task.accessCode || '';
    document.getElementById('editResourceName').value = task.resourceName;
    document.getElementById('editRealFolder').value = task.realFolderName?task.realFolderName:task.realFolderId;
    document.getElementById('editRealFolderId').value = task.realFolderId;
    document.getElementById('editCurrentEpisodes').value = task.currentEpisodes;
    document.getElementById('editTotalEpisodes').value = task.totalEpisodes;
    document.getElementById('editStatus').value = task.status;
    document.getElementById('shareFolder').value = task.shareFolderName;
    document.getElementById('shareFolderId').value = task.shareFolderId;
    document.getElementById('editMatchPattern').value = task.matchPattern;
    document.getElementById('editMatchOperator').value = task.matchOperator;
    document.getElementById('editMatchValue').value = task.matchValue;
    document.getElementById('editRemark').value = task.remark;
    document.getElementById('editTaskModal').style.display = 'block';
    document.getElementById('editEnableCron').checked = task.enableCron;
    document.getElementById('editCronExpression').value = task.cronExpression;
    document.getElementById('editShareParseError').textContent = '';
    syncEditTaskAccountOptions();

    document.getElementsByClassName('cronExpression-box')[1].style.display = task.enableCron?'block':'none';
    document.getElementById('editEnableCron').addEventListener('change', function() {
        // 如果为选中 则显示cron表达式输入框
        const cronInput = document.getElementsByClassName('cronExpression-box')[1];
        cronInput.style.display = this.checked? 'block' : 'none';
    });
    document.getElementById('editEnableTaskScraper').checked = task?.enableTaskScraper;
}

function closeEditTaskModal() {
    document.getElementById('editTaskModal').style.display = 'none';
}

function initEditTaskForm() {
    document.getElementById('shareFolder').addEventListener('click', (e) => {
        e.preventDefault();
        const accountId = document.getElementById('editAccountId').value;
        if (!accountId) {
            message.warning('请先选择账号');
            return;
        }
        shareFolderSelector.show(accountId);
    });

    // 更新目录也改为点击触发
    document.getElementById('editRealFolder').addEventListener('click', (e) => {
        e.preventDefault();
        const accountId = document.getElementById('editAccountId').value;
        if (!accountId) {
            message.warning('请先选择账号');
            return;
        }
        editFolderSelector.show(accountId);
    });

    // 分享链接变化: 解析内嵌访问码 + 按网盘类型联动账号下拉
    document.getElementById('editShareLink').addEventListener('blur', () => {
        const errorEl = document.getElementById('editShareParseError');
        errorEl.textContent = '';
        let shareLink = document.getElementById('editShareLink').value?.trim();
        if (!shareLink) return;
        try {
            const { url: parsedUrl, accessCode } = parseCloudShare(decodeURIComponent(shareLink));
            if (parsedUrl) document.getElementById('editShareLink').value = parsedUrl;
            if (accessCode) document.getElementById('editAccessCode').value = accessCode;
        } catch (error) {
            // 解析失败时保留原始输入
        }
        syncEditTaskAccountOptions();
        syncEditFolders();
    });

    // 切换账号: 同步保存目录/源目录
    document.getElementById('editAccountId').addEventListener('change', syncEditFolders);

    document.getElementById('editTaskForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('editTaskId').value;
        const accountId = document.getElementById('editAccountId').value;
        const shareLink = document.getElementById('editShareLink').value;
        const accessCode = document.getElementById('editAccessCode').value;
        const resourceName = document.getElementById('editResourceName').value;
        const realFolderId = document.getElementById('editRealFolderId').value;
        const realFolderName = document.getElementById('editRealFolder').value;
        const currentEpisodes = document.getElementById('editCurrentEpisodes').value;
        const totalEpisodes = document.getElementById('editTotalEpisodes').value;
        const shareFolderName = document.getElementById('shareFolder').value;
        const shareFolderId = document.getElementById('shareFolderId').value;
        const status = document.getElementById('editStatus').value;

        const matchPattern = document.getElementById('editMatchPattern').value
        const matchOperator = document.getElementById('editMatchOperator').value
        const matchValue = document.getElementById('editMatchValue').value
        const remark = document.getElementById('editRemark').value

        const enableCron = document.getElementById('editEnableCron').checked;
        const cronExpression = document.getElementById('editCronExpression').value;
        const enableTaskScraper = document.getElementById('editEnableTaskScraper').checked;

        // 校验分享链接网盘类型与账号是否匹配
        const shareCloudType = getShareLinkCloudType(shareLink);
        if (shareCloudType) {
            const selectedOption = document.querySelector(`#editAccountId option[value="${accountId}"]`);
            if (selectedOption?.dataset.cloudType !== shareCloudType) {
                const cloudTypeName = shareCloudType === 'quark' ? '夸克网盘' : '天翼云盘';
                message.warning(`${cloudTypeName}分享链接只能选择${cloudTypeName}账号`);
                return;
            }
        }
        // 账号变化时必须重选保存目录
        if (String(accountId) !== String(editTaskOriginal.accountId) && !realFolderId) {
            message.warning('切换账号/网盘后请重新选择保存目录');
            return;
        }

        try {
            loading.show()
            const body = {
                accountId: accountId?parseInt(accountId):undefined,
                shareLink,
                accessCode,
                resourceName,
                realFolderId,
                currentEpisodes: currentEpisodes?parseInt(currentEpisodes):0,
                totalEpisodes: totalEpisodes?parseInt(totalEpisodes):0,
                status,
                realFolderName,
                matchPattern,
                matchOperator,
                matchValue,
                remark,
                enableCron,
                cronExpression,
                enableTaskScraper
            };
            // 源目录为空时不下发, 由后端默认取新分享根目录
            if (shareFolderId) {
                body.shareFolderId = shareFolderId;
                body.shareFolderName = shareFolderName;
            }
            const response = await fetch(`/api/tasks/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            loading.hide()
            if (response.ok) {
                const data = await response.json();
                if (data.success === false) {
                    message.warning(data.error || '修改任务失败');
                    return;
                }
                closeEditTaskModal();
                await fetchTasks();
            } else {
                const error = await response.json();
                message.warning(error.message || '修改任务失败');
            }
        } catch (error) {
            message.warning('修改任务失败：' + error.message);
        }
    });
}