let accountsList = []
let chooseAccount = null
let cloud189QrLoginTimer = null
let cloud189QrLoginActiveId = ''

function resetCloud189QrLogin(keepResult = false) {
    if (cloud189QrLoginTimer) {
        clearTimeout(cloud189QrLoginTimer);
        cloud189QrLoginTimer = null;
    }
    cloud189QrLoginActiveId = '';
    const qrLoginIdInput = document.getElementById('cloud189QrLoginId');
    const qrBox = document.getElementById('cloud189QrLoginBox');
    const qrImage = document.getElementById('cloud189QrImage');
    const qrStatus = document.getElementById('cloud189QrStatus');
    const startBtn = document.getElementById('cloud189QrLoginBtn');
    const cancelBtn = document.getElementById('cloud189QrCancelBtn');
    if (!keepResult && qrLoginIdInput) qrLoginIdInput.value = '';
    if (qrBox) qrBox.style.display = keepResult ? 'flex' : 'none';
    if (!keepResult && qrImage) qrImage.src = '';
    if (qrStatus) qrStatus.textContent = keepResult ? '扫码成功' : '等待扫码';
    if (startBtn) {
        startBtn.disabled = false;
        startBtn.classList.remove('loading');
        startBtn.textContent = keepResult ? '重新获取二维码' : '获取二维码';
    }
    if (cancelBtn) cancelBtn.style.display = 'none';
}

function cancelCloud189QrLogin() {
    resetCloud189QrLogin();
}

async function startCloud189QrLogin() {
    if (document.getElementById('cloudType').value !== 'cloud189') {
        message.warning('请选择天翼云盘');
        return;
    }
    resetCloud189QrLogin();
    const qrBox = document.getElementById('cloud189QrLoginBox');
    const qrImage = document.getElementById('cloud189QrImage');
    const qrStatus = document.getElementById('cloud189QrStatus');
    const startBtn = document.getElementById('cloud189QrLoginBtn');
    const cancelBtn = document.getElementById('cloud189QrCancelBtn');
    try {
        if (qrBox) qrBox.style.display = 'flex';
        if (qrStatus) qrStatus.textContent = '正在生成二维码';
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.classList.add('loading');
        }
        const response = await fetch('/api/accounts/cloud189/qrcode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || '二维码生成失败');
        }
        cloud189QrLoginActiveId = data.data.qrId;
        if (qrImage) qrImage.src = data.data.imageUrl;
        if (qrStatus) qrStatus.textContent = '请使用天翼云盘 App 或微信扫码';
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.classList.remove('loading');
            startBtn.textContent = '刷新二维码';
        }
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
        pollCloud189QrLogin(data.data.qrId);
    } catch (error) {
        resetCloud189QrLogin();
        message.warning('二维码登录失败: ' + error.message);
    }
}

async function pollCloud189QrLogin(qrId) {
    if (!qrId || qrId !== cloud189QrLoginActiveId) return;
    try {
        const response = await fetch(`/api/accounts/cloud189/qrcode/${qrId}`);
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || '查询扫码状态失败');
        }
        const status = data.data.status;
        const qrStatus = document.getElementById('cloud189QrStatus');
        if (status === 'success') {
            document.getElementById('cloud189QrLoginId').value = data.data.qrLoginId;
            document.getElementById('username').value = data.data.username || '';
            resetCloud189QrLogin(true);
            const successStatus = document.getElementById('cloud189QrStatus');
            if (successStatus) successStatus.textContent = '扫码成功，正在添加账号';
            await createAccount();
            return;
        }
        if (status === 'expired') {
            resetCloud189QrLogin();
            message.warning('二维码已失效，请重新获取');
            return;
        }
        if (qrStatus) {
            qrStatus.textContent = status === 'scanned' ? '已扫码，请在手机端确认' : '等待扫码';
        }
        cloud189QrLoginTimer = setTimeout(() => pollCloud189QrLogin(qrId), 3000);
    } catch (error) {
        resetCloud189QrLogin();
        message.warning('二维码登录失败: ' + error.message);
    }
}

