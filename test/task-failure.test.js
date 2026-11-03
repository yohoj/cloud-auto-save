const test = require('node:test');
const assert = require('node:assert/strict');

const { TaskService } = require('../src/services/task');
const CloudUtils = require('../src/utils/CloudUtils');

function createTaskService() {
    const savedTasks = [];
    const sentMessages = [];
    const service = new TaskService({
        async save(task) {
            savedTasks.push({ ...task });
            return task;
        }
    }, {});
    service.messageUtil = {
        sendMessage(message) {
            sentMessages.push(message);
        }
    };
    service.cloudSaverSDK = { enabled: false };
    return { service, savedTasks, sentMessages };
}

test('分享被好友取消时直接失败且不进入重试队列', async () => {
    const { service, savedTasks, sentMessages } = createTaskService();
    const task = {
        id: 1,
        resourceName: '测试资源',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null
    };

    await service._handleTaskFailure(task, new Error('好友已取消了分享'));

    assert.equal(task.status, 'failed');
    assert.equal(task.retryCount, 0);
    assert.equal(task.nextRetryTime, null);
    assert.match(task.lastError, /好友已取消了分享/);
    assert.doesNotMatch(task.lastError, /重试 1\/3/);
    assert.equal(savedTasks.length, 1);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0], /好友已取消了分享/);
    assert.match(sentMessages[0], /不再重试/);
});

test('分享被取消时使用 CloudSaver 第一个同网盘链接替换并立即重试', async () => {
    const { service, savedTasks, sentMessages } = createTaskService();
    const processedLinks = [];
    service.processTask = async currentTask => {
        processedLinks.push(currentTask.shareLink);
        return 'done';
    };
    service.cloudSaverSDK = {
        enabled: true,
        async search(keyword) {
            assert.equal(keyword, '测试资源');
            return [
                { cloudType: 'quark', cloudLinks: [{ link: 'https://pan.quark.cn/s/other' }] },
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] },
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/SECOND' }] }
            ];
        }
    };
    service.cloudUtils = {
        getShareLinkCloudType: () => 'cloud189',
        isQuarkAccount: () => false,
        parseCloudShare: link => ({ url: link, accessCode: '' }),
        parseShareCode: link => link.split('/').pop(),
        getService: () => ({
            async getShareInfo() {
                return { res_code: 0, shareId: 'new-share', fileId: 'new-file', shareMode: 0, isFolder: true };
            }
        })
    };
    const task = {
        id: 3,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/OLDCODE',
        shareId: 'old-share',
        shareFolderId: 'old-folder',
        shareFolderName: '子目录',
        status: 'processing',
        retryCount: 2,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };

    await service._handleTaskFailure(task, new Error('好友已取消了分享'));

    assert.equal(task.status, 'processing');
    assert.equal(task.retryCount, 0);
    assert.equal(task.nextRetryTime, null);
    assert.equal(task.shareLink, 'https://cloud.189.cn/t/NEWCODE');
    assert.equal(task.shareId, 'new-share');
    assert.equal(task.shareFileId, 'new-file');
    assert.equal(task.shareFolderId, 'new-file');
    assert.equal(task.shareFolderName, '');
    assert.match(task.lastError, /已自动替换分享链接/);
    assert.deepEqual(processedLinks, ['https://cloud.189.cn/t/NEWCODE']);
    assert.equal(savedTasks.length, 1);
    assert.match(sentMessages[0], /已自动替换/);
    assert.match(sentMessages[0], /立即重试/);
    assert.match(sentMessages[0], /NEWCODE/);
});

test('替换后的链接再次失败时按搜索结果顺序尝试下一个', async () => {
    const { service } = createTaskService();
    const processedLinks = [];
    service.processTask = async currentTask => {
        processedLinks.push(currentTask.shareLink);
        return '';
    };
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            return [
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] },
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/SECOND' }] },
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/THIRD' }] }
            ];
        }
    };
    service.cloudUtils = {
        getShareLinkCloudType: () => 'cloud189',
        isQuarkAccount: () => false,
        parseCloudShare: link => ({ url: link, accessCode: '' }),
        parseShareCode: link => link.split('/').pop(),
        getService: () => ({
            async getShareInfo(shareCode) {
                return { res_code: 0, shareId: shareCode, fileId: `${shareCode}-root`, shareMode: 0, isFolder: true };
            }
        })
    };
    const task = {
        id: 7,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/NEWCODE',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };

    await service._handleTaskFailure(task, new Error('好友已取消了分享'));

    assert.equal(task.status, 'processing');
    assert.equal(task.shareLink, 'https://cloud.189.cn/t/SECOND');
    assert.equal(task.shareId, 'SECOND');
    assert.deepEqual(processedLinks, ['https://cloud.189.cn/t/SECOND']);
});

