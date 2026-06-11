require('dotenv').config();
const express = require('express');
const { AppDataSource } = require('./database');
const { Account, Task, CommonFolder } = require('./entities');
const { TaskService } = require('./services/task');
const CloudUtils = require('./utils/CloudUtils');
const { MessageUtil } = require('./services/message');
const { CacheManager } = require('./services/CacheManager')
const ConfigService = require('./services/ConfigService');
const packageJson = require('../package.json');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const { SchedulerService } = require('./services/scheduler');
const { logTaskEvent, initSSE, sendAIMessage } = require('./utils/logUtils');
const TelegramBotManager = require('./utils/TelegramBotManager');
const fsSync = require('fs');
const fs = fsSync.promises;
const path = require('path');
const { setupCloudSaverRoutes, clearCloudSaverToken } = require('./sdk/cloudsaver');
const { Like, Not, IsNull, In, Or } = require('typeorm');
const cors = require('cors'); 
const { EmbyService } = require('./services/emby');
const { StrmService } = require('./services/strm');
const AIService = require('./services/ai');
const CustomPushService = require('./services/message/CustomPushService');
const { FileTokenStore } = require('cloud189-sdk');
const crypto = require('crypto');
const got = require('got');
const QRCode = require('qrcode');

const app = express();
const configuredOrigins = (process.env.CORS_ORIGINS || ConfigService.getConfigValue('system.corsOrigins') || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
app.use(cors({
    origin: configuredOrigins.length > 0 ? configuredOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-api-key'],
    credentials: configuredOrigins.length > 0
}));
app.use(express.json());

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cloud189QrLogins = new Map();
const CLOUD189_QR_TTL_MS = 4 * 60 * 1000;
const CLOUD189_QR_CONSUME_TTL_MS = 10 * 60 * 1000;
const CLOUD189_TOKEN_TTL_MS = 6 * 24 * 60 * 60 * 1000;
const CLOUD189_TV_API_URL = 'https://api.cloud.189.cn';
const CLOUD189_TV_APP_KEY = '600100885';
const CLOUD189_TV_APP_SECRET = 'fe5734c74c2f96a38157f420b32dc995';
const CLOUD189_TV_CLIENT_SUFFIX = {
    clientType: 'FAMILY_TV',
    version: '6.5.5',
    channelId: 'home02',
    clientSn: 'unknown',
    model: 'PJX110',
    osFamily: 'Android',
    osVersion: '35',
    networkAccessMode: 'WIFI',
    telecomsOperator: '46011'
};
const CLOUD189_TV_HEADERS = {
    Accept: 'application/json;charset=UTF-8',
    'User-Agent': 'EcloudTV/6.5.5 (PJX110; unknown; home02) Android/35'
};
const CLOUD189_PC_APP_ID = '8025431004';
const CLOUD189_PC_CLIENT_SUFFIX = {
    clientType: 'TELEPC',
    version: '6.2',
    channelId: 'web_cloud.189.cn'
};

function cleanupCloud189QrLogins() {
    const now = Date.now();
    for (const [id, login] of cloud189QrLogins.entries()) {
        if (login.expiresAt < now) {
            cloud189QrLogins.delete(id);
        }
    }
}

function assertSafeCloud189Username(username) {
    if (!username || /[\\/]/.test(username)) {
        throw new Error('二维码登录未返回有效账号');
    }
}

function getCloud189TvSignatureHeaders(url, method) {
    const timestamp = Date.now();
    const requestUri = new URL(url).pathname;
    const signText = `AppKey=${CLOUD189_TV_APP_KEY}&Operate=${method}&RequestURI=${requestUri}&Timestamp=${timestamp}`;
    return {
        Timestamp: String(timestamp),
        'X-Request-ID': crypto.randomUUID(),
        AppKey: CLOUD189_TV_APP_KEY,
        AppSignature: crypto.createHmac('sha1', CLOUD189_TV_APP_SECRET)
            .update(signText)
            .digest('hex')
            .toUpperCase()
    };
}

function parseCloud189TvError(error) {
    const rawBody = error.response?.body;
    if (!rawBody) {
        throw error;
    }
    try {
        return JSON.parse(rawBody);
    } catch (parseError) {
        throw error;
    }
}

async function requestCloud189Tv(action, method, searchParams = {}) {
    const url = `${CLOUD189_TV_API_URL}${action}`;
    try {
        return await got(url, {
            method,
            searchParams: {
                ...CLOUD189_TV_CLIENT_SUFFIX,
                ...searchParams
            },
            headers: {
                ...CLOUD189_TV_HEADERS,
                ...getCloud189TvSignatureHeaders(url, method)
            },
            dnsLookupIpVersion: 'ipv4',
            timeout: { request: 30000 }
        }).json();
    } catch (error) {
        if (error instanceof got.HTTPError) {
            return parseCloud189TvError(error);
        }
        throw error;
    }
}

async function getCloud189PcSession(accessToken) {
    try {
        return await got(`${CLOUD189_TV_API_URL}/getSessionForPC.action`, {
            method: 'POST',
            searchParams: {
                appId: CLOUD189_PC_APP_ID,
                ...CLOUD189_PC_CLIENT_SUFFIX,
                rand: Date.now(),
                accessToken
            },
            headers: {
                Accept: 'application/json;charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36'
            },
            dnsLookupIpVersion: 'ipv4',
            timeout: { request: 30000 }
        }).json();
    } catch (error) {
        if (error instanceof got.HTTPError) {
            return parseCloud189TvError(error);
        }
        throw error;
    }
}

const publicDirs = [
    path.join(__dirname, 'public'),
    path.join(__dirname, '../src/public')
];
const getPublicFile = (fileName) => {
    const filePath = publicDirs
        .map(publicDir => path.join(publicDir, fileName))
        .find(candidate => fsSync.existsSync(candidate));
    return filePath || path.join(publicDirs[0], fileName);
};

app.use(session({
    store: new FileStore({
        path: './data/sessions',  // session文件存储路径
        ttl: 30 * 24 * 60 * 60,  // session过期时间，单位秒
        reapInterval: 3600,       // 清理过期session间隔，单位秒
        retries: 0,           // 设置重试次数为0
        logFn: () => {},      // 禁用内部日志
        reapAsync: true,      // 异步清理过期session
    }),
    secret: ConfigService.getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000 * 30 // 30天
    }
}));