// 账号相关功能
async function fetchAccounts(updateSelect = false) {
    const response = await fetch('/api/accounts');
    const data = await response.json();
    // 如果http状态码为401, 则跳转到登录页面
    if (response.status === 401) {
        window.location.href = '/login';
        return;
    }
    
    if (data.success) {
        const tbody = document.querySelector('#accountTable tbody');
        const select = document.querySelector('#accountId');
        tbody.innerHTML = '';
        if (updateSelect) {
            select.innerHTML = '' 
        }
        accountsList = data.data
        data.data.forEach(account => {
            const safeUsername = escapeHtml(account.username);
            const cloudType = account.cloudType || (account.original_username?.startsWith('q_') ? 'quark' : 'cloud189');
            const cloudTypeName = cloudType === 'quark' ? '夸克网盘' : '天翼云盘';
            const safeAlias = escapeHtml(account.alias || '');
            const safeAliasArg = escapeJsString(account.alias || '');
            const safeCloudStrmPrefix = escapeHtml(account.cloudStrmPrefix || '');
            const safeCloudStrmPrefixArg = escapeJsString(account.cloudStrmPrefix || '');
            const safeLocalStrmPrefix = escapeHtml(account.localStrmPrefix || '');
            const safeLocalStrmPrefixArg = escapeJsString(account.localStrmPrefix || '');
            const safeEmbyPathReplace = escapeHtml(account.embyPathReplace || '');
            const safeEmbyPathReplaceArg = escapeJsString(account.embyPathReplace || '');
            const personalCapacity = formatCapacityInfo(account.capacity?.cloudCapacityInfo);
            const familyCapacity = formatCapacityInfo(account.capacity?.familyCapacityInfo);
            tbody.innerHTML += `
                <tr>
                    <td><span class="default-star" onclick="setDefaultAccount(${account.id})" title="设为默认账号">
                            ${account.isDefault ? '★' : '☆'}
                        </span>
                         <button class="btn-primary" onclick="editAccount(${account.id})">修改</button>
                        <button class="btn-danger" onclick="deleteAccount(${account.id})">删除</button>
                        </td>
                    <td data-label='账户名'>${safeUsername}</td>
                    <td data-label='网盘类型'>${cloudTypeName}</td>
                    <td data-label='别名' onclick="updateAlias(${account.id}, '${safeAliasArg}')">${safeAlias}</td>
                    <td data-label='个人容量'>${personalCapacity}</td>
                    <td data-label='家庭容量'>${familyCapacity}</td>
                    <td class='strm-prefix' data-label='媒体目录' style="cursor: pointer;" onclick="updateCloudStrmPrefix(${account.id}, '${safeCloudStrmPrefixArg}')">${safeCloudStrmPrefix}</td>
                    <td class='strm-prefix' data-label='本地目录' style="cursor: pointer;" onclick="updateLocalStrmPrefix(${account.id}, '${safeLocalStrmPrefixArg}')">${safeLocalStrmPrefix}</td>
                    <td class='emby-path-replace' data-label='Emby路径替换' style="cursor: pointer;" onclick="updateEmbyPathReplace(${account.id}, '${safeEmbyPathReplaceArg}')">${safeEmbyPathReplace}</td>
                </tr>
            `;
            if (updateSelect) {
                // n_打头的账号不显示在下拉列表中
                if (!account.original_username?.startsWith('n_')) {
                    select.innerHTML += `
                    <option value="${account.id}" data-cloud-type="${cloudType}" ${account.isDefault?"selected":''}>${cloudTypeName} - ${safeUsername}</option>
                `;
                }
            }
        });
        if (updateSelect && typeof syncCreateTaskAccountOptions === 'function') {
            syncCreateTaskAccountOptions();
        }
    }
}

async function deleteAccount(id) {
    if (!confirm('确定要删除这个账号吗？该账号关联的任务和常用目录也会一起删除，但不会删除网盘文件。')) return;
    loading.show()
    const response = await fetch(`/api/accounts/${id}`, {
        method: 'DELETE'
    });
    loading.hide()
    const data = await response.json();
    if (data.success) {
        message.success('账号删除成功');
        fetchAccounts();
    } else {
        message.warning('账号删除失败: ' + data.error);
    }
}

// 添加账号表单处理
function initAccountForm() {
    document.getElementById('accountForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createAccount();
    });
    document.getElementById('cloudType').addEventListener('change', updateAccountFormByCloudType);
}

function openAddAccountModal() {
    chooseAccount = null
    resetCloud189QrLogin();
    resetAccountCaptcha();
    const modal = document.getElementById('addAccountModal');
    modal.style.display = 'block';
    document.getElementById('cloudType').value = 'cloud189';
    updateAccountFormByCloudType();
}

function resetAccountCaptcha() {
    const captchaGroup = document.getElementById('account-captcha');
    const captchaImage = document.getElementById('captchaImage');
    const validateCode = document.getElementById('validateCode');
    const captchaId = document.getElementById('cloud189CaptchaId');
    if (captchaGroup) captchaGroup.style.display = 'none';
    if (captchaImage) captchaImage.src = '';
    if (validateCode) validateCode.value = '';
    if (captchaId) captchaId.value = '';
}

function closeAddAccountModal() {
    resetCloud189QrLogin();
    const modal = document.getElementById('addAccountModal');
    modal.style.display = 'none';
    const modalTitle = modal.querySelector('h3');
    modalTitle.textContent = '添加账号';
    const submitBtn = modal.querySelector('button[type="submit"]');
    submitBtn.textContent = '添加';
    document.getElementById('username').removeAttribute('readonly')
    // 清空表单
    document.getElementById('accountForm').reset();
    document.getElementById('cloudType').value = 'cloud189';
    updateAccountFormByCloudType();
    resetAccountCaptcha();
    chooseAccount = null
}