test('连续取消分享时逐个替换且不创建重试任务', async () => {
    const { service, sentMessages } = createTaskService();
    const processedLinks = [];
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            return [
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] },
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/SECOND' }] }
            ];
        }
    };
    service.cloudUtils = {
        getShareLinkCloudType: () => 'cloud189',
        isQuarkAccount: () => false,
        parseCloudShare: link => ({ url: link, accessCode: '' }),
        parseShareCode: link => link.split('/').pop(),
        getService: () => ({
            async getShareInfo(shareCode) {
                return { res_code: 0, shareId: shareCode, fileId: `${shareCode}-root`, shareMode: 0, isFolder: true };
            }
        })
    };
    service.processTask = async currentTask => {
        processedLinks.push(currentTask.shareLink);
        return service._handleTaskFailure(currentTask, new Error('好友已取消了分享'));
    };
    const task = {
        id: 9,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/OLDCODE',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };

    await service._handleTaskFailure(task, new Error('好友已取消了分享'));

    assert.deepEqual(processedLinks, [
        'https://cloud.189.cn/t/NEWCODE',
        'https://cloud.189.cn/t/SECOND'
    ]);
    assert.equal(task.status, 'failed');
    assert.equal(task.retryCount, 0);
    assert.equal(task.nextRetryTime, null);
    assert.match(task.lastError, /不再重试/);
    assert.match(sentMessages[sentMessages.length - 1], /不再重试/);
});

test('搜索结果全部尝试完后直接失败', async () => {
    const { service, sentMessages } = createTaskService();
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            return [
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] },
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/SECOND' }] }
            ];
        }
    };
    service.cloudUtils = {
        getShareLinkCloudType: () => 'cloud189'
    };
    const task = {
        id: 8,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/SECOND',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };

    await service._handleTaskFailure(task, new Error('好友已取消了分享'));

    assert.equal(task.status, 'failed');
    assert.equal(task.retryCount, 0);
    assert.equal(task.nextRetryTime, null);
    assert.match(sentMessages[0], /不再重试/);
});

test('不保存子目录时使用分享根目录下唯一的子目录', async () => {
    const { service, savedTasks } = createTaskService();
    service.processTask = async () => '';
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            return [{ cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] }];
        }
    };
    const listed = [];
    service.cloudUtils = {
        getShareLinkCloudType: () => 'cloud189',
        isQuarkAccount: () => false,
        parseCloudShare: link => ({ url: link, accessCode: '' }),
        parseShareCode: link => link.split('/').pop(),
        getService: () => ({
            async getShareInfo() {
                return { res_code: 0, shareId: 'new-share', fileId: 'new-root', shareMode: 0, isFolder: true };
            },
            async listShareDir(shareId, fileId) {
                listed.push({ shareId, fileId });
                return { fileListAO: { folderList: [{ id: 'sub-id', name: '正片' }] } };
            }
        })
    };
    const task = {
        id: 5,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/OLDCODE',
        saveSubDir: false,
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };

    await service._handleTaskFailure(task, new Error('好友已取消了分享'));

    assert.deepEqual(listed, [{ shareId: 'new-share', fileId: 'new-root' }]);
    assert.equal(task.status, 'processing');
    assert.equal(task.shareFolderId, 'sub-id');
    assert.equal(task.shareFolderName, '正片');
    assert.equal(savedTasks.length, 1);
});

test('不保存子目录且根目录有多个子目录时保持根目录', async () => {
    const { service } = createTaskService();
    service.processTask = async () => '';
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            return [{ cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] }];
        }
    };
    service.cloudUtils = {
        getShareLinkCloudType: () => 'cloud189',
        isQuarkAccount: () => false,
        parseCloudShare: link => ({ url: link, accessCode: '' }),
        parseShareCode: link => link.split('/').pop(),
        getService: () => ({
            async getShareInfo() {
                return { res_code: 0, shareId: 'new-share', fileId: 'new-root', shareMode: 0, isFolder: true };
            },
            async listShareDir() {
                return { fileListAO: { folderList: [{ id: 'sub-1', name: '第一季' }, { id: 'sub-2', name: '第二季' }] } };
            }
        })
    };
    const task = {
        id: 6,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/OLDCODE',
        saveSubDir: false,
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };

    await service._handleTaskFailure(task, new Error('好友已取消了分享'));

    assert.equal(task.status, 'processing');
    assert.equal(task.shareFolderId, 'new-root');
    assert.equal(task.shareFolderName, '');
});

