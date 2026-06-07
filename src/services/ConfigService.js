const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SECRET_PLACEHOLDER = '********';

class ConfigService {
  constructor() {
    // 配置文件路径
    this._configPath = path.join(__dirname, '../../data');
    this._configFile = this._configPath + '/config.json';
    this._config = {
      task: {
        taskExpireDays: 3,
        taskCheckCron: '0 19-23 * * *',
        cleanRecycleCron: '0 */8 * * *',
        maxRetries: 3,        // 最大重试次数
        retryInterval: 300,   // 重试间隔（秒）
        enableAutoClearRecycle: false,
        enableAutoClearFamilyRecycle: false,
        mediaSuffix: '.mkv;.iso;.ts;.mp4;.avi;.rmvb;.wmv;.m2ts;.mpg;.flv;.rm;.mov', // 媒体文件后缀
        enableOnlySaveMedia: false, // 只保存媒体文件
        // 文件夹不存在时重新创建
        enableAutoCreateFolder: false,
      },
      wecom: {
        enable: false,
        webhook: ''
      },
      telegram: {
        enable: false,
        proxyDomain: '',
        botToken: '',
        chatId: '',
        bot: {
          enable: false,
          botToken: '',
          chatId: ''
        }
      },
      wxpusher: {
        enable: false,
        spt: ''
      },
      proxy: {
        host: '',
        port: 0,
        username: '',
        password: '',
        services: {
          telegram: true,
          tmdb: true,
          openai: true,
          cloud189: false,
          quark: false,
          customPush: false
        }
      },
      bark: {
        enable: false,
        serverUrl: '', 
        key: ''
      },
      pushplus: {
        enable: false,           // 是否启用推送
        token: '',              // PushPlus token
        topic: '',              // 群组编码，不填仅发送给自己
        channel: 'wechat',      // 发送渠道：wechat/webhook/cp/sms/mail
        webhook: '',            // webhook编码，仅在channel为webhook时需要
        to: ''                  // 好友令牌，用于指定接收消息的用户
    },
      smartStrm: {
        enable: false,
        webhook: '',
        taskMapping: ''
      },
      fntv: {
        enable: false,
        base_url: '',       // 飞牛影视服务器地址，例如 http://10.0.0.6:5666
        username: '',       // 飞牛影视用户名
        password: '',       // 飞牛影视密码
        secret_string: '',  // 飞牛影视密钥字符串
        api_key: '',        // 飞牛影视 API 密钥
        mdb_mapping: '',    // 媒体库映射，格式：关键字:mdb_name，支持换行或分号分隔
      },
      system: {
        username: 'admin',
        password: 'admin',
        baseUrl: '',
        apiKey: '',
        corsOrigins: '',
        sessionSecret: ''
      },
      strm: {
        enable: false,
      },
      emby: {
        enable: false,
        serverUrl: '',
        apiKey: ''
      },
      cloudSaver: {
        baseUrl: '',
        username: '',
        password: ''
      },
      tmdb: {
        enableScraper: false,
        apiKey: '',
        tmdbApiKey: ''
      },
      openai: {
        enable: false,
        baseUrl: '',
        apiKey: '',
        model: 'GLM-4-Flash-250414',
        rename: {
          template: "{name} - {se}{ext}",  // 默认模板
          movieTemplate: "{name} ({year}){ext}",  // 电影模板
        }
      },
      alist: {
        enable: false,
        baseUrl: '',
        apiKey: ''
      },
      customPush: [] // 自定义推送
    };
    this._configSchema = JSON.parse(JSON.stringify(this._config));
    this._sensitiveKeys = new Set([
      'telegram.botToken',
      'telegram.bot.botToken',
      'proxy.password',
      'bark.key',
      'pushplus.token',
      'pushplus.webhook',
      'pushplus.to',
      'smartStrm.webhook',
      'fntv.password',
      'fntv.secret_string',
      'fntv.api_key',
      'system.password',
      'system.apiKey',
      'system.sessionSecret',
      'emby.apiKey',
      'cloudSaver.password',
      'tmdb.apiKey',
      'tmdb.tmdbApiKey',
      'openai.apiKey',
      'alist.apiKey'
    ]);
    this._init();
  }

