const MessageService = require('./MessageService');
const Fnv = require('../fntv');
const { logTaskEvent } = require('../../utils/logUtils');

/**
 * 飞牛影视通知服务
 * 在 SmartStrm 任务完成后，通知飞牛影视刷新媒体库
 */
class FntvService extends MessageService {
    /**
     * 检查服务是否启用
     * @returns {boolean}
     */
    checkEnabled() {
        const { base_url, username, password, secret_string, api_key } = this.config || {};
        return !!(base_url && username && password && secret_string && api_key);
    }

    /**
     * 普通消息不处理
     */
    async _send(message) {
        return true;
    }

    /**
     * 刮削消息不处理
     */
    async _sendScrapeMessage(message) {
        return true;
    }

    /**
     * 任务完成后通知飞牛影视刷新媒体库
     * @param {object} task - 任务信息
     * @returns {Promise<boolean>}
     */
    async _sendTaskMessage(task) {
        try {
            if (!task) return false;

            // 解析媒体库映射规则（格式：关键字:mdb_name，支持换行或分号分隔）
            const mdbName = this._resolveMdbName(task);
            if (!mdbName) {
                logTaskEvent('飞牛影视: 未匹配到媒体库映射，跳过通知。');
                return false;
            }

            // 构造 Fnv 实例配置
            const fnvOptions = {
                base_url: this.config.base_url,
                app_name: this.config.app_name || 'trimemedia-web',
                username: this.config.username,
                password: this.config.password,
                secret_string: this.config.secret_string,
                api_key: this.config.api_key,
                token: this.config.token || null,
            };

            const fnv = await Fnv.create(fnvOptions);
            if (!fnv.isActive) {
                logTaskEvent('飞牛影视: 服务未激活，跳过通知。');
                return false;
            }

            // 构建传给 fnv.run() 的任务配置
            const resolvedTask = {
                addition: {
                    fnv: {
                        auto_refresh: true,
                        mdb_name: mdbName,
                        mdb_dir_list: '',
                    }
                }
            };

            logTaskEvent(`飞牛影视: 匹配到媒体库 '${mdbName}'，开始通知刷新...`);
            await fnv.run(resolvedTask);
            return true;
        } catch (error) {
            logTaskEvent(`飞牛影视通知失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 根据任务路径解析目标媒体库名称
     * 映射格式：关键字:mdb_name，支持换行或分号分隔
     * 例如：动漫:动漫库\n电影:电影库
     * @param {object} task
     * @returns {string|null}
     */
    _resolveMdbName(task) {
        const mappingStr = this.config.mdb_mapping || '';
        if (!mappingStr.trim()) return null;

        // 用换行或分号分隔各条规则
        const rules = mappingStr.split(/[;\n]+/);
        const taskPath = task.realFolderName || '';
        const taskName = task.resourceName || '';

        for (const rule of rules) {
            const colonIdx = rule.indexOf(':');
            if (colonIdx === -1) continue;
            const keyword = rule.substring(0, colonIdx).trim();
            const mdbName = rule.substring(colonIdx + 1).trim();
            if (!keyword || !mdbName) continue;

            // 只要任务路径或资源名包含关键字，就匹配
            if (taskPath.includes(keyword) || taskName.includes(keyword)) {
                return mdbName;
            }
        }

        return null;
    }
}

module.exports = FntvService;