test('分享被取消且无同网盘结果时仍直接失败', async () => {
    const { service, savedTasks, sentMessages } = createTaskService();
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            return [
                { cloudType: 'quark', cloudLinks: [{ link: 'https://pan.quark.cn/s/other' }] },
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/OLDCODE' }] }
            ];
        }
    };
    service.cloudUtils = {
        getShareLinkCloudType: () => 'cloud189'
    };
    const task = {
        id: 4,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/OLDCODE',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };

    await service._handleTaskFailure(task, new Error('好友已取消了分享'));

    assert.equal(task.status, 'failed');
    assert.equal(task.retryCount, 0);
    assert.equal(task.nextRetryTime, null);
    assert.equal(savedTasks.length, 1);
    assert.match(sentMessages[0], /不再重试/);
});

test('临时失败仍按配置进入重试队列', async () => {
    const { service, sentMessages } = createTaskService();
    const task = {
        id: 2,
        resourceName: '测试资源',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null
    };

    await service._handleTaskFailure(task, new Error('临时网络错误'));

    assert.equal(task.status, 'pending');
    assert.equal(task.retryCount, 1);
    assert.ok(task.nextRetryTime instanceof Date);
    assert.match(task.lastError, /临时网络错误 \(重试 1\/3\)/);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0], /正在重试\(1\/3\)/);
});

function stubCloudUtils(shareInfoHandler) {
    return {
        getShareLinkCloudType: () => 'cloud189',
        isQuarkAccount: () => false,
        parseCloudShare: link => ({ url: link, accessCode: '' }),
        parseShareCode: link => link.split('/').pop(),
        getService: () => ({
            async getShareInfo(shareCode) {
                return shareInfoHandler(shareCode);
            }
        })
    };
}

function validShareInfo(shareCode) {
    return { res_code: 0, shareId: shareCode, fileId: `${shareCode}-root`, shareMode: 0, isFolder: true };
}

test('分享过期或被删除时同样自动替换链接并立即重试', async () => {
    const { service, savedTasks, sentMessages } = createTaskService();
    const processedLinks = [];
    service.processTask = async currentTask => {
        processedLinks.push(currentTask.shareLink);
        return 'done';
    };
    service.cloudSaverSDK = {
        enabled: true,
        async search(keyword) {
            assert.equal(keyword, '测试资源');
            return [{ cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] }];
        }
    };
    service.cloudUtils = stubCloudUtils(validShareInfo);
    const task = {
        id: 11,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/OLDCODE',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };

    await service._handleTaskFailure(task, new Error('分享不存在'));

    assert.equal(task.status, 'processing');
    assert.equal(task.shareLink, 'https://cloud.189.cn/t/NEWCODE');
    assert.deepEqual(processedLinks, ['https://cloud.189.cn/t/NEWCODE']);
    assert.equal(savedTasks.length, 1);
    assert.match(sentMessages[0], /分享已失效/);
    assert.match(sentMessages[0], /分享不存在/);
});

test('接口层标记为分享失效的错误同样触发自动替换', async () => {
    const { service } = createTaskService();
    const processedLinks = [];
    service.processTask = async currentTask => {
        processedLinks.push(currentTask.shareLink);
        return 'done';
    };
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            return [{ cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] }];
        }
    };
    service.cloudUtils = stubCloudUtils(validShareInfo);
    const task = {
        id: 12,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/OLDCODE',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };
    const error = Object.assign(new Error('获取文件列表失败'), { invalidShare: true });

    await service._handleTaskFailure(task, error);

    assert.equal(task.status, 'processing');
    assert.equal(task.shareLink, 'https://cloud.189.cn/t/NEWCODE');
    assert.deepEqual(processedLinks, ['https://cloud.189.cn/t/NEWCODE']);
});

