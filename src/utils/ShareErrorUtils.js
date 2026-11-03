// 分享失效类错误（被取消/删除/过期/不存在）的识别工具。
// 天翼与夸克返回的错误码、文案都不统一，统一在这里判断，供接口层与任务失败处理复用。

// 形如 ShareNotFound / ShareFileNotFound / ShareExpired / ShareCanceled 的错误码
const INVALID_SHARE_CODE_PATTERN = /share[_-]?[a-z]*(not[_-]?found|expired|cancel+ed|deleted|invalid|not[_-]?exist)/i;

// 确认属于分享失效的数字错误码（数字码容易与其它错误混淆，只登记已确认的）
const INVALID_SHARE_NUMERIC_CODES = {
    41011: '分享地址已失效' // 夸克: 分享地址已失效
};

const INVALID_SHARE_MESSAGE_PATTERNS = [
    /好友已取消了分享/,
    /分享(文件|文件夹|目录|链接|地址)?(已|被|已被)?(取消|删除|失效|过期|不存在|关闭|下架)/,
    /(分享)?(链接|地址)(已|被|已被)?(失效|过期|删除|取消)/,
    /share\s*(link)?\s*(is\s*)?(not\s*found|expired|deleted|cancel+ed|invalid)/i,
    /invalid\s+share/i
];

function matchInvalidShareMessage(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    return INVALID_SHARE_MESSAGE_PATTERNS.some(pattern => pattern.test(text)) ? text : '';
}

function matchInvalidShareCode(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    if (/^\d+$/.test(text)) {
        return INVALID_SHARE_NUMERIC_CODES[Number(text)] || '';
    }
    return INVALID_SHARE_CODE_PATTERN.test(text) ? text : '';
}

// 从接口响应/错误对象中提取分享失效原因，未命中返回空字符串
function getInvalidShareReason(payload) {
    if (!payload) {
        return '';
    }
    if (typeof payload === 'string') {
        return matchInvalidShareMessage(payload);
    }

    const messages = [
        payload.res_msg,
        payload.res_message,
        payload.message,
        payload.msg,
        payload.error,
        payload.statusMessage
    ];
    for (const message of messages) {
        const hit = matchInvalidShareMessage(message);
        if (hit) {
            return hit;
        }
    }

    const codes = [payload.res_code, payload.code, payload.errorCode, payload.errCode];
    for (const code of codes) {
        const hit = matchInvalidShareCode(code);
        if (hit) {
            return hit;
        }
    }
    return '';
}

function isInvalidShareResponse(payload) {
    return Boolean(getInvalidShareReason(payload));
}

function isInvalidShareError(error) {
    if (!error) {
        return false;
    }
    return error.invalidShare === true || Boolean(getInvalidShareReason(error));
}

// 生成带标记的错误，任务失败处理据此触发自动换链
function createInvalidShareError(reason, payload = {}) {
    const error = new Error(reason || '分享已失效');
    error.invalidShare = true;
    error.shareReason = reason || '';
    if (payload?.res_code !== undefined) {
        error.res_code = payload.res_code;
    }
    if (payload?.code !== undefined) {
        error.code = payload.code;
    }
    if (payload?.status !== undefined) {
        error.status = payload.status;
    }
    return error;
}

module.exports = {
    getInvalidShareReason,
    isInvalidShareResponse,
    isInvalidShareError,
    createInvalidShareError
};
