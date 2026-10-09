const got = require('got');
const ProxyUtil = require('../utils/ProxyUtil');
const { logTaskEvent } = require('../utils/logUtils');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

const BASE_URL = 'https://drive-pc.quark.cn';
const DEFAULT_PARAMS = { pr: 'ucpro', fr: 'pc' };

class QuarkService {
    static instances = new Map();

    static getInstance(account) {
        const key = account.username;
        const cookie = account.cookies || account.password || '';
        const existing = this.instances.get(key);
        // cookie 已更新时丢弃旧实例，避免用过期 cookie 校验/请求
        if (existing && cookie && existing.cookie !== cookie) {
            this.instances.delete(key);
        }
        if (!this.instances.has(key)) {
            this.instances.set(key, new QuarkService(account));
        }
        return this.instances.get(key);
    }

    static removeInstance(username) {
        this.instances.delete(username);
    }

    static setProxy() {
        const proxyUrl = ProxyUtil.getProxy('quark');
        this.instances.forEach(instance => instance.setProxy(proxyUrl));
    }

    constructor(account) {
        this.account = account;
        this.cookie = account.cookies || account.password || '';
        this.proxy = ProxyUtil.getProxy('quark');
        this._cookieSaveTimer = null;
        this._renewCookie = null;
        this.client = got.extend({
            prefixUrl: BASE_URL,
            timeout: { request: 30000 },
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'Cookie': this.cookie,
                'Referer': 'https://pan.quark.cn/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
            },
            hooks: {
                beforeRequest: [
                    options => {
                        // 每次请求动态取最新 cookie（got 的 defaults.headers 已冻结，无法事后修改）
                        options.headers.cookie = this._renewCookie || this.cookie;
                        if (this.proxy) {
                            options.agent = {
                                http: new HttpProxyAgent(this.proxy),
                                https: new HttpsProxyAgent(this.proxy)
                            };
                        }
                    }
                ],
                afterResponse: [
                    (response) => {
                        this._mergeSetCookie(response.headers?.['set-cookie']);
                        return response;
                    }
                ]
            }
        });
    }

    setProxy(proxyUrl) {
        this.proxy = proxyUrl;
    }

    async request(action, options = {}) {
        return this._requestWithRetry(action, options, true);
    }

    async _requestWithRetry(action, options, allowRenew) {
        try {
            const response = await this.client(action.replace(/^\//, ''), {
                ...options,
                searchParams: {
                    ...DEFAULT_PARAMS,
                    ...(options.searchParams || {})
                }
            }).json();
            if (allowRenew && this._isAuthFailure(response)) {
                logTaskEvent('夸克登录态可能已失效，正在自动续期...');
                const renewed = await this._renewSession();
                if (renewed) {
                    return this._requestWithRetry(action, options, false);
                }
            }
            if (response?.status && response.status !== 200) {
                logTaskEvent(`请求夸克网盘接口失败: ${response.message || response.status}`);
            }
            return response;
        } catch (error) {
            if (error instanceof got.HTTPError) {
                this._mergeSetCookie(error.response?.headers?.['set-cookie']);
                const body = error.response?.body || '';
                logTaskEvent(`请求夸克网盘接口失败: HTTP ${error.response?.statusCode || 'unknown'} ${body.slice(0, 200)}`);
                if (allowRenew && (error.response?.statusCode === 401 || error.response?.statusCode === 403) && this.cookie.includes('__puus')) {
                    logTaskEvent('夸克登录态可能已失效，正在自动续期...');
                    const renewed = await this._renewSession();
                    if (renewed) {
                        return this._requestWithRetry(action, options, false);
                    }
                }
                try {
                    const parsed = JSON.parse(body);
                    if (parsed && typeof parsed === 'object') {
                        return {
                            ...parsed,
                            status: parsed.status || error.response?.statusCode,
                            httpStatusCode: error.response?.statusCode
                        };
                    }
                } catch (parseError) {
                    // 非 JSON 错误响应按原逻辑返回 null。
                }
            } else if (error instanceof got.TimeoutError) {
                logTaskEvent('请求夸克网盘接口失败: 请求超时, 请检查是否能访问夸克网盘');
            } else {
                logTaskEvent('请求夸克网盘接口异常: ' + error.message);
            }
            return null;
        }
    }

    _isAuthFailure(response) {
        if (!response || !this.cookie.includes('__puus')) return false;
        const httpStatus = response.httpStatusCode;
        if (httpStatus === 401 || httpStatus === 403) return true;
        if (response.status === 401 || response.status === 403) return true;
        if (response.status && response.status !== 200) return true;
        if (response.code && response.code !== 0) return true;
        return false;
    }

    async _renewSession() {
        // 续期期间 hook 会改发去掉 __puus 的 cookie，诱导服务端 Set-Cookie 下发新会话
        const previousRenewCookie = this._renewCookie;
        this._renewCookie = this._stripCookie(this.cookie, ['__puus']);
        try {
            try {
                await this.client('1/clouddrive/config', {
                    method: 'GET',
                    searchParams: { ...DEFAULT_PARAMS }
                });
                return true;
            } catch (error) {
                if (error instanceof got.HTTPError) {
                    this._mergeSetCookie(error.response?.headers?.['set-cookie']);
                    if (error.response?.statusCode === 404) {
                        try {
                            await this.client('1/clouddrive/file/sort', {
                                method: 'GET',
                                searchParams: { ...DEFAULT_PARAMS, pdir_fid: '0', _page: 1, _size: 1, _sort: 'file_type:asc,updated_at:desc' }
                            });
                            return true;
                        } catch (retryError) {
                            if (retryError instanceof got.HTTPError) {
                                this._mergeSetCookie(retryError.response?.headers?.['set-cookie']);
                            }
                            return false;
                        }
                    }
                }
                return false;
            }
        } finally {
            this._renewCookie = previousRenewCookie;
        }
    }

    _mergeSetCookie(setCookie) {
        if (!setCookie) return;
        const entries = Array.isArray(setCookie) ? setCookie : [setCookie];
        const tracked = ['__puus', '__pus', '__kpids'];
        const map = this._parseCookieMap(this.cookie);
        let changed = false;
        for (const entry of entries) {
            const pair = entry.split(';')[0].trim();
            const eq = pair.indexOf('=');
            if (eq <= 0) continue;
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            if (!tracked.includes(name)) continue;
            if (map.get(name) !== value) {
                map.set(name, value);
                changed = true;
            }
        }
        if (!changed) return;
        this.cookie = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
        this.account.cookies = this.cookie;
        this._scheduleCookiePersist();
    }

    _parseCookieMap(cookie) {
        const map = new Map();
        for (const part of String(cookie || '').split(';')) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            const eq = trimmed.indexOf('=');
            if (eq <= 0) continue;
            map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
        }
        return map;
    }

    _stripCookie(cookie, names) {
        const map = this._parseCookieMap(cookie);
        names.forEach(n => map.delete(n));
        return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    _scheduleCookiePersist() {
        if (this._cookieSaveTimer) return;
        this._cookieSaveTimer = setTimeout(() => {
            this._cookieSaveTimer = null;
            this._persistCookie();
        }, 2000);
    }

    async _persistCookie() {
        const accountId = this.account?.id;
        if (!accountId) return;
        try {
            // 动态加载 database 模块，避免顶层依赖；不可用时静默跳过
            const { getAccountRepository } = require('../database');
            const accountRepo = getAccountRepository();
            await accountRepo.update({ id: accountId }, { cookies: this.cookie });
        } catch (error) {
            // DB 未初始化或写失败时忽略，后续请求可再次触发
        }
    }

    async getUserSizeInfo() {
        const response = await this.request('/1/clouddrive/member', {
            method: 'GET',
            searchParams: {
                fetch_subscribe: true,
                fetch_identity: true
            }
        });
        if (!response) return null;
        if (response.status && response.status !== 200) {
            return {
                res_code: response.status,
                res_msg: response.message || '获取夸克容量信息失败'
            };
        }

        const data = response.data || {};
        const usedSize = this.parseCapacitySize(data.use_capacity ?? data.used_capacity ?? data.usedSize);
        const totalSize = this.parseCapacitySize(data.total_capacity ?? data.totalCapacity ?? data.total_size);
        if (usedSize === null || totalSize === null) {
            return {
                res_code: -1,
                res_msg: '夸克接口未返回容量信息'
            };
        }

        return {
            res_code: 0,
            cloudCapacityInfo: { usedSize, totalSize }
        };
    }

    parseCapacitySize(value) {
        if (value === null || value === undefined || value === '') return null;
        const size = Number(value);
        return Number.isFinite(size) ? size : null;
    }

    async getShareInfo(pwdId, passcode = '') {
        const tokenResp = await this.request('/1/clouddrive/share/sharepage/token', {
            method: 'POST',
            json: {
                pwd_id: pwdId,
                passcode: passcode || ''
            }
        });
        if (!tokenResp) return null;
        if (tokenResp.status !== 200 || !tokenResp.data?.stoken) {
            return {
                res_code: tokenResp.code || tokenResp.status || -1,
                res_msg: tokenResp.message || '获取分享信息失败',
                shareMode: passcode ? 0 : 1
            };
        }

        const shareInfo = await this.listShareDir(pwdId, '0', tokenResp.data.stoken, passcode);
        if (!shareInfo?.rawList?.length) {
            const title = tokenResp.data.title || '夸克分享';
            return {
                res_code: 0,
                fileId: '0',
                fileName: title,
                isFolder: true,
                shareId: pwdId,
                shareMode: tokenResp.data.stoken,
                stoken: tokenResp.data.stoken
            };
        }

        const root = shareInfo.rawList[0];
        return {
            res_code: 0,
            fileId: root.fid,
            fileName: root.file_name,
            isFolder: root.dir,
            shareId: pwdId,
            shareMode: tokenResp.data.stoken,
            stoken: tokenResp.data.stoken,
            shareFidToken: root.share_fid_token
        };
    }

    async listShareDir(pwdId, fileId, stoken, accessCode, isFolder = true) {
        const response = await this.request('/1/clouddrive/share/sharepage/detail', {
            method: 'GET',
            searchParams: {
                pwd_id: pwdId,
                stoken,
                pdir_fid: isFolder ? fileId : '0',
                _page: 1,
                _size: 200,
                _fetch_banner: 0,
                _fetch_share: 0,
                _fetch_total: 1,
                _sort: 'file_type:asc,updated_at:desc'
            }
        });
        if (!response || response.status !== 200) {
            return response ? {
                res_code: response.code || response.status,
                res_msg: response.message,
                status: response.status,
                code: response.code,
                raw: response
            } : null;
        }
        const list = response.data?.list || [];
        return {
            res_code: 0,
            rawList: list,
            fileListAO: {
                fileList: list.filter(item => !item.dir).map(item => this.normalizeFile(item)),
                folderList: list.filter(item => item.dir).map(item => this.normalizeFile(item))
            }
        };
    }

    async getShareFiles(shareId, fileId, shareMode, accessCode, isFolder = true) {
        const result = await this.listShareDir(shareId, fileId, shareMode, accessCode, isFolder);
        if (!result?.fileListAO?.fileList?.length && !isFolder) {
            const shareInfo = await this.getShareInfo(shareId, accessCode);
            return shareInfo?.isFolder ? [] : [this.normalizeFile({
                fid: shareInfo.fileId,
                file_name: shareInfo.fileName,
                dir: false,
                share_fid_token: shareInfo.shareFidToken
            })];
        }
        return result?.fileListAO?.fileList || [];
    }

    async listFiles(folderId = '0') {
        const response = await this.request('/1/clouddrive/file/sort', {
            method: 'GET',
            searchParams: {
                pdir_fid: folderId || '0',
                _page: 1,
                _size: 200,
                _sort: 'file_type:asc,updated_at:desc'
            }
        });
        if (!response || response.status !== 200) {
            return response ? { res_code: response.status, res_msg: response.message } : null;
        }
        const list = response.data?.list || [];
        return {
            res_code: 0,
            fileListAO: {
                fileList: list.filter(item => !item.dir).map(item => this.normalizeFile(item)),
                folderList: list.filter(item => item.dir).map(item => this.normalizeFile(item))
            }
        };
    }

    async getFolderNodes(folderId = '0') {
        const files = await this.listFiles(folderId);
        if (!files?.fileListAO) return null;
        return files.fileListAO.folderList.map(folder => ({
            id: folder.id,
            name: folder.name,
            isParent: true,
            pId: folderId
        }));
    }

    async createFolder(folderName, parentFolderId = '0') {
        const response = await this.request('/1/clouddrive/file', {
            method: 'POST',
            json: {
                pdir_fid: parentFolderId || '0',
                file_name: folderName,
                dir_init_lock: false
            }
        });
        if (!response || response.status !== 200) return null;
        const data = response.data || {};
        return { id: data.fid, name: data.file_name || folderName };
    }

    async createBatchTask(batchTaskDto) {
        if (batchTaskDto.type === 'DELETE') {
            const taskInfos = JSON.parse(batchTaskDto.taskInfos || '[]');
            const response = await this.request('/1/clouddrive/file/delete', {
                method: 'POST',
                json: {
                    action_type: 2,
                    filelist: taskInfos.map(item => item.fileId),
                    exclude_fids: []
                }
            });
            return this.normalizeTaskCreate(response);
        }

        const taskInfos = JSON.parse(batchTaskDto.taskInfos || '[]');
        const response = await this.request('/1/clouddrive/share/sharepage/save', {
            method: 'POST',
            json: {
                fid_list: taskInfos.map(item => item.fileId),
                fid_token_list: taskInfos.map(item => item.shareFidToken || item.fidToken || item.md5 || ''),
                to_pdir_fid: batchTaskDto.targetFolderId,
                pwd_id: batchTaskDto.shareId,
                stoken: batchTaskDto.shareMode,
                pdir_fid: batchTaskDto.shareFolderId || '0',
                scene: 'link'
            }
        });
        return this.normalizeTaskCreate(response);
    }

    async checkTaskStatus(taskId) {
        if (!taskId || taskId === 'quark-immediate') {
            return {
                taskId: taskId || 'quark-immediate',
                taskStatus: 4,
                failedCount: 0
            };
        }
        const response = await this.request('/1/clouddrive/task', {
            method: 'GET',
            searchParams: { task_id: taskId }
        });
        if (!response || response.status !== 200) return null;
        const data = response.data || {};
        const status = data.status ?? data.task_status;
        let taskStatus = 3;
        if (status === 2 || status === 'success' || status === 'done' || status === 'finished') {
            taskStatus = 4;
        } else if (status === 0 || status === 1 || status === 'running' || status === 'processing' || status === 'pending') {
            taskStatus = 1;
        } else if (status === 3 || status === 'fail' || status === 'failed' || status === 'error') {
            taskStatus = 5;
        }
        return {
            taskId,
            taskStatus,
            rawStatus: status,
            failedCount: data.failed_count || data.fail_count || 0,
            resMsg: data.message || data.error_msg || data.err_msg || response.message || ''
        };
    }

    async getConflictTaskInfo() {
        return null;
    }

    async manageBatchTask() {
        return null;
    }

    async renameFile(fileId, destFileName) {
        const response = await this.request('/1/clouddrive/file/rename', {
            method: 'POST',
            json: {
                fid: fileId,
                file_name: destFileName
            }
        });
        if (!response) return null;
        return {
            res_code: response.status === 200 ? 0 : response.status,
            res_msg: response.message || ''
        };
    }

    async checkAccessCode(shareCode, accessCode) {
        const shareInfo = await this.getShareInfo(shareCode, accessCode);
        if (!shareInfo?.shareId || shareInfo.res_code !== 0) return null;
        return { shareId: shareInfo.shareId, stoken: shareInfo.stoken };
    }

    async increaseShareFileAccessCount() {
        return { res_code: 0 };
    }

    async getFamilyInfo() {
        return null;
    }

    normalizeTaskCreate(response) {
        if (!response) return null;
        return {
            res_code: response.status === 200 ? 0 : (response.code || response.status),
            res_msg: response.message || '',
            status: response.status,
            code: response.code,
            taskId: response.data?.task_id || response.data?.taskId || response.data?.fid || 'quark-immediate'
        };
    }

    normalizeFile(item) {
        const size = item.size || item.file_size || 0;
        const md5 = item.md5 || item.file_md5 || item.content_hash || item.hash || '';
        return {
            id: item.fid,
            name: item.file_name,
            fileName: item.file_name,
            md5,
            size,
            isFolder: !!item.dir,
            shareFidToken: item.share_fid_token,
            fidToken: item.share_fid_token
        };
    }

    static parseShareCode(shareLink) {
        const shareUrl = new URL(shareLink);
        const match = shareUrl.pathname.match(/\/s\/([^/?#]+)/);
        if (match) return match[1];
        const pwdId = shareUrl.searchParams.get('pwd_id') || shareUrl.searchParams.get('pwdId');
        if (pwdId) return pwdId;
        throw new Error('无效的夸克分享链接');
    }

    static parseCloudShare(shareText) {
        shareText = decodeURIComponent(shareText).replace(/\s/g, '');
        let accessCode = '';
        const accessCodePatterns = [
            /[（(]提取码[：:]?([a-zA-Z0-9]{4})[)）]/,
            /提取码[：:]?([a-zA-Z0-9]{4})/,
            /[（(]([a-zA-Z0-9]{4})[)）]/
        ];
        for (const pattern of accessCodePatterns) {
            const match = shareText.match(pattern);
            if (match) {
                accessCode = match[1];
                shareText = shareText.replace(match[0], '');
                break;
            }
        }
        const urlMatch = shareText.match(/(https?:\/\/(?:pan|drive)\.quark\.cn\/s\/[a-zA-Z0-9_-]+)/)
            || shareText.match(/(https?:\/\/[^\s]*quark\.cn\/s\/[a-zA-Z0-9_-]+)/);
        return {
            url: urlMatch ? urlMatch[1] : '',
            accessCode
        };
    }
}

module.exports = { QuarkService };
