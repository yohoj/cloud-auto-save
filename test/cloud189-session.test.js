const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldUseTvSessionFallback } = require('../src/services/cloud189');

test('扫码账号即使带有 refreshToken 也优先使用 TV 会话', () => {
    // 回归：旧逻辑用 !token.refreshToken 判定，导致扫码后一直走 PC 兑换并报登录态失效
    assert.equal(
        shouldUseTvSessionFallback(
            { password: '', cookies: '' },
            { accessToken: 'e189-token', refreshToken: 'stale-refresh-token' }
        ),
        true
    );
});

test('没有 accessToken 时不使用 TV 会话', () => {
    assert.equal(shouldUseTvSessionFallback({ password: '', cookies: '' }, {}), false);
});

test('账号密码登录仍然走 SDK 默认会话流程', () => {
    assert.equal(
        shouldUseTvSessionFallback({ password: 'secret', cookies: '' }, { accessToken: 't' }),
        false
    );
});

test('SSON Cookie 登录仍然走 SDK 默认会话流程', () => {
    assert.equal(
        shouldUseTvSessionFallback({ password: '', cookies: 'SSON=xxx' }, { accessToken: 't' }),
        false
    );
});
