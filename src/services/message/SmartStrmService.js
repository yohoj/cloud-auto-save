const got = require('got');
const MessageService = require('./MessageService');
const { logTaskEvent } = require('../../utils/logUtils');

class SmartStrmService extends MessageService {
    /**
     * 检查服务是否启用
     * @returns {boolean}
     */
    checkEnabled() {
        return !!this.config.webhook;
    }

    /**
     * 实际发送消息
     * @param {string} message - 要发送的消息内容
     * @returns {Promise<boolean>} - 发送结果
     */
    /**
     * 实际发送消息 (普通消息文本不处理)
     */
    async _send(message) {
        return true;
    }

    /**
     * 发送任务完成消息
     */
    async _sendTaskMessage(task) {
        try {
            if (!task) return false;

            const rawTaskName = (task.shareFolderName ? `${task.resourceName}/${task.shareFolderName}` : task.resourceName).replace(/\(根\)/g, '').trim();
            let mappedName = rawTaskName;
            logTaskEvent("SmartStrm task:" + rawTaskName);
            // 解析任务映射
            const mappings = {};
            if (this.config.taskMapping) {
                // 支持分号、逗号分隔
                const rules = this.config.taskMapping.split(/[;,]+|\r?\n/);
                for (const rule of rules) {
                    const parts = rule.split(':');
                    if (parts.length === 2) {
                        mappings[parts[0].trim()] = parts[1].trim();
                    }
                }
            }

            // 应用映射逻辑: 如果资源名或存储路径包含某个映射的 key，则使用映射的 value
            for (const [key, value] of Object.entries(mappings)) {
                if (rawTaskName.includes(key) || (task.realFolderName && task.realFolderName.includes(key))) {
                    mappedName = value;
                    break;
                }
            }

            // 发送最小化请求
            const data = {
                event: "a_task",
                task: {
                    name: mappedName,
                    storage_path: "/" + task.realFolderName,
                }
            };
            // console.log("smarstrm", this.config.webhook, data, task);
            const response = await got.post(this.config.webhook, {
                json: data,
                timeout: {
                    request: 5000
                }
            }).json();
            logTaskEvent("SmartStrm Webhook 响应结果:" + JSON.stringify(response));

            return true;
        } catch (error) {
            logTaskEvent('SmartStrm Webhook 推送异常:' + error.message);
            return false;
        }
    }

    async _sendScrapeMessage(message) {
        // SmartStrm 不需要处理刮削消息
        return true;
    }
}

module.exports = SmartStrmService;
