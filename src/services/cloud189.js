const { CloudClient, FileTokenStore } = require('cloud189-sdk');
const { logTaskEvent } = require('../utils/logUtils');
const Cloud189Utils = require('../utils/Cloud189Utils');
const crypto = require('crypto');
const got = require('got');
const { rsaEncrypt } = require('cloud189-sdk/dist/util');
const { AUTH_URL, AppID, AccountType, ReturnURL } = require('cloud189-sdk/dist/const');

const CLOUD189_SESSION_ERROR = '天翼云盘登录态失效，请在账号设置中重新扫码登录，或补充账号密码/有效 SSON Cookie。';
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

function isCloud189SessionError(error) {
    return error?.message === 'Can not get session.';
}

function normalizeSsonCookie(cookie) {
    const value = (cookie || '').trim();
    const match = value.match(/(?:^|;\s*)SSON=([^;]+)/i);
    return match ? match[1] : value.replace(/^SSON=/i, '');
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

function shouldUseTvSessionFallback(account, token) {
    return !account.password && !account.cookies && token?.accessToken && !token.refreshToken;
}

async function getCloud189TvSession(accessToken) {
    const action = '/family/manage/loginFamilyMerge.action';
    const method = 'GET';
    const url = `${CLOUD189_TV_API_URL}${action}`;
    return await got(url, {
        method,
        searchParams: {
            ...CLOUD189_TV_CLIENT_SUFFIX,
            e189AccessToken: accessToken
        },
        headers: {
            ...CLOUD189_TV_HEADERS,
            ...getCloud189TvSignatureHeaders(url, method)
        },
        dnsLookupIpVersion: 'ipv4',
        timeout: { request: 30000 }
    }).json();
}

class Cloud189Service {
    static instances = new Map();
    static captchaSessions = new Map();
    static captchaSessionTtlMs = 5 * 60 * 1000;

    static getInstance(account) {
        const key = Cloud189Utils.normalizeUsername(account.username);
        if (!this.instances.has(key)) {
            this.instances.set(key, new Cloud189Service(account));
        }
        return this.instances.get(key);
    }

    static removeInstance(username) {
        this.instances.delete(Cloud189Utils.normalizeUsername(username));
    }

    static cleanupCaptchaSessions() {
        const now = Date.now();
        for (const [id, session] of this.captchaSessions.entries()) {
            if (session.expiresAt < now) {
                this.captchaSessions.delete(id);
            }
        }
    }

    constructor(account) {
        this.account = account;
        this.client = this._createClient(account);
    }

    _createClient(account) {
        const username = Cloud189Utils.normalizeUsername(account.username);
        const tokenStore = new FileTokenStore(Cloud189Utils.getTokenFilePath(username));
        const _options = {
            username,
            password: account.password,
            token: tokenStore
        }
        if (!account.password && account.cookies) {
            _options.ssonCookie = normalizeSsonCookie(account.cookies)
            _options.password = null
        }
        const client = new CloudClient(_options);
        client.request = client.request.extend({
            dnsLookupIpVersion: 'ipv4'
        });
        this._installTvSessionFallback(client, tokenStore, account);
        return client;
    }

    _installTvSessionFallback(client, tokenStore, account) {
        const originalGetSession = client.getSession.bind(client);
        client.getSession = async () => {
            const token = await tokenStore.get();
            if (shouldUseTvSessionFallback(account, token)) {
                try {
                    const tvSession = await getCloud189TvSession(token.accessToken);
                    if (tvSession?.sessionKey) {
                        return {
                            ...tvSession,
                            accessToken: token.accessToken,
                            refreshToken: token.refreshToken || ''
                        };
                    }
                } catch (error) {
                    const sessionError = new Error('Can not get session.');
                    sessionError.cause = error;
                    throw sessionError;
                }
            }
            return await originalGetSession();
        };
    }

    // 封装统一请求
    async request(action, body) {
        body.headers = { 'Accept': 'application/json;charset=UTF-8' }
        try {
            const noCache = Math.random().toString()
            return await this.client.request('https://cloud.189.cn' + action + '?noCach=' + noCache, body).json();
        } catch (error) {
            if (error instanceof got.HTTPError) {
                const rawBody = error.response?.body || '';
                let responseBody = null;
                try {
                    responseBody = JSON.parse(rawBody);
                } catch (parseError) {
                    logTaskEvent(`请求天翼云盘接口失败: HTTP ${error.response?.statusCode || 'unknown'} ${rawBody.slice(0, 200)}`);
                    return null;
                }
                if (responseBody.res_code === "ShareAuditWaiting") {
                    return responseBody;
                }
                if (responseBody.res_code === "FileAlreadyExists") {
                    return {
                        res_code: "FileAlreadyExists",
                        res_msg: "文件已存在"
                    }
                }
                // 如果是FileNotFound
                if (responseBody.res_code === "FileNotFound") {
                    return {
                        res_code: "FileNotFound",
                        res_msg: "文件不存在"
                    }
                }
                logTaskEvent('请求天翼云盘接口失败:' + rawBody);
            } else if (isCloud189SessionError(error)) {
                logTaskEvent(CLOUD189_SESSION_ERROR);
            } else if (error instanceof got.TimeoutError) {
                logTaskEvent('请求天翼云盘接口失败: 请求超时, 请检查是否能访问天翼云盘');
            } else if (error instanceof got.RequestError) {
                logTaskEvent('请求天翼云盘接口异常: ' + error.message);
            } else {
                logTaskEvent('其他异常:' + error.message)
            }
            if (!isCloud189SessionError(error)) {
                console.log(error)
            }
            return null
        }
    }

    async getUserSizeInfo() {
        try {
            return await this.client.getUserSizeInfo()
        } catch (error) {
            if (error instanceof got.HTTPError) {
                const responseBody = error.response.body;
                logTaskEvent('请求天翼云盘接口失败:' + responseBody);
            } else if (isCloud189SessionError(error)) {
                logTaskEvent(CLOUD189_SESSION_ERROR);
            } else if (error instanceof got.TimeoutError) {
                logTaskEvent('请求天翼云盘接口失败: 请求超时, 请检查是否能访问天翼云盘');
            } else if (error instanceof got.RequestError) {
                logTaskEvent('请求天翼云盘接口异常: ' + error.message);
            } else {
                // 捕获其他类型的错误
                logTaskEvent('获取用户空间信息失败:' + error.message);
            }
            if (!isCloud189SessionError(error)) {
                console.log(error)
            }
            return null
        }

    }
    // 解析分享链接获取文件信息
    async getShareInfo(shareCode) {
        return await this.request('/api/open/share/getShareInfoByCodeV2.action', {
            method: 'GET',
            searchParams: { shareCode }
        })
    }

    // 获取分享目录下的文件列表
    async listShareDir(shareId, fileId, shareMode, accessCode, isFolder = true) {
        return await this.request('/api/open/share/listShareDir.action', {
            method: 'GET',
            searchParams: {
                shareId,
                isFolder: isFolder,
                fileId: fileId,
                orderBy: 'lastOpTime',
                descending: true,
                shareMode: shareMode,
                pageNum: 1,
                pageSize: 1000,
                accessCode
            }
        })
    }

    // 递归获取所有文件列表
    async getShareFiles(shareId, fileId, shareMode, accessCode, isFolder = true) {
        const result = await this.listShareDir(shareId, fileId, shareMode, accessCode, isFolder);
        if (!result || !result.fileListAO.fileList) {
            return [];
        }
        return result.fileListAO.fileList;
    }

    // 搜索个人网盘文件
    async searchFiles(filename) {
        return await this.request('/api/open/share/getShareInfoByCodeV2.action', {
            method: 'GET',
            searchParams: {
                folderId: '-11',
                pageSize: '1000',
                pageNum: '1',
                recursive: 1,
                mediaType: 0,
                filename
            }
        })
    }

    // 获取个人网盘文件列表
    async listFiles(folderId) {
        return await this.request('/api/open/file/listFiles.action', {
            method: 'GET',
            searchParams: {
                folderId,
                mediaType: 0,
                orderBy: 'lastOpTime',
                descending: true,
                pageNum: 1,
                pageSize: 1000
            }
        })
    }

    // 创建批量执行任务
    async createBatchTask(batchTaskDto) {
        logTaskEvent("创建批量任务")
        logTaskEvent(`batchTaskDto: ${batchTaskDto.toString()}`)
        return await this.request('/api/open/batch/createBatchTask.action', {
            method: 'POST',
            form: batchTaskDto
        })
    }
    // 查询转存任务状态
    async checkTaskStatus(taskId, type = "SHARE_SAVE") {
        const params = { taskId, type }
        return await this.request('/api/open/batch/checkBatchTask.action', {
            method: 'POST',
            form: params,
        })
    }

    // 获取目录树节点
    async getFolderNodes(folderId = '-11') {
        return await this.request('/api/portal/getObjectFolderNodes.action', {
            method: 'POST',
            form: {
                id: folderId,
                orderBy: 1,
                order: 'ASC'
            },
        })
    }

    // 新建目录
    async createFolder(folderName, parentFolderId) {
        return await this.request('/api/open/file/createFolder.action', {
            method: 'POST',
            form: {
                parentFolderId: parentFolderId,
                folderName: folderName
            },
        })
    }

    // 验证分享链接访问码
    async checkAccessCode(shareCode, accessCode) {
        return await this.request('/api/open/share/checkAccessCode.action', {
            method: 'GET',
            searchParams: {
                shareCode,
                accessCode,
                uuid: crypto.randomUUID()
            },
        })
    }
    // 获取冲突的文件 
    async getConflictTaskInfo(taskId) {
        return await this.request('/api/open/batch/getConflictTaskInfo.action', {
            method: 'POST',
            json: {
                taskId,
                type: 'SHARE_SAVE'
            },
        })
    }

    // 处理冲突 taskInfos: [{"fileId":"","fileName":"","isConflict":1,"isFolder":0,"dealWay":1}]
    async manageBatchTask(taskId, targetFolderId, taskInfos) {
        return await this.request('/api/open/batch/manageBatchTask.action', {
            method: 'POST',
            json: {
                taskId,
                type: 'SHARE_SAVE',
                targetFolderId,
                taskInfos
            },
        })
    }

    // 重命名文件
    async renameFile(fileId, destFileName) {
        const response = await this.request('/api/open/file/renameFile.action', {
            method: 'POST',
            form: {
                fileId,
                destFileName
            },
        })
        return response
    }
    // 获取家庭信息
    async getFamilyInfo() {
        const familyList = await this.client.getFamilyList()
        if (!familyList || !familyList.familyInfoResp) {
            return null
        }
        const resp = familyList.familyInfoResp
        for (const family of resp) {
            if (family.userRole == 1) {
                return family
            }
        }
        return null
    }
    // 获取网盘直链
    async getDownloadLink(fileId, shareId = null) {
        const type = shareId ? 4 : 2
        const response = await this.request('/api/portal/getNewVlcVideoPlayUrl.action', {
            method: 'GET',
            searchParams: {
                fileId,
                shareId,
                type,
                dt: 1
            },
        })
        if (!response || response.res_code != 0) {
            throw new Error(response.res_msg)
        }
        const code = response.normal.code
        if (code != 1) {
            throw new Error(response.normal.message)
        }
        const url = response.normal.url
        const res = await got(url, {
            followRedirect: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0'
            }
        })
        return res.headers.location
    }

    // 获取普通文件下载链接，适用于读取 .cas 等非视频小文件
    async getFileDownloadUrl(fileId) {
        const response = await this.client.getFileDownloadUrl({ fileId });
        const downloadUrl = response?.fileDownloadUrl || '';
        if (!downloadUrl) {
            throw new Error('获取文件下载链接失败');
        }
        const url = downloadUrl.replace(/&amp;/g, '&').replace(/^http:\/\//, 'https://');
        const res = await got(url, {
            followRedirect: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0'
            },
            dnsLookupIpVersion: 'ipv4',
            timeout: { request: 30000 }
        });
        return res.headers.location || url;
    }

    async getFileText(fileId) {
        const url = await this.getFileDownloadUrl(fileId);
        return await got(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0'
            },
            dnsLookupIpVersion: 'ipv4',
            timeout: { request: 30000 }
        }).text();
    }
    // 记录转存量
    async increaseShareFileAccessCount(shareId) {
        const response = await this.request('https://cloud.189.cn/api/portal//share/increaseShareFileAccessCount.action', {
            method: 'GET',
            searchParams: {
                shareId,
                view: false,
                download: false,
                dump: true
            },
        })
        return response
    }
    _buildPasswordLoginForm(encrypt, appConf, username, password, validateCode = '') {
        return {
            appKey: AppID,
            accountType: AccountType,
            validateCode,
            captchaToken: appConf.captchaToken,
            dynamicCheck: 'FALSE',
            clientType: '1',
            cb_SaveName: '3',
            isOauth2: false,
            returnUrl: ReturnURL,
            paramId: appConf.paramId,
            userName: `${encrypt.pre}${rsaEncrypt(encrypt.pubKey, username)}`,
            password: `${encrypt.pre}${rsaEncrypt(encrypt.pubKey, password)}`
        };
    }

    _getCaptchaUrl(appConf) {
        return `${AUTH_URL}/api/logbox/oauth2/picCaptcha.do?token=${encodeURIComponent(appConf.captchaToken)}`;
    }

    async _createPasswordLoginSession() {
        const [encryptRes, appConf] = await Promise.all([
            this.client.authClient.getEncrypt(),
            this.client.authClient.getLoginForm()
        ]);
        return {
            encrypt: encryptRes.data,
            appConf,
            expiresAt: Date.now() + Cloud189Service.captchaSessionTtlMs
        };
    }

    _saveCaptchaSession(session) {
        Cloud189Service.cleanupCaptchaSessions();
        const captchaId = crypto.randomUUID();
        Cloud189Service.captchaSessions.set(captchaId, session);
        return captchaId;
    }

    _captchaResult(session, message) {
        const captchaId = this._saveCaptchaSession({
            ...session,
            expiresAt: Date.now() + Cloud189Service.captchaSessionTtlMs
        });
        return {
            success: false,
            code: 'NEED_CAPTCHA',
            message: message || '请输入验证码',
            data: {
                captchaId,
                captchaUrl: this._getCaptchaUrl(session.appConf)
            }
        };
    }

    async login(username, password, validateCode, captchaId) {
        try {
            Cloud189Service.cleanupCaptchaSessions();
            let loginSession = captchaId ? Cloud189Service.captchaSessions.get(captchaId) : null;
            if (captchaId && !loginSession) {
                return this._captchaResult(await this._createPasswordLoginSession(), '验证码已过期，请重新输入');
            }
            if (!loginSession) {
                loginSession = await this._createPasswordLoginSession();
            }

            const loginForm = this._buildPasswordLoginForm(
                loginSession.encrypt,
                loginSession.appConf,
                username,
                password,
                validateCode
            );
            const loginRes = await got.post(`${AUTH_URL}/api/logbox/oauth2/loginSubmit.do`, {
                headers: {
                    Referer: AUTH_URL,
                    lt: loginSession.appConf.lt,
                    REQID: loginSession.appConf.reqId
                },
                form: loginForm,
                dnsLookupIpVersion: 'ipv4',
                timeout: { request: 30000 }
            }).json();

            if (!loginRes.toUrl) {
                const message = loginRes.msg || loginRes.message || '登录失败';
                const resultCode = Number(loginRes.result);
                if (/验证码|captcha/i.test(message) || resultCode === -8 || resultCode === -13) {
                    return this._captchaResult(await this._createPasswordLoginSession(), message);
                }
                return {
                    success: false,
                    code: 'LOGIN_ERROR',
                    message
                };
            }

            const loginToken = await this.client.authClient.getSessionForPC({ redirectURL: loginRes.toUrl });
            await this.client.tokenStore.update({
                accessToken: loginToken.accessToken,
                refreshToken: loginToken.refreshToken,
                expiresIn: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).getTime()
            })
            if (captchaId) {
                Cloud189Service.captchaSessions.delete(captchaId);
            }
            return {
                success: true
            }
        } catch (error) {
            console.log(error)
            // 处理其他错误
            return {
                success: false,
                code: 'LOGIN_ERROR',
                message: error.message || '登录失败'
            }
        }
    }
}

module.exports = { Cloud189Service };
