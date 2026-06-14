const got = require('got');
const ConfigService = require('./ConfigService');

const alistService = {
    Enable() {
        return ConfigService.getConfigValue('alist.enable') && ConfigService.getConfigValue('alist.baseUrl') && ConfigService.getConfigValue('alist.apiKey');
    },
    _getBaseUrl(baseUrl) {
        return String(baseUrl || '').replace(/\/+$/, '');
    },
    _normalizeFsPath(path) {
        const normalizedPath = String(path || '')
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/');
        return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
    },
    /**
     * 获取目录列表
     * @param {string} path 目录路径
     * @returns {Promise<Object>} 返回目录列表数据
     */
    async listFiles(path) {
        const baseUrl = await this.getConfig('alist.baseUrl');
        const apiKey = await this.getConfig('alist.apiKey');

        if (!baseUrl) {
            throw new Error('OpenList/Alist baseUrl 未配置');
        }

        if (!apiKey) {
            throw new Error('OpenList/Alist apiKey 未配置');
        }

        try {
            const response = await got.post(`${this._getBaseUrl(baseUrl)}/api/fs/list`, {
                json: {
                    path: path,
                    page: 1,
                    per_page: 0,
                    refresh: true
                },
                headers: {
                    'Authorization': apiKey
                }
            }).json();

            return response;
        } catch (error) {
            if (error.response) {
                throw new Error(`OpenList/Alist API 错误: ${error.response.statusMessage}`);
            }
            throw error;
        }
    },

    /**
     * 获取文件或目录信息
     * @param {string} path 文件或目录路径
     * @param {string} password 受保护路径密码
     * @returns {Promise<Object>} 返回文件或目录信息
     */
    async getFile(path, password = '') {
        const baseUrl = await this.getConfig('alist.baseUrl');
        const apiKey = await this.getConfig('alist.apiKey');

        if (!baseUrl) {
            throw new Error('OpenList/Alist baseUrl 未配置');
        }

        if (!apiKey) {
            throw new Error('OpenList/Alist apiKey 未配置');
        }

        try {
            const response = await got.post(`${this._getBaseUrl(baseUrl)}/api/fs/get`, {
                json: {
                    path: this._normalizeFsPath(path),
                    password
                },
                headers: {
                    'Authorization': apiKey
                }
            }).json();

            return response;
        } catch (error) {
            if (error.response) {
                throw new Error(`OpenList/Alist API 错误: ${error.response.statusMessage}`);
            }
            throw error;
        }
    },

    /**
     * 从配置服务获取配置
     * @param {string} key 配置键名
     * @returns {Promise<string>} 配置值
     */
    async getConfig(key) {
        // 从本地存储获取配置
        return ConfigService.getConfigValue(key);
    }
};

module.exports = alistService;