test('无法确认分享失效的列表错误不会触发自动换链', async () => {
    const { service } = createTaskService();
    let searchCalled = 0;
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            searchCalled++;
            return [{ cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] }];
        }
    };
    const task = {
        id: 13,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/OLDCODE',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };

    await service._handleTaskFailure(task, new Error('获取文件列表失败'));

    assert.equal(searchCalled, 0);
    assert.equal(task.status, 'pending');
    assert.equal(task.retryCount, 1);
    assert.equal(task.shareLink, 'https://cloud.189.cn/t/OLDCODE');
});

test('搜索到的候选链接已失效时自动尝试下一个', async () => {
    const { service, savedTasks } = createTaskService();
    const processedLinks = [];
    service.processTask = async currentTask => {
        processedLinks.push(currentTask.shareLink);
        return 'done';
    };
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            return [
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/DEAD' }] },
                { cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] }
            ];
        }
    };
    service.cloudUtils = stubCloudUtils(shareCode => {
        if (shareCode === 'DEAD') {
            return { res_code: 'ShareNotFound', res_msg: '分享不存在' };
        }
        return validShareInfo(shareCode);
    });
    const task = {
        id: 14,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/OLDCODE',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null,
        account: { cloudType: 'cloud189' }
    };

    await service._handleTaskFailure(task, new Error('分享已失效'));

    assert.equal(task.status, 'processing');
    assert.equal(task.shareLink, 'https://cloud.189.cn/t/NEWCODE');
    assert.deepEqual(processedLinks, ['https://cloud.189.cn/t/NEWCODE']);
    assert.equal(savedTasks.length, 1);
});


test('任务执行时发现分享失效会自动换链并立即重试', async () => {
    const account = { id: 1, username: 'u_test', cloudType: 'cloud189' };
    const service = new TaskService({
        async save(task) {
            return task;
        }
    }, {
        async findOneBy() {
            return account;
        }
    });
    const sentMessages = [];
    service.messageUtil = {
        sendMessage(message) {
            sentMessages.push(message);
        }
    };
    // 目标目录已存在, 无需真实查询
    service.getAllFolderFiles = async () => [];
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            return [{ cloudType: 'cloud189', cloudLinks: [{ link: 'https://cloud.189.cn/t/NEWCODE' }] }];
        }
    };

    // 第一次列目录返回分享失效，换链后再次列目录为空
    let listShareDirCalls = 0;
    const cloud = {
        async listShareDir() {
            listShareDirCalls++;
            if (listShareDirCalls === 1) {
                return { res_code: 'ShareNotFound', res_msg: '分享不存在' };
            }
            return { fileListAO: { fileList: [], folderList: [] } };
        },
        async getShareInfo() {
            return { res_code: 0, shareId: 'new-share', fileId: 'new-root', shareMode: 0, isFolder: true };
        }
    };
    const originalGetService = CloudUtils.getService;
    CloudUtils.getService = () => cloud;
    const task = {
        id: 21,
        accountId: 1,
        resourceName: '测试资源',
        shareLink: 'https://cloud.189.cn/t/OLDCODE',
        shareId: 'old-share',
        shareFolderId: 'old-root',
        shareMode: 0,
        isFolder: true,
        saveSubDir: true,
        status: 'pending',
        retryCount: 0,
        nextRetryTime: null
    };

    try {
        await service.processTask(task);
    } finally {
        CloudUtils.getService = originalGetService;
    }

    assert.equal(listShareDirCalls, 2);
    assert.equal(task.shareLink, 'https://cloud.189.cn/t/NEWCODE');
    assert.equal(task.shareId, 'new-share');
    assert.equal(task.shareFolderId, 'new-root');
    assert.equal(task.lastError, '分享不存在 (已自动替换分享链接，正在重试)');
    assert.match(sentMessages[0], /分享已失效/);
    assert.match(sentMessages[0], /NEWCODE/);
});

