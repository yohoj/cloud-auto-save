const test = require('node:test');
const assert = require('node:assert/strict');

const ShareErrorUtils = require('../src/utils/ShareErrorUtils');

test('识别分享失效相关的错误文案', () => {
    const invalidMessages = [
        '好友已取消了分享',
        '分享不存在',
        '分享已失效',
        '该分享已过期',
        '分享链接已失效',
        '分享地址已失效',
        '分享地址不存在',
        '分享文件已被删除',
        '分享已关闭'
    ];
    for (const message of invalidMessages) {
        assert.equal(ShareErrorUtils.getInvalidShareReason({ res_msg: message }), message);
        assert.equal(ShareErrorUtils.isInvalidShareError(new Error(message)), true);
    }
});

test('不把普通错误误判为分享失效', () => {
    const normalMessages = [
        '获取文件列表失败',
        '分享链接审核中, 请稍后再试',
        '分享链接为加密链接, 请提供访问码',
        '访问码无效',
        '文件不存在',
        'stoken过期',
        '分享的stoken过期',
        '分享地址审核中, 请稍后再试'
    ];
    for (const message of normalMessages) {
        assert.equal(ShareErrorUtils.getInvalidShareReason({ res_msg: message }), '');
        assert.equal(ShareErrorUtils.isInvalidShareError(new Error(message)), false);
    }
    // 夸克 stoken 过期(41016)只需刷新 stoken，不能当成分享失效去换链
    assert.equal(ShareErrorUtils.getInvalidShareReason({
        status: 404,
        code: 41016,
        message: '分享的stoken过期'
    }), '');
});

test('识别分享失效相关错误码', () => {
    assert.equal(ShareErrorUtils.getInvalidShareReason({ res_code: 'ShareNotFound' }), 'ShareNotFound');
    assert.equal(ShareErrorUtils.getInvalidShareReason({ res_code: 'ShareFileNotFound' }), 'ShareFileNotFound');
    assert.equal(ShareErrorUtils.getInvalidShareReason({ res_code: 'ShareExpired' }), 'ShareExpired');
    // 审核中、个人目录不存在不属于分享失效
    assert.equal(ShareErrorUtils.getInvalidShareReason({ res_code: 'ShareAuditWaiting' }), '');
    assert.equal(ShareErrorUtils.getInvalidShareReason({ res_code: 'FileNotFound' }), '');
    // 未登记的数字错误码不参与判断
    assert.equal(ShareErrorUtils.getInvalidShareReason({ res_code: 41004 }), '');
    // 夸克 41011: 分享地址已失效（有无文案都能识别）
    assert.equal(ShareErrorUtils.getInvalidShareReason({
        status: 404,
        code: 41011,
        message: '分享地址已失效'
    }), '分享地址已失效');
    assert.equal(ShareErrorUtils.getInvalidShareReason({ res_code: 41011 }), '分享地址已失效');
});

test('createInvalidShareError 生成可识别的错误并保留错误码', () => {
    const error = ShareErrorUtils.createInvalidShareError('分享不存在', {
        res_code: 'ShareNotFound',
        code: 41004,
        status: 500
    });

    assert.equal(error.message, '分享不存在');
    assert.equal(error.invalidShare, true);
    assert.equal(error.shareReason, '分享不存在');
    assert.equal(error.res_code, 'ShareNotFound');
    assert.equal(error.code, 41004);
    assert.equal(error.status, 500);
    assert.equal(ShareErrorUtils.isInvalidShareError(error), true);
});
