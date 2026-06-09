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
                        if (this.proxy) {
                            options.agent = {
                                http: new HttpProxyAgent(this.proxy),
                                https: new HttpsProxyAgent(this.proxy)
                            };
                        }
                    }
                ]
            }
        });
    }

    setProxy(proxyUrl) {
        this.proxy = proxyUrl;
    }

    async request(action, options = {}) {
        try {
            const response = await this.client(action.replace(/^\//, ''), {
                ...options,
                searchParams: {
                    ...DEFAULT_PARAMS,
                    ...(options.searchParams || {})
                }
            }).json();
            if (response?.status && response.status !== 200) {
                logTaskEvent(`请求夸克网盘接口失败: ${response.message || response.status}`);
            }
            return response;
        } catch (error) {
            if (error instanceof got.HTTPError) {
                logTaskEvent(`请求夸克网盘接口失败: HTTP ${error.response?.statusCode || 'unknown'} ${(error.response?.body || '').slice(0, 200)}`);
            } else if (error instanceof got.TimeoutError) {
                logTaskEvent('请求夸克网盘接口失败: 请求超时, 请检查是否能访问夸克网盘');
            } else {
                logTaskEvent('请求夸克网盘接口异常: ' + error.message);
            }
            return null;
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
            return response ? { res_code: response.status, res_msg: response.message } : null;
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
        const status = response.data?.status || response.data?.task_status;
        return {
            taskId,
            taskStatus: status === 2 || status === 'success' ? 4 : 3,
            failedCount: 0
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
            res_code: response.status === 200 ? 0 : response.status,
            res_msg: response.message || '',
            taskId: response.data?.task_id || response.data?.taskId || response.data?.fid || 'quark-immediate'
        };
    }

    normalizeFile(item) {
        const size = item.size || item.file_size || 0;
        return {
            id: item.fid,
            name: item.file_name,
            fileName: item.file_name,
            md5: item.obj_category || item.share_fid_token || item.fid,
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