async function editAccount(id) {
    // 获取账号信息
    chooseAccount = accountsList.find(acc => acc.id === id);
    if (!chooseAccount) {
        message.warning('账号不存在');
        return;
    }
    resetCloud189QrLogin();
    resetAccountCaptcha();

    // 打开模态框
    const modal = document.getElementById('addAccountModal');
    modal.style.display = 'block';

    // 修改标题
    const modalTitle = modal.querySelector('h3');
    modalTitle.textContent = '修改账号';

    // 填充表单数据
    document.getElementById('cloudType').value = chooseAccount.cloudType || (chooseAccount.original_username?.startsWith('q_') ? 'quark' : 'cloud189');
    document.getElementById('username').value = chooseAccount.username;
    document.getElementById('password').value = '';
    document.getElementById('cookie').value = '';
    document.getElementById('alias').value = chooseAccount.alias || '';
    document.getElementById('cloudStrmPrefix').value = chooseAccount.cloudStrmPrefix || '';
    document.getElementById('localStrmPrefix').value = chooseAccount.localStrmPrefix || '';
    document.getElementById('embyPathReplace').value = chooseAccount.embyPathReplace || '';
    // 账号不允许修改
    document.getElementById('username').setAttribute('readonly', true )
    updateAccountFormByCloudType();
    // 修改提交按钮文本
    const submitBtn = modal.querySelector('button[type="submit"]');
    submitBtn.textContent = '修改';
}

async function createAccount() {
    let username = document.getElementById('username').value;
    const cloudType = document.getElementById('cloudType').value;
    const password = document.getElementById('password').value;
    const cookies  = document.getElementById('cookie').value;
    const qrLoginId = document.getElementById('cloud189QrLoginId').value;
    const alias = document.getElementById('alias').value;
    const validateCodeDom = document.getElementById('validateCode')
    const cloudStrmPrefix = document.getElementById('cloudStrmPrefix').value;
    const localStrmPrefix = document.getElementById('localStrmPrefix').value;
    const embyPathReplace = document.getElementById('embyPathReplace').value;
    let validateCode = "";
    if (validateCodeDom) {
        validateCode = validateCodeDom.value;
    }
    const captchaId = document.getElementById('cloud189CaptchaId')?.value || '';
    if (!username ) {
        message.warning('用户名不能为空');
        return;
    }
    if (cloudType === 'quark' && !cookies) {
        message.warning('夸克网盘账号必须填写Cookie');
        return;
    }
    if (cloudType === 'cloud189' && !chooseAccount?.id && !password && !cookies && !qrLoginId) {
        message.warning('天翼云盘账号密码、二维码登录和Cookie不能同时为空');
        return;
    }
    if (chooseAccount?.id) {
        username = chooseAccount.original_username
    }
    loading.show()
    const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chooseAccount?.id, cloudType, username, password, cookies, qrLoginId, alias, validateCode, captchaId, cloudStrmPrefix, localStrmPrefix, embyPathReplace })
    });
    const data = await response.json();
    if (data.success) {
        loading.hide()
        message.success('成功');
        document.getElementById('accountForm').reset();
        if (validateCodeDom) {
            // 移除验证码容器
            document.getElementById('account-captcha').style.display = 'none';
            validateCodeDom.value = ''
            document.getElementById('cloud189CaptchaId').value = ''
        }
        closeAddAccountModal();
        fetchAccounts(true);
    } else {
        loading.hide()
        // 如果返回的code是NEED_CAPTCHA, 则展示二维码和输入框, 允许用户输入验证码后重新提交
        if (data.code === 'NEED_CAPTCHA') {
            // 展示二维码
            document.getElementById('account-captcha').style.display = 'block';
            document.getElementById('captchaImage').src = data.data.captchaUrl;
            document.getElementById('cloud189CaptchaId').value = data.data.captchaId || '';
            message.warning('请输入验证码后重新提交');
        }else{
            message.warning('账号添加失败: ' + data.error);
        }
    }
}

