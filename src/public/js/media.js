document.addEventListener('DOMContentLoaded', () => {
    // 监听表单提交
    document.getElementById('mediaForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveMediaSettings();
    });
});


async function saveMediaSettings() {
    const enableStrm = document.getElementById('enableStrm').checked
    const enableEmby = document.getElementById('enableEmby').checked
    const settings = {
        strm: {
            enable: enableStrm,
        },
        emby: {
            enable: enableEmby,
            serverUrl: document.getElementById('embyServer').value,
            apiKey: document.getElementById('embyApiKey').value,
        },
        cloudSaver: {
            baseUrl: document.getElementById('cloudSaverUrl').value,
            username: document.getElementById('cloudSaverUsername').value,
            password: document.getElementById('cloudSaverPassword').value,
        },
        tmdb: {
            enableScraper: document.getElementById('enableScraper').checked,
            tmdbApiKey: document.getElementById('tmdbApiKey').value
        },
        openai: {
            enable: document.getElementById('enableOpenAI').checked,
            baseUrl: document.getElementById('openaiBaseUrl').value, //  document.getElementById('openaiBaseUrl').value, // URL_ADDRESS.openai.co
            apiKey: document.getElementById('openaiApiKey').value,
            model: document.getElementById('openaiModel').value,
            rename: {
                template: document.getElementById('openaiTemplate').value,
                movieTemplate: document.getElementById('openaiMovieTemplate').value,
            }
        },
        alist: {
            enable: document.getElementById('enableAlist').checked,
            baseUrl: document.getElementById('alistServer').value,
            apiKey: document.getElementById('alistApiKey').value
        },
        fntv: {
            enable: document.getElementById('enableFntv').checked,
            base_url: document.getElementById('fntvBaseUrl').value,
            username: document.getElementById('fntvUsername').value,
            password: document.getElementById('fntvPassword').value,
            secret_string: document.getElementById('fntvSecretString').value,
            api_key: document.getElementById('fntvApiKey').value,
            mdb_mapping: document.getElementById('fntvMdbMapping').value,
        }
    };

    try {
        const response = await fetch('/api/settings/media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        const result = await response.json();
        if (result.success) {
            message.success('保存成功');
        } else {
            message.warning('保存失败: ' + result.error);
        }
    } catch (error) {
        message.warning('保存失败: ' + error.message);
    }
}

async function testFntvConnection() {
    const btn = document.getElementById('fntvTestBtn');
    const resultEl = document.getElementById('fntvTestResult');
    btn.disabled = true;
    btn.textContent = '测试中...';
    resultEl.textContent = '';
    resultEl.style.color = '';

    try {
        // 先保存当前填写的配置，确保后端读取最新值
        await saveMediaSettings();

        const response = await fetch('/api/fntv/test', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
            resultEl.textContent = '✅ ' + result.data;
            resultEl.style.color = 'var(--success-color, #52c41a)';
        } else {
            resultEl.textContent = '❌ ' + result.error;
            resultEl.style.color = 'var(--error-color, #ff4d4f)';
        }
    } catch (error) {
        resultEl.textContent = '❌ ' + error.message;
        resultEl.style.color = 'var(--error-color, #ff4d4f)';
    } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
    }
}