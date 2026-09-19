const got = require('got');
const crypto = require('crypto');
const MessageService = require('./MessageService');

class DingTalkService extends MessageService {
    /**
     * 检查服务是否启用
     * @returns {boolean}
     */
    checkEnabled() {
        return !!this.config.webhook;
    }

    /**
     * 生成签名（如果配置了密钥）
     * @param {number} timestamp - 时间戳
     * @returns {string} 签名字符串
     */
    _generateSign(timestamp) {
        if (!this.config.secret) return '';
        
        const stringToSign = `${timestamp}\n${this.config.secret}`;
        const hmac = crypto.createHmac('sha256', this.config.secret)
            .update(stringToSign)
            .digest('base64');
        return encodeURIComponent(hmac);
    }

    /**
     * 构建 webhook URL（包含签名参数）
     * @param {number} timestamp - 时间戳
     * @returns {string} 完整的 webhook URL
     */
    _buildWebhookUrl(timestamp) {
        let url = this.config.webhook;
        if (this.config.secret) {
            const sign = this._generateSign(timestamp);
            url = `${url}&timestamp=${timestamp}&sign=${sign}`;
        }
        return url;
    }

    /**
     * 实际发送消息
     * @param {string} message - 要发送的消息内容
     * @returns {Promise<boolean>} - 发送结果
     */
    async _send(message) {
        try {
            const timestamp = Date.now();
            const url = this._buildWebhookUrl(timestamp);
            
            await got.post(url, {
                json: {
                    msgtype: 'text',
                    text: {
                        content: message
                    }
                }
            }).json();
            return true;
        } catch (error) {
            console.error('钉钉消息推送异常:', error);
            return false;
        }
    }

    /**
     * 发送刮削消息（带图片）
     * @param {object} message - 消息对象，包含 title, type, rating, image, description
     * @returns {Promise<boolean>} - 发送结果
     */
    async _sendScrapeMessage(message) {
        try {
            const timestamp = Date.now();
            const url = this._buildWebhookUrl(timestamp);
            
            const description = message.description 
                ? `${message.description.split('\n').slice(0, 2).join('\n')}${message.description.split('\n').length > 2 ? '...' : ''}`
                : '';
            
            const text = `### ${message.title}\n\n` +
                `**类型：** ${message.type === 'tv' ? '电视剧' : '电影'}\n` +
                `**评分：** ${message.rating || '暂无'}\n\n` +
                `${description}`;
            
            // 使用 link 类型消息发送带图片的内容
            if (message.image) {
                await got.post(url, {
                    json: {
                        msgtype: 'link',
                        link: {
                            title: message.title,
                            text: text,
                            picUrl: message.image,
                            messageUrl: message.image
                        }
                    }
                }).json();
            } else {
                // 没有图片时使用 markdown
                await got.post(url, {
                    json: {
                        msgtype: 'markdown',
                        markdown: {
                            title: message.title,
                            text: text
                        }
                    }
                }).json();
            }
            return true;
        } catch (error) {
            console.error('钉钉消息推送异常:', error);
            return false;
        }
    }
}

module.exports = DingTalkService;