function updateAccountFormByCloudType() {
    const cloudType = document.getElementById('cloudType').value;
    const passwordInput = document.getElementById('password');
    const cookieInput = document.getElementById('cookie');
    const helpText = document.getElementById('accountCredentialHelp');
    const cloudStrmPrefix = document.getElementById('cloudStrmPrefix');
    const qrLoginGroup = document.getElementById('cloud189QrLoginGroup');
    if (cloudType === 'quark') {
        resetCloud189QrLogin();
        passwordInput.placeholder = '夸克网盘无需填写';
        cookieInput.placeholder = '请输入夸克网盘Cookie';
        helpText.textContent = '夸克网盘使用Cookie登录，请填写Cookie。';
        cloudStrmPrefix.placeholder = 'http://alist:5244/d/夸克网盘';
        if (qrLoginGroup) qrLoginGroup.style.display = 'none';
    } else {
        passwordInput.placeholder = '';
        cookieInput.placeholder = '';
        helpText.textContent = '天翼云盘可使用账号密码、二维码登录或Cookie；如果填写账号密码，则优先使用账号密码。';
        cloudStrmPrefix.placeholder = 'http://alist:5244/d/云盘';
        if (qrLoginGroup) qrLoginGroup.style.display = 'block';
    }
}
function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '0B';
    if (bytes < 0) return '-' + formatBytes(-bytes);
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const base = 1024;
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(base)), units.length - 1);
    const value = bytes / Math.pow(base, exponent);
    
    return value.toFixed(exponent > 0 ? 2 : 0) + units[exponent];
}
function formatCapacityInfo(capacityInfo) {
    if (!capacityInfo) return '';
    const usedSize = capacityInfo.usedSize;
    const totalSize = capacityInfo.totalSize;
    if (usedSize === null || usedSize === undefined || usedSize === '' || totalSize === null || totalSize === undefined || totalSize === '') {
        return '';
    }
    const usedBytes = Number(usedSize);
    const totalBytes = Number(totalSize);
    if (!Number.isFinite(usedBytes) || !Number.isFinite(totalBytes)) return '';
    return formatBytes(usedBytes) + '/' + formatBytes(totalBytes);
}
async function clearRecycleBin() {
    if (!confirm('确定要清空所有天翼云盘账号的回收站吗？')) {
        return;
    }
    try {
        const response = await fetch('/api/accounts/recycle', {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            message.success('后台任务执行中, 请稍后查看结果');
        } else {
            message.warning('清空天翼回收站失败: ' + data.error);
        }
    } catch (error) {
        message.warning('操作失败: ' + error.message);
    }
}

// 添加更新 STRM 前缀的函数
async function updateCloudStrmPrefix(id, currentPrefix) {
    const newPrefix = prompt('请输入新的媒体目录前缀', currentPrefix);
    if (newPrefix === null) return; // 用户点击取消
    try {
        const response = await fetch(`/api/accounts/${id}/strm-prefix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strmPrefix: newPrefix, type: 'cloud'  })
        });

        const data = await response.json();
        if (data.success) {
            message.success('更新成功');
            fetchAccounts(true);
        } else {
            message.warning('更新失败: ' + data.error);
        }
    } catch (error) {
        message.warning('操作失败: ' + error.message);
    }
}
async function updateLocalStrmPrefix(id, currentPrefix) {
    const newPrefix = prompt('请输入新的本地目录前缀', currentPrefix);
    if (newPrefix === null) return; // 用户点击取消

    try {
        const response = await fetch(`/api/accounts/${id}/strm-prefix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strmPrefix: newPrefix, type: 'local' })
        });

        const data = await response.json();
        if (data.success) {
            message.success('更新成功');
            fetchAccounts(true);
        } else {
            message.warning('更新失败: ' + data.error);
        }
    } catch (error) {
        message.warning('操作失败: ' + error.message);
    }
}

async function updateEmbyPathReplace(id, embyPathReplace) {
    const newEmbyPathReplace = prompt('请输入新的Emby替换路径', embyPathReplace);
    if (newEmbyPathReplace === null) return; // 用户点击取消

    try {
        const response = await fetch(`/api/accounts/${id}/strm-prefix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strmPrefix: newEmbyPathReplace, type: 'emby' })
        });

        const data = await response.json();
        if (data.success) {
            message.success('更新成功');
            fetchAccounts(true);
        } else {
            message.warning('更新失败: ' + data.error);
        }
    } catch (error) {
        message.warning('操作失败: ' + error.message);
    }
}

async function updateAlias(id, currentAlias) {
    const newAlias = prompt('请输入新的别名', currentAlias);
    if (newAlias === null) return; 
    try {
        const response = await fetch(`/api/accounts/${id}/alias`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias: newAlias })
        })
        const data = await response.json();
        if (data.success) {
            message.success('更新成功');
            fetchAccounts(true);
        } else {
            message.warning('更新失败:'+ data.error);
        }
    } catch (error) {
        message.warning('操作失败:'+ error.message);
    }
}

async function setDefaultAccount(id) {
    try {
        const response = await fetch(`/api/accounts/${id}/default`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (data.success) {
            message.success('设置默认账号成功');
            fetchAccounts(true);  // 更新账号列表和下拉框
        } else {
            message.warning('设置默认账号失败: ' + data.error);
        }
    } catch (error) {
        message.warning('操作失败: ' + error.message);
    }
}