// 验证会话的中间件
const authenticateSession = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const configApiKey = ConfigService.getConfigValue('system.apiKey');
    if (apiKey && configApiKey && apiKey === configApiKey) {
        return next();
    }
    if (req.session.authenticated) {
        next();
    } else {
        // API 请求返回 401，页面请求重定向到登录页
        if (req.path.startsWith('/api/')) {
            res.status(401).json({ success: false, error: '未登录' });
        } else {
            res.redirect('/login');
        }
    }
};

// 添加根路径处理
app.get('/', (req, res) => {
    if (!req.session.authenticated) {
        res.redirect('/login');
    } else {
        res.sendFile(getPublicFile('index.html'));
    }
});


// 登录页面
app.get('/login', (req, res) => {
    res.sendFile(getPublicFile('login.html'));
});

// 登录接口
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ConfigService.getConfigValue('system.username') && 
        password === ConfigService.getConfigValue('system.password')) {
        req.session.authenticated = true;
        req.session.username = username;
        res.json({ success: true });
    } else {
        res.json({ success: false, error: '用户名或密码错误' });
    }
});
publicDirs
    .filter(publicDir => fsSync.existsSync(publicDir))
    .forEach(publicDir => app.use(express.static(publicDir)));
// 为所有路由添加认证（除了登录页和登录接口）
app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/login' 
        || req.path === '/api/auth/login' 
        || req.path === '/api/auth/login' 
        || req.path === '/emby/notify'
        || req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico)$/)) {
        return next();
    }
    authenticateSession(req, res, next);
});
// 初始化数据库连接
AppDataSource.initialize().then(async () => {
    // 当前版本:
    const currentVersion = packageJson.version;
    console.log(`当前系统版本: ${currentVersion}`);
    console.log('数据库连接成功');

    // 初始化 STRM 目录权限
    const strmBaseDir = path.join(__dirname, '../strm');
    try {
        await fs.mkdir(strmBaseDir, { recursive: true });
        if (process.getuid && process.getuid() === 0) {
            await fs.chown(strmBaseDir, parseInt(process.env.PUID || 0), parseInt(process.env.PGID || 0));
        }
        await fs.chmod(strmBaseDir, parseInt(process.env.STRM_DIR_MODE || '775', 8));
        console.log('STRM目录权限初始化完成');
    } catch (error) {
        console.error('STRM目录权限初始化失败:', error);
    }

    try {
        const accountColumns = await AppDataSource.query("PRAGMA table_info('account')");
        if (!accountColumns.some(column => column.name === 'cloudType')) {
            await AppDataSource.query("ALTER TABLE account ADD COLUMN cloudType text DEFAULT 'cloud189'");
            await AppDataSource.query("UPDATE account SET cloudType = 'quark' WHERE username LIKE 'q\\_%' ESCAPE '\\'");
            console.log('账号网盘类型字段初始化完成');
        }
    } catch (error) {
        console.error('账号网盘类型字段初始化失败:', error);
    }

    const accountRepo = AppDataSource.getRepository(Account);
    const taskRepo = AppDataSource.getRepository(Task);
    const commonFolderRepo = AppDataSource.getRepository(CommonFolder);
    const taskService = new TaskService(taskRepo, accountRepo);
    const embyService = new EmbyService(taskService)
    const messageUtil = new MessageUtil();
    // 机器人管理
    const botManager = TelegramBotManager.getInstance();
    // 初始化机器人
    await botManager.handleBotStatus(
        ConfigService.getConfigValue('telegram.bot.botToken'),
        ConfigService.getConfigValue('telegram.bot.chatId'),
        ConfigService.getConfigValue('telegram.bot.enable')
    );
    // 初始化缓存管理器
    const folderCache = new CacheManager(parseInt(600));
    // 初始化任务定时器
    await SchedulerService.initTaskJobs(taskRepo, taskService);
    
    // 账号相关API
    app.get('/api/accounts', asyncHandler(async (req, res) => {
        const accounts = await accountRepo.find();
        // 获取容量
        for (const account of accounts) {
            account.cloudType = account.cloudType || (account.username.startsWith('q_') ? 'quark' : 'cloud189');
            
            account.capacity = {
                cloudCapacityInfo: null,
                familyCapacityInfo: null
            }
            // n_ 开头的账号用于占位/通知，不参与网盘容量查询
            if (!account.username.startsWith('n_')) {
                const cloud189 = CloudUtils.getService(account);
                const capacity = await cloud189.getUserSizeInfo()
                if (capacity && capacity.res_code == 0) {
                    if (capacity.cloudCapacityInfo) {
                        account.capacity.cloudCapacityInfo = capacity.cloudCapacityInfo;
                    }
                    if (capacity.familyCapacityInfo) {
                        account.capacity.familyCapacityInfo = capacity.familyCapacityInfo;
                    }
                }
            }
            account.original_username = account.username;
            // username脱敏
            account.username = account.username.replace(/(.{3}).*(.{4})/, '$1****$2');
            delete account.password;
            delete account.cookies;
        }
        res.json({ success: true, data: accounts });
    }));

    app.post('/api/accounts/cloud189/qrcode', asyncHandler(async (req, res) => {
        cleanupCloud189QrLogins();
        const uuidRes = await requestCloud189Tv('/family/manage/getQrCodeUUID.action', 'GET');

        if (!uuidRes || !uuidRes.uuid) {
            throw new Error('获取天翼云盘二维码失败');
        }

        const qrId = crypto.randomUUID();
        const imageUrl = await QRCode.toDataURL(uuidRes.uuid, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 256
        });
        cloud189QrLogins.set(qrId, {
            uuid: uuidRes.uuid,
            expiresAt: Date.now() + CLOUD189_QR_TTL_MS,
            tokenSession: null,
            username: ''
        });

        res.json({
            success: true,
            data: {
                qrId,
                uuid: uuidRes.uuid,
                expiresIn: Math.floor(CLOUD189_QR_TTL_MS / 1000),
                imageUrl
            }
        });
    }));

    app.get('/api/accounts/cloud189/qrcode/:qrId', asyncHandler(async (req, res) => {
        cleanupCloud189QrLogins();
        const qrLogin = cloud189QrLogins.get(req.params.qrId);
        if (!qrLogin) {
            res.json({ success: true, data: { status: 'expired' } });
            return;
        }

        if (qrLogin.tokenSession) {
            res.json({
                success: true,
                data: {
                    status: 'success',
                    qrLoginId: req.params.qrId,
                    username: qrLogin.username
                }
            });
            return;
        }

        const accessTokenResp = await requestCloud189Tv('/family/manage/qrcodeLoginResult.action', 'GET', {
            uuid: qrLogin.uuid
        });
        if (accessTokenResp.accessToken) {
            let tokenSession = await getCloud189PcSession(accessTokenResp.accessToken);
            if (!tokenSession.accessToken || !tokenSession.loginName) {
                const tvSession = await requestCloud189Tv('/family/manage/loginFamilyMerge.action', 'GET', {
                    e189AccessToken: accessTokenResp.accessToken
                });
                tokenSession = {
                    ...tvSession,
                    accessToken: tvSession.accessToken || accessTokenResp.accessToken,
                    refreshToken: tvSession.refreshToken || accessTokenResp.refreshToken || accessTokenResp.refresh_token || '',
                    loginName: tvSession.loginName
                };
            }
            if (!tokenSession.accessToken) {
                throw new Error(tokenSession.res_message || tokenSession.message || '二维码登录未返回有效会话');
            }
            tokenSession.refreshToken = tokenSession.refreshToken || accessTokenResp.refreshToken || accessTokenResp.refresh_token || '';
            const username = tokenSession.loginName;
            assertSafeCloud189Username(username);
            qrLogin.tokenSession = tokenSession;
            qrLogin.username = username;
            qrLogin.expiresAt = Date.now() + CLOUD189_QR_CONSUME_TTL_MS;
            res.json({
                success: true,
                data: {
                    status: 'success',
                    qrLoginId: req.params.qrId,
                    username
                }
            });
            return;
        }

        if (accessTokenResp.res_code === 'QrCodeRollLoginFail') {
            res.json({ success: true, data: { status: 'waiting' } });
            return;
        }

        throw new Error(accessTokenResp.res_message || accessTokenResp.message || '二维码登录失败');
    }));

    app.post('/api/accounts', async (req, res) => {
        try {
            const qrLoginId = req.body.qrLoginId;
            const qrLogin = qrLoginId ? cloud189QrLogins.get(qrLoginId) : null;
            if (qrLoginId && (!qrLogin || !qrLogin.tokenSession || qrLogin.expiresAt < Date.now())) {
                throw new Error('二维码登录已失效，请重新扫码');
            }

            let account = accountRepo.create(req.body);
            if (qrLogin) {
                account.cloudType = 'cloud189';
                account.username = qrLogin.username;
                account.password = '';
                account.cookies = '';
            }
            if (req.body.id) {
                const existingAccount = await accountRepo.findOneBy({ id: parseInt(req.body.id) });
                if (!existingAccount) throw new Error('账号不存在');
                account = accountRepo.merge(existingAccount, req.body);
                if (qrLogin) {
                    if (qrLogin.username !== existingAccount.username) {
                        throw new Error('二维码登录账号与当前账号不一致');
                    }
                    account.cloudType = 'cloud189';
                    account.username = existingAccount.username;
                    account.password = '';
                    account.cookies = '';
                }
                if (!qrLogin && !req.body.password) {
                    account.password = existingAccount.password;
                }
                if (!qrLogin && !req.body.cookies) {
                    account.cookies = existingAccount.cookies;
                }
            }
            account.cloudType = account.cloudType || (account.username.startsWith('q_') ? 'quark' : 'cloud189');
            if (!['cloud189', 'quark'].includes(account.cloudType)) {
                throw new Error('无效的网盘类型');
            }
            if (CloudUtils.isQuarkAccount(account)) {
                if (!account.cookies) {
                    throw new Error('夸克网盘账号请填写 Cookie');
                }
                const quark = CloudUtils.getService(account);
                const folders = await quark.getFolderNodes('0');
                if (!folders) {
                    throw new Error('夸克 Cookie 验证失败');
                }
            }
            // 天翼账号尝试登录, 登录成功写入store, 如果需要验证码, 则返回用户验证码图片
            if (CloudUtils.isCloud189Account(account) && !account.username.startsWith('n_') && req.body.password) {
                // 尝试登录
                const cloud189 = CloudUtils.getService(account);
                const loginResult = await cloud189.login(account.username, account.password, req.body.validateCode);
                if (!loginResult.success) {
                    if (loginResult.code == "NEED_CAPTCHA") {
                        res.json({
                            success: false,
                            code: "NEED_CAPTCHA",
                            data: {
                                captchaUrl: loginResult.data
                            }
                        });
                        return;
                    }
                    res.json({ success: false, error: loginResult.message });
                    return;
                }
            }
            if (qrLogin) {
                const tokenStore = new FileTokenStore(`data/${account.username}.json`);
                await tokenStore.update({
                    accessToken: qrLogin.tokenSession.accessToken,
                    refreshToken: qrLogin.tokenSession.refreshToken || '',
                    expiresIn: Date.now() + CLOUD189_TOKEN_TTL_MS
                });
                cloud189QrLogins.delete(qrLoginId);
            }
            await accountRepo.save(account);
            CloudUtils.removeInstance(account.username);
            res.json({ success: true, data: null });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

     // 清空回收站
     app.delete('/api/accounts/recycle', async (req, res) => {
        try {
            taskService.clearRecycleBin(true, true);
            res.json({ success: true, data: "ok" });
        }catch (error) {
            res.json({ success: false, error: error.message });
        }
    })

    app.delete('/api/accounts/:id', async (req, res) => {
        try {
            const accountId = parseInt(req.params.id);
            const account = await accountRepo.findOneBy({ id: accountId });
            if (!account) throw new Error('账号不存在');
            const tasks = await taskRepo.find({
                where: { accountId },
                select: {
                    id: true
                }
            });
            await AppDataSource.transaction(async manager => {
                await manager.getRepository(CommonFolder).delete({ accountId });
                await manager.getRepository(Task).delete({ accountId });
                await manager.getRepository(Account).delete({ id: accountId });
            });
            for (const task of tasks) {
                SchedulerService.removeTaskJob(task.id);
            }
            CloudUtils.removeInstance(account.username);
            res.json({ success: true });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });
    app.put('/api/accounts/:id/strm-prefix', async (req, res) => {
        try {
            const accountId = parseInt(req.params.id);
            const { strmPrefix, type } = req.body;
            const account = await accountRepo.findOneBy({ id: accountId });
            if (!account) throw new Error('账号不存在');
            if (type == 'local') {
                account.localStrmPrefix = strmPrefix;
            }
            if (type == 'cloud') {
                account.cloudStrmPrefix = strmPrefix;
            }
            if (type == 'emby') {
                account.embyPathReplace = strmPrefix;
            }
            await accountRepo.save(account);
            res.json({ success: true });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    })

    // 修改别名
    app.put('/api/accounts/:id/alias', async (req, res) => {
        try {
            const accountId = parseInt(req.params.id);
            const { alias } = req.body;
            const account = await accountRepo.findOneBy({ id: accountId });
            if (!account) throw new Error('账号不存在');
            account.alias = alias;
            await accountRepo.save(account);
            res.json({ success: true });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    })
    app.put('/api/accounts/:id/default', async (req, res) => {
        try {
            const accountId = parseInt(req.params.id);
            // 清除所有账号的默认状态
            await accountRepo.update({}, { isDefault: false });
            // 设置指定账号为默认
            await accountRepo.update({ id: accountId }, { isDefault: true });
            res.json({ success: true });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    })
    // 任务相关API
    app.get('/api/tasks', asyncHandler(async (req, res) => {
        const { status, search } = req.query;
        let whereClause = { }; // 用于构建最终的 where 条件

        // 基础条件（AND）
        if (status && status !== 'all') {
            whereClause.status = status;
        }
        whereClause.enableSystemProxy = Or(IsNull(), false);

        // 添加搜索过滤
        if (search) {
            const searchConditions = [
                { realFolderName: Like(`%${search}%`) },
                { remark: Like(`%${search}%`) },
                { account: { username: Like(`%${search}%`) } }
            ];
            if (Object.keys(whereClause).length > 0) {
                whereClause = searchConditions.map(searchCond => ({
                    ...whereClause, // 包含基础条件 (如 status)
                    ...searchCond   // 包含一个搜索条件
                }));
            }else{
                whereClause = searchConditions;
            }
        }
        const tasks = await taskRepo.find({
            order: { id: 'DESC' },
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    cloudType: true
                }
            },
            where: whereClause
        });
        // username脱敏
        tasks.forEach(task => {
            task.account.username = task.account.username.replace(/(.{3}).*(.{4})/, '$1****$2');
        });
        res.json({ success: true, data: tasks });
    }));

    app.post('/api/tasks', async (req, res) => {
        try {
            const task = await taskService.createTask(req.body);
            res.json({ success: true, data: task });
        } catch (error) {
            console.log(error)
            res.json({ success: false, error: error.message });
        }
    });

    app.delete('/api/tasks/batch', async (req, res) => {
        try {
            const taskIds = req.body.taskIds;
            const deleteCloud = req.body.deleteCloud;
            await taskService.deleteTasks(taskIds, deleteCloud);
            res.json({ success: true });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    // 删除任务文件
    app.delete('/api/tasks/files', async (req, res) => {
        try{
            const { taskId, files } = req.body;
            if (!files || files.length === 0) {
                throw new Error('未选择要删除的文件');
            }
            await taskService.deleteFiles(taskId, files);
            res.json({ success: true, data: null });
        }catch (error) {
            res.json({ success: false, error: error.message });
        }
    })

    app.delete('/api/tasks/:id', async (req, res) => {
        try {
            const deleteCloud = req.body.deleteCloud;
            await taskService.deleteTask(parseInt(req.params.id), deleteCloud);
            res.json({ success: true });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });


    app.put('/api/tasks/:id', async (req, res) => {
        try {
            const taskId = parseInt(req.params.id);
            const updatedTask = await taskService.updateTask(taskId, req.body);
            res.json({ success: true, data: updatedTask });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    app.post('/api/tasks/:id/execute', async (req, res) => {
        try {
            const task = await taskRepo.findOne({
                where: { id: parseInt(req.params.id) },
                relations: {
                    account: true
                },
                select: {
                    account: {
                        username: true,
                        cloudType: true,
                        localStrmPrefix: true,
                        cloudStrmPrefix: true,
                        embyPathReplace: true
                    }
                }
            });
            if (!task) throw new Error('任务不存在');
            logTaskEvent(`================================`);
            const taskName = task.shareFolderName?(task.resourceName + '/' + task.shareFolderName): task.resourceName || '未知'
            logTaskEvent(`任务[${taskName}]开始执行`);
            const result = await taskService.processTask(task);
            if (result) {
                messageUtil.sendMessage(result)
            }
            res.json({ success: true, data: result });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });
    // 根据任务生成STRM文件
    app.post('/api/tasks/strm', async (req, res) => {
        try {
            const taskIds = req.body.taskIds;
            if (!taskIds || taskIds.length == 0) {
                throw new Error('任务ID不能为空');
            }
            const overwrite = req.body.overwrite || false;
            taskService.createStrmFileByTask(taskIds, overwrite);
            return res.json({ success: true, data: 'ok' });
        }catch (error) {
            res.json({ success: false, error: error.message });
        }
    })
     // 获取目录树
     app.get('/api/folders/:accountId', async (req, res) => {
        try {
            const accountId = parseInt(req.params.accountId);
            let folderId = req.query.folderId || '-11';
            const forceRefresh = req.query.refresh === 'true';
            const cacheKey = `folders_${accountId}_${folderId}`;
            // forceRefresh 为true 则清空所有folders_开头的缓存
            if (forceRefresh) {
                folderCache.clearPrefix("folders_");
            }
            if (folderCache.has(cacheKey)) {
                return res.json({ success: true, data: folderCache.get(cacheKey) });
            }
            const account = await accountRepo.findOneBy({ id: accountId });
            if (!account) {
                throw new Error('账号不存在');
            }

            const cloud189 = CloudUtils.getService(account);
            if (CloudUtils.isQuarkAccount(account) && folderId === '-11') {
                folderId = '0';
            }
            const folders = await cloud189.getFolderNodes(folderId);
            if (!folders) {
                throw new Error('获取目录失败');
            }
            folderCache.set(cacheKey, folders);
            res.json({ success: true, data: folders });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    // 根据分享链接获取文件目录
    app.get('/api/share/folders/:accountId', async (req, res) => {
        try {
            const taskId = parseInt(req.query.taskId);
            const folderId = req.query.folderId;
            const forceRefresh = req.query.refresh === 'true';
            const cacheKey = `share_folders_${taskId}_${folderId}`;
            if (forceRefresh) {
                folderCache.clearPrefix("share_folders_");
            }
            if (folderCache.has(cacheKey)) {
                return res.json({ success: true, data: folderCache.get(cacheKey) });
            }
            const task = await taskRepo.findOneBy({ id: parseInt(taskId) });
            if (!task) {
                throw new Error('任务不存在');
            }
            if (folderId == -11) {
                // 返回顶级目录
                res.json({success: true, data: [{id: task.shareFileId, name: task.resourceName}]});
                return 
            }
            const account = await accountRepo.findOneBy({ id: req.params.accountId });
            if (!account) {
                throw new Error('账号不存在');
            }
            const cloud189 = CloudUtils.getService(account);
            // 查询分享目录
            const shareDir = await cloud189.listShareDir(task.shareId, req.query.folderId, task.shareMode);
            if (!shareDir || !shareDir.fileListAO) {
                res.json({ success: true, data: [] });    
            }
            const folders = shareDir.fileListAO.folderList;
            folderCache.set(cacheKey, folders);
            res.json({ success: true, data: folders });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

     // 获取目录下的文件
     app.get('/api/folder/files', asyncHandler(async (req, res) => {
        const { accountId, taskId } = req.query;
        const account = await accountRepo.findOneBy({ id: parseInt(accountId) });
        if (!account) {
            throw new Error('账号不存在');
        }
        const task = await taskRepo.findOneBy({ id: parseInt(taskId) });
        if (!task) {
            throw new Error('任务不存在');
        }
        const cloud189 = CloudUtils.getService(account);
        const fileList =  await taskService.getAllFolderFiles(cloud189, task);    
        res.json({ success: true, data: fileList });
    }));
    app.post('/api/files/rename', asyncHandler(async (req, res) => {
        const {taskId, accountId, files, sourceRegex, targetRegex } = req.body;
        if (files.length == 0) {
            throw new Error('未获取到需要修改的文件');
        }
        const account = await accountRepo.findOneBy({ id: accountId });
        if (!account) {
            throw new Error('账号不存在');
        }
        const task = await taskService.getTaskById(taskId);
        if (!task) {
            throw new Error('任务不存在');
        }
        const strmService = new StrmService();
        const strmEnabled = ConfigService.getConfigValue('strm.enable') && task.account.localStrmPrefix
        if (strmEnabled && task.enableSystemProxy){
            throw new Error('系统代理模式已移除');
        }
        const newFiles = files.map(file => ({id: file.fileId, name: file.destFileName}))
        if(task.enableSystemProxy) {
            throw new Error('系统代理模式已移除');
        }
        const cloud189 = CloudUtils.getService(account);
        const result = []
        const successFiles = []
        for (const file of files) {
            const renameResult = await cloud189.renameFile(file.fileId, file.destFileName);
            if (!renameResult) {
                throw new Error('重命名失败');
            }
            if (renameResult.res_code != 0) {
                result.push(`文件${file.destFileName} ${renameResult.res_msg}`)
            }else{
                if (strmEnabled){
                    // 删除对应的本地STRM文件
                    const oldFile = path.join(strmService.getTaskLocalRelativePath(task), file.oldName);
                    await strmService.delete(oldFile)
                }
                successFiles.push({id: file.fileId, name: file.destFileName})
            }
        }
        // 重新生成STRM文件
        if (strmEnabled){
            strmService.generate(task, successFiles, false, false)
        }
        if (sourceRegex && targetRegex) {
            task.sourceRegex = sourceRegex
            task.targetRegex = targetRegex
            taskRepo.save(task)
        }
        if (result.length > 0) {
            logTaskEvent(result.join('\n'));
        }
        res.json({ success: true, data: result });
    }));

    app.post('/api/tasks/executeAll', async (req, res) => {
        taskService.processAllTasks(true);
        res.json({ success: true, data: null });
    });

    // 系统设置
    app.get('/api/settings', async (req, res) => {
        res.json({success: true, data: ConfigService.getPublicConfig()})
    })

    app.post('/api/settings', async (req, res) => {
        const settings = req.body;
        SchedulerService.handleScheduleTasks(settings,taskService);
        ConfigService.setConfig(settings)
        await botManager.handleBotStatus(
            settings.telegram?.bot?.botToken,
            settings.telegram?.bot?.chatId,
            settings.telegram?.bot?.enable
        );
        // 修改配置, 重新实例化消息推送
        messageUtil.updateConfig()
        CloudUtils.setProxy()
        res.json({success: true, data: null})
    })


    // 保存媒体配置
    app.post('/api/settings/media', async (req, res) => {
        const settings = req.body;
        // 如果cloudSaver的配置变更 就清空cstoken.json
        if (settings.cloudSaver?.baseUrl != ConfigService.getConfigValue('cloudSaver.baseUrl')
        || settings.cloudSaver?.username != ConfigService.getConfigValue('cloudSaver.username')
        || settings.cloudSaver?.password != ConfigService.getConfigValue('cloudSaver.password')
    ) {
            clearCloudSaverToken();
        }
        ConfigService.setConfig(settings)
        res.json({success: true, data: null})
    })

    // 飞牛影视连接测试：解析映射第一条并刷新对应媒体库
    app.post('/api/fntv/test', async (req, res) => {
        try {
            const Fnv = require('./services/fntv');
            const fntvConfig = ConfigService.getConfigValue('fntv') || {};
            const { base_url, username, password, secret_string, api_key, mdb_mapping } = fntvConfig;

            if (!base_url || !username || !password || !secret_string || !api_key) {
                return res.json({ success: false, error: '请先填写完整的飞牛影视连接信息' });
            }

            // 解析 mdb_mapping 取第一条规则的 mdb_name
            const mappingStr = (mdb_mapping || '').trim();
            let mdbName = null;
            if (mappingStr) {
                const rules = mappingStr.split(/[;\n]+/);
                for (const rule of rules) {
                    const colonIdx = rule.indexOf(':');
                    if (colonIdx === -1) continue;
                    const name = rule.substring(colonIdx + 1).trim();
                    if (name) { mdbName = name; break; }
                }
            }
            if (!mdbName) {
                return res.json({ success: false, error: '请在媒体库映射中至少填写一条规则' });
            }

            const fnv = await Fnv.create({ base_url, username, password, secret_string, api_key });
            if (!fnv.isActive) {
                return res.json({ success: false, error: '登录失败，请检查用户名、密码、密钥等配置' });
            }

            const task = {
                addition: {
                    fnv: { auto_refresh: true, mdb_name: mdbName, mdb_dir_list: '' }
                }
            };
            await fnv.run(task);
            res.json({ success: true, data: `已向媒体库 "${mdbName}" 发送刷新指令` });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    })

    app.get('/api/version', (req, res) => {
        res.json({ version: currentVersion });
    });

    // 解析分享链接
    app.post('/api/share/parse', async (req, res) => {
        try{
            const shareLink = req.body.shareLink;
            const accountId = req.body.accountId;
            const accessCode = req.body.accessCode;
            const shareFolders = await taskService.parseShareFolderByShareLink(shareLink, accountId, accessCode);
            res.json({success: true, data: shareFolders})
        }catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    })
    // 保存常用目录
    app.post('/api/saveFavorites', async (req, res) => {
        try{
            const favorites = req.body.favorites;
            const accountId = req.body.accountId;
            if (!accountId) {
                throw new Error('账号ID不能为空');
            }
            // 先删除该账号下的所有常用目录
            await commonFolderRepo.delete({ accountId: accountId });
            // 构建新的常用目录数据
            const commonFolders = favorites.map(favorite => ({
                accountId: accountId,
                name: favorite.name,
                path: favorite.path,
                id: favorite.id
            }));
            if (commonFolders.length == 0) {
                res.json({ success: true, data: [] });
                return;
            }
            // 批量保存新的常用目录
            const result = await commonFolderRepo.save(commonFolders);
            res.json({ success: true, data: result });
        }catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    })
    // 获取常用目录
    app.get('/api/favorites/:accountId', async (req, res) => {
        try{
            const accountId = req.params.accountId;
            if (!accountId) {
                throw new Error('账号ID不能为空');
            }
            const favorites = await commonFolderRepo.find({
                where: { accountId: accountId },
                order: { id: 'ASC' }
            });
            res.json({ success: true, data: favorites });
        }catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    })
    
    // emby 回调
    app.post('/emby/notify', async (req, res) => {
        try {
            await embyService.handleWebhookNotification(req.body);
            res.status(200).send('OK');
        }catch (error) {
            console.log(error);
            res.status(500).send('Error');
        }
    })

    app.post('/api/chat', async (req, res) => {
        const { message } = req.body;
        try {
            let userMessage = message.trim();
            if(!userMessage) {
                res.json({ success: true });
                return
            }
            
            AIService.streamChat(userMessage, async (chunk) => {
                sendAIMessage(chunk);
            })
            res.json({ success: true });
        } catch (error) {
            console.error('处理聊天消息失败:', error);
            res.status(500).json({ success: false, error: '处理消息失败' });
        }
    })


    // STRM相关API
    app.post('/api/strm/generate-all', async (req, res) => {
        try {
            const overwrite = req.body.overwrite || false;
            const accountIds = req.body.accountIds;
            if (!accountIds || accountIds.length == 0) {
                throw new Error('账号ID不能为空');
            }
            const accounts = await accountRepo.find({
                where: {
                    localStrmPrefix: Not(IsNull()),
                    cloudStrmPrefix: Not(IsNull()),
                    id: In(accountIds)
                }
            });
            const strmService = new StrmService();
            strmService.generateAll(accounts, overwrite);
            res.json({ success: true, data: null });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    app.get('/api/strm/list', async (req, res) => {
        try {
            const path = req.query.path || '';
            const strmService = new StrmService();
            const files = await strmService.listStrmFiles(path);
            res.json({ success: true, data: files });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    // ai重命名
    app.post('/api/files/ai-rename', async (req, res) => {
        try {
            const { taskId, files } = req.body;
            if (files.length == 0) {
                throw new Error('未获取到需要修改的文件');
            }
            const task = await taskService.getTaskById(taskId);
            if (!task) {
                throw new Error('任务不存在');
            }
            // 开始ai分析
            const resourceInfo = await taskService._analyzeResourceInfo(
                task.resourceName,
                files,
                'file'
            )
            return res.json({ success: true, data: await taskService.handleAiRename(files, resourceInfo) });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    })

    app.post('/api/custom-push/test', async (req, res) => {
        try{
            const configTest = req.body
            if (await new CustomPushService([]).testPush(configTest)){
                res.json({ success: true, data: null });
            }else{
                res.json({ success: false, error: '推送测试失败' });
            }

        }catch (error) {
            res.json({ success: false, error: error.message });
        }
    })
    
    // 全局错误处理中间件
    app.use((err, req, res, next) => {
        console.error('捕获到全局异常:', err.message);
        res.status(500).json({ success: false, error: err.message });
    });


    initSSE(app)

    // 初始化cloudsaver
    setupCloudSaverRoutes(app);
    // 启动服务器
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`服务器运行在 http://localhost:${port}`);
    });
}).catch(error => {
    console.error('数据库连接失败:', error);
});
