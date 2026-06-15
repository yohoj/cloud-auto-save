const Cloud189Utils = require('./Cloud189Utils');
const { Cloud189Service } = require('../services/cloud189');
const { QuarkService } = require('../services/quark');

class CloudUtils {
    static isQuarkAccount(accountOrUsername) {
        if (typeof accountOrUsername === 'object' && accountOrUsername?.cloudType) {
            return accountOrUsername.cloudType === 'quark';
        }
        const username = typeof accountOrUsername === 'string' ? accountOrUsername : accountOrUsername?.username;
        return username?.startsWith('q_');
    }

    static isCloud189Account(accountOrUsername) {
        return !this.isQuarkAccount(accountOrUsername);
    }

    static getService(account) {
        return this.isQuarkAccount(account) ? QuarkService.getInstance(account) : Cloud189Service.getInstance(account);
    }

    static removeInstance(accountOrUsername) {
        const username = typeof accountOrUsername === 'string' ? accountOrUsername : accountOrUsername?.username;
        if (typeof accountOrUsername === 'string') {
            QuarkService.removeInstance(username);
            Cloud189Service.removeInstance(username);
            return;
        }
        if (this.isQuarkAccount(accountOrUsername)) {
            QuarkService.removeInstance(username);
            return;
        }
        Cloud189Service.removeInstance(username);
    }

    static setProxy() {
        QuarkService.setProxy();
    }

    static getShareLinkCloudType(shareLink) {
        let text = (shareLink || '').trim();
        try {
            text = decodeURIComponent(text);
        } catch (error) {
            // 如果不是合法的 URL 编码，继续使用原文本判断。
        }
        if (/pan\.quark\.cn|drive\.quark\.cn|quark\.cn\/s\//i.test(text)) {
            return 'quark';
        }
        if (/cloud\.189\.cn|h5\.cloud\.189\.cn|content\.21cn\.com/i.test(text)) {
            return 'cloud189';
        }
        return '';
    }

    static parseCloudShare(shareText) {
        const text = decodeURIComponent((shareText || '').trim());
        if (/https?:\/\/[^\s]*(pan\.quark\.cn|drive\.quark\.cn|quark\.cn\/s\/)/i.test(text)) {
            return QuarkService.parseCloudShare(text);
        }
        return Cloud189Utils.parseCloudShare(text);
    }

    static parseShareCode(shareLink, account) {
        if (this.isQuarkAccount(account) || /pan\.quark\.cn|drive\.quark\.cn|quark\.cn\/s\//i.test(shareLink)) {
            return QuarkService.parseShareCode(shareLink);
        }
        return Cloud189Utils.parseShareCode(shareLink);
    }
}

module.exports = CloudUtils;