  _init() {
    try {
      if (!fs.existsSync(this._configPath)) {
        fs.mkdirSync(this._configPath, { recursive: true });
      }
      if (fs.existsSync(this._configFile)) {
        const data = fs.readFileSync(this._configFile, 'utf8');
        const fileConfig = JSON.parse(data);
        this._config = this._deepMerge(this._config, fileConfig);
      }else {
        this._saveConfig();
      }
    } catch (error) {
      console.error('系统配置初始化失败:', error);
    }
  }

  // 添加深度合并方法
  _deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] instanceof Object && !Array.isArray(source[key])) {
        result[key] = this._deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }


  _saveConfig() {
    try {
      fs.writeFileSync(this._configFile, JSON.stringify(this._config, null, 2));
      try {
        fs.chmodSync(this._configFile, 0o600);
      } catch (chmodError) {
        console.warn('系统配置权限设置失败:', chmodError.message);
      }
    } catch (error) {
      console.error('系统配置保存失败:', error);
    }
  }

  getConfig() {
    return this._config;
  }

  getPublicConfig() {
    return this._maskSensitiveConfig(this._config);
  }

  setConfig(config) {
    const filteredConfig = this._filterAllowedConfig(config, this._configSchema);
    this._config = this._mergeConfig(this._config, filteredConfig);
    this._saveConfig();
  }

  _filterAllowedConfig(source, schema) {
    if (!source || typeof source !== 'object') return {};
    if (Array.isArray(schema)) {
      return Array.isArray(source) ? source : [];
    }
    const result = {};
    for (const key of Object.keys(schema)) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const schemaValue = schema[key];
        if (schemaValue && typeof schemaValue === 'object' && !Array.isArray(schemaValue)) {
          result[key] = this._filterAllowedConfig(sourceValue, schemaValue);
        } else {
          result[key] = sourceValue;
        }
      }
    }
    return result;
  }

  _mergeConfig(target, source, prefix = '') {
    const result = Array.isArray(target) ? [...target] : { ...target };
    for (const key of Object.keys(source || {})) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      const sourceValue = source[key];
      const targetValue = target?.[key];

      if (this._sensitiveKeys.has(currentPath) && (sourceValue === '' || sourceValue === SECRET_PLACEHOLDER)) {
        continue;
      }
      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = this._mergeConfig(targetValue, sourceValue, currentPath);
      } else {
        result[key] = sourceValue;
      }
    }
    return result;
  }

  _maskSensitiveConfig(config, prefix = '') {
    if (Array.isArray(config)) {
      return config.map(item => this._maskSensitiveConfig(item, prefix));
    }
    if (!config || typeof config !== 'object') {
      return config;
    }
    const result = {};
    for (const key of Object.keys(config)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      const value = config[key];
      if (this._sensitiveKeys.has(currentPath)) {
        result[key] = value ? SECRET_PLACEHOLDER : '';
      } else {
        result[key] = this._maskSensitiveConfig(value, currentPath);
      }
    }
    return result;
  }

  getConfigValue(key, defaultValue = null) {
    const keys = key.split('.');
    let value = this._config;
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) break;
    }
    return value ?? defaultValue;
  }

  setConfigValue(key, value) {
    const keys = key.split('.');
    let current = this._config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    this._saveConfig();
  }

  getSessionSecret() {
    const envSecret = process.env.SESSION_SECRET;
    if (envSecret) return envSecret;

    let sessionSecret = this.getConfigValue('system.sessionSecret');
    if (!sessionSecret) {
      sessionSecret = crypto.randomBytes(32).toString('hex');
      this.setConfigValue('system.sessionSecret', sessionSecret);
    }
    return sessionSecret;
  }
}

// 导出单例实例
module.exports = new ConfigService();