test('夸克分享stoken过期时只刷新token，不触发自动换链', async () => {
    const account = { id: 2, username: 'q_test', cloudType: 'quark' };
    const service = new TaskService({
        async save(task) {
            return task;
        }
    }, {
        async findOneBy() {
            return account;
        }
    });
    const sentMessages = [];
    service.messageUtil = {
        sendMessage(message) {
            sentMessages.push(message);
        }
    };
    // 目标目录已存在, 无需真实查询
    service.getAllFolderFiles = async () => [];
    let searchCalls = 0;
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            searchCalls++;
            return [{ cloudType: 'quark', cloudLinks: [{ link: 'https://pan.quark.cn/s/new' }] }];
        }
    };

    // 第一次列目录返回 stoken 过期，刷新后即可正常列目录
    let listShareDirCalls = 0;
    const cloud = {
        async listShareDir() {
            listShareDirCalls++;
            if (listShareDirCalls === 1) {
                return { status: 404, code: 41016, res_code: 41016, res_msg: '分享的stoken过期', message: '分享的stoken过期' };
            }
            return { fileListAO: { fileList: [], folderList: [] } };
        },
        async getShareInfo() {
            return { res_code: 0, shareId: 'share-1', fileId: 'file-1', shareMode: 'new-stoken', stoken: 'new-stoken' };
        }
    };
    const originalGetService = CloudUtils.getService;
    CloudUtils.getService = () => cloud;
    const task = {
        id: 31,
        accountId: 2,
        resourceName: '夸克资源',
        shareLink: 'https://pan.quark.cn/s/abc',
        shareId: 'share-1',
        shareFolderId: 'file-1',
        shareMode: 'old-stoken',
        accessCode: '',
        isFolder: true,
        saveSubDir: true,
        status: 'pending',
        retryCount: 0,
        nextRetryTime: null
    };

    try {
        await service.processTask(task);
    } finally {
        CloudUtils.getService = originalGetService;
    }

    assert.equal(listShareDirCalls, 2);
    assert.equal(task.shareMode, 'new-stoken');
    assert.equal(searchCalls, 0);
    assert.equal(task.shareLink, 'https://pan.quark.cn/s/abc');
    assert.equal(task.lastError, undefined);
    assert.equal(sentMessages.length, 0);
});

test('夸克分享地址失效(41011)时自动换链并立即重试', async () => {
    const account = { id: 3, username: 'q_test2', cloudType: 'quark' };
    const service = new TaskService({
        async save(task) {
            return task;
        }
    }, {
        async findOneBy() {
            return account;
        }
    });
    const sentMessages = [];
    service.messageUtil = {
        sendMessage(message) {
            sentMessages.push(message);
        }
    };
    // 目标目录已存在, 无需真实查询
    service.getAllFolderFiles = async () => [];
    let searchCalls = 0;
    service.cloudSaverSDK = {
        enabled: true,
        async search() {
            searchCalls++;
            return [{ cloudType: 'quark', cloudLinks: [{ link: 'https://pan.quark.cn/s/newcode' }] }];
        }
    };

    // 第一次列目录返回夸克 41011「分享地址已失效」，换链后再次列目录为空
    let listShareDirCalls = 0;
    const cloud = {
        async listShareDir() {
            listShareDirCalls++;
            if (listShareDirCalls === 1) {
                return { status: 404, code: 41011, res_code: 41011, res_msg: '分享地址已失效', message: '分享地址已失效' };
            }
            return { fileListAO: { fileList: [], folderList: [] } };
        },
        async getShareInfo() {
            return {
                res_code: 0,
                shareId: 'new-share',
                fileId: 'new-root',
                shareMode: 'new-stoken',
                stoken: 'new-stoken',
                isFolder: true
            };
        }
    };
    const originalGetService = CloudUtils.getService;
    CloudUtils.getService = () => cloud;
    const task = {
        id: 41,
        accountId: 3,
        resourceName: '夸克资源',
        shareLink: 'https://pan.quark.cn/s/oldcode',
        shareId: 'old-share',
        shareFolderId: 'old-root',
        shareMode: 'old-stoken',
        accessCode: '',
        isFolder: true,
        saveSubDir: true,
        status: 'pending',
        retryCount: 0,
        nextRetryTime: null
    };

    try {
        await service.processTask(task);
    } finally {
        CloudUtils.getService = originalGetService;
    }

    assert.equal(listShareDirCalls, 2);
    assert.equal(searchCalls, 1);
    assert.equal(task.shareLink, 'https://pan.quark.cn/s/newcode');
    assert.equal(task.shareId, 'new-share');
    assert.equal(task.lastError, '分享地址已失效 (已自动替换分享链接，正在重试)');
    assert.match(sentMessages[0], /分享已失效/);
    assert.match(sentMessages[0], /分享地址已失效/);
    assert.match(sentMessages[0], /newcode/);
});
