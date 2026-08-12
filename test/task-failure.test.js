const test = require('node:test');
const assert = require('node:assert/strict');

const { TaskService } = require('../src/services/task');

function createTaskService() {
    const savedTasks = [];
    const sentMessages = [];
    const service = new TaskService({
        async save(task) {
            savedTasks.push({ ...task });
            return task;
        }
    }, {});
    service.messageUtil = {
        sendMessage(message) {
            sentMessages.push(message);
        }
    };
    return { service, savedTasks, sentMessages };
}

test('分享被好友取消时直接失败且不进入重试队列', async () => {
    const { service, savedTasks, sentMessages } = createTaskService();
    const task = {
        id: 1,
        resourceName: '测试资源',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null
    };

    await service._handleTaskFailure(task, new Error('好友已取消了分享'));

    assert.equal(task.status, 'failed');
    assert.equal(task.retryCount, 0);
    assert.equal(task.nextRetryTime, null);
    assert.match(task.lastError, /好友已取消了分享/);
    assert.doesNotMatch(task.lastError, /重试 1\/3/);
    assert.equal(savedTasks.length, 1);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0], /好友已取消了分享/);
    assert.match(sentMessages[0], /不再重试/);
});

test('临时失败仍按配置进入重试队列', async () => {
    const { service, sentMessages } = createTaskService();
    const task = {
        id: 2,
        resourceName: '测试资源',
        status: 'processing',
        retryCount: 0,
        nextRetryTime: null
    };

    await service._handleTaskFailure(task, new Error('临时网络错误'));

    assert.equal(task.status, 'pending');
    assert.equal(task.retryCount, 1);
    assert.ok(task.nextRetryTime instanceof Date);
    assert.match(task.lastError, /临时网络错误 \(重试 1\/3\)/);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0], /正在重试\(1\/3\)/);
});
