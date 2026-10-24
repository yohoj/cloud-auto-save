const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { StrmService } = require('../src/services/strm');

function createService(retryTimes) {
    const service = new StrmService();
    service.strmRetryTimes = retryTimes;
    service.strmRetryIntervalMs = 0;
    return service;
}

async function createTempDir() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'strm-retry-'));
}

test('获取OpenList签名短暂失败时重试后成功写入STRM', async () => {
    const service = createService(3);
    const dir = await createTempDir();
    const strmPath = path.join(dir, 'EP100.4K.strm');
    let calls = 0;

    service._buildStrmContent = async () => {
        calls++;
        if (calls < 3) {
            throw new Error('获取OpenList签名失败: object not found');
        }
        return 'http://example.com/d/test/EP100.4K.mp4?sign=ok';
    };

    try {
        const attempts = await service._writeStrmWithRetry({}, 'dir', 'EP100.4K.mp4', {}, strmPath);

        assert.equal(attempts, 3);
        assert.equal(calls, 3);
        assert.equal(
            (await fs.readFile(strmPath, 'utf8')).trim(),
            'http://example.com/d/test/EP100.4K.mp4?sign=ok'
        );
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('重试次数用尽后抛出原始错误且只记录一次失败', async () => {
    const service = createService(2);
    const dir = await createTempDir();
    const strmPath = path.join(dir, 'EP100.4K.strm');
    let calls = 0;

    service._buildStrmContent = async () => {
        calls++;
        throw new Error('获取OpenList签名失败: object not found');
    };

    try {
        await assert.rejects(
            () => service._writeStrmWithRetry({}, 'dir', 'EP100.4K.mp4', {}, strmPath),
            (error) => {
                assert.match(error.message, /object not found/);
                assert.equal(error.attempts, 3);
                return true;
            }
        );
        assert.equal(calls, 3);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
