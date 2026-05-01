const crypto = require("crypto");
const got = require("got");

// 飞牛影视插件
// 该插件用于与飞牛影视服务器API交互，支持自动刷新媒体库
// 通过配置用户名、密码和密钥字符串进行认证，并提供媒体库扫描功能
class Fnv {
  // --- 配置信息 ---
  static defaultConfig = {
    base_url: "http://10.0.0.6:5666", // 飞牛影视服务器URL
    app_name: "trimemedia-web", // 飞牛影视应用名称
    username: "", // 飞牛影视用户名
    password: "", // 飞牛影视密码
    secret_string: "", // 飞牛影视密钥字符串
    api_key: "", // 飞牛影视API密钥
    token: null, // 飞牛影视认证Token (可选)
  };

  static defaultTaskConfig = {
    auto_refresh: false, // 是否自动刷新媒体库
    mdb_name: "", // 飞牛影视目标媒体库名称
    mdb_dir_list: "", // 飞牛影视目标媒体库文件夹路径列表，多个用逗号分隔
  };

  // 定义一个可选键的集合
  static optionalKeys = new Set(["token"]);

  // --- API 端点常量 ---
  static API_LOGIN = "/v/api/v1/login"; // 登录端点
  static API_MDB_LIST = "/v/api/v1/mdb/list"; // 获取媒体库列表
  static API_MDB_SCAN = "/v/api/v1/mdb/scan/{}"; // 刷新媒体库端点 ({}为媒体库ID)
  static API_TASK_STOP = "/v/api/v1/task/stop"; // 停止任务端点

  // JavaScript 构造函数不能 await；使用 Fnv.create(...) 可完成初始化和登录。
  constructor(options = {}) {
    this.pluginName = this.constructor.name.toLowerCase();
    this.isActive = false;
    this.token = null;

    for (const [key, value] of Object.entries(Fnv.defaultConfig)) {
      this[key] = Object.prototype.hasOwnProperty.call(options, key)
        ? options[key]
        : value;
    }
  }

  static async create(options = {}) {
    const client = new Fnv(options);
    await client.init();
    return client;
  }

  async init() {
    if (!this._checkConfig()) {
      return false;
    }

    if (this.token === null || this.token === "") {
      await this._login();
    }

    this.isActive = this.token !== null && this.token !== "";
    if (this.isActive) {
      console.log(`${this.pluginName}: 插件已激活 ✅`);
    } else {
      console.log(`${this.pluginName}: 插件未激活 ❌`);
    }

    return this.isActive;
  }

  // =====================================================================
  // Public Methods / Entry Points (公共方法/入口)
  // =====================================================================

  async run(task = {}) {
    // 插件运行主入口。
    // 根据任务配置，执行媒体库刷新操作。
    if (!this.isActive) {
      console.log("飞牛影视: 插件未激活，跳过任务。");
      return;
    }

    const taskConfig =
      task.addition?.[this.pluginName] ?? Fnv.defaultTaskConfig;

    if (!taskConfig.auto_refresh) {
      console.log("飞牛影视: 自动刷新未启用，跳过处理。");
      return;
    }

    const targetLibraryName = taskConfig.mdb_name;
    if (!targetLibraryName) {
      console.log("飞牛影视: 未指定媒体库名称，跳过处理。");
      return;
    }

    const targetLibraryMdbDirList = taskConfig.mdb_dir_list;
    let dirList = [];
    if (targetLibraryMdbDirList) {
      dirList = targetLibraryMdbDirList
        .split(",")
        .map((dirPath) => dirPath.trim())
        .filter(Boolean);
    }

    // 获取媒体库ID
    const libraryId = await this._getLibraryId(targetLibraryName);

    if (libraryId) {
      // 获取ID成功后，刷新该媒体库
      await this._refreshLibrary(libraryId, dirList);
    }
  }

  // =====================================================================
  // Internal Methods (内部实现方法)
  // =====================================================================

  _checkConfig() {
    // 检查配置是否完整
    const missingKeys = Object.keys(Fnv.defaultConfig).filter(
      (key) => !Fnv.optionalKeys.has(key) && !this[key],
    );

    if (missingKeys.length > 0) {
      // console.log(`${this.pluginName} 模块缺少必要参数: ${missingKeys.join(", ")}`);
      return false;
    }

    return true;
  }

  async _makeRequest(method, relUrl, params = null, data = null) {
    // 一个统一的私有方法，用于发送所有API请求。
    // 它会自动处理签名、请求头、错误和响应解析。
    // 当认证失败时，会自动尝试重新登录并重试，最多3次。
    const maxRetries = 3;
    const normalizedMethod = method.toLowerCase();

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const url = new URL(`${String(this.base_url).replace(/\/+$/, "")}${relUrl}`);
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          url.searchParams.append(key, value);
        }
      }

      const authx = this._cseSign(normalizedMethod, relUrl, params, data);
      if (!authx) {
        console.log(`飞牛影视: 为 ${relUrl} 生成签名失败，请求中止。`);
        return null;
      }

      const headers = {
        "Content-Type": "application/json",
        authx,
      };
      if (this.token) {
        headers.Authorization = this.token;
      }

      let responseData;
      try {
        const isGet = normalizedMethod === "get";
        const gotOptions = {
          method: normalizedMethod.toUpperCase(),
          headers,
          timeout: { request: 10000 },
        };
        if (isGet) {
          if (params) {
            gotOptions.searchParams = params;
          }
        } else {
          gotOptions.body = this._serializeData(data !== null ? data : {});
        }

        const response = await got(url.toString(), gotOptions);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new Error(`${response.statusCode} ${response.statusMessage}`);
        }
        responseData = JSON.parse(response.body);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`飞牛影视: 请求 ${url.toString()} 时出错: ${message}`);
        return null;
      }

      const responseCode = responseData.code;
      if (responseCode === undefined || responseCode === null) {
        console.log("飞牛影视: 响应格式错误，未找到 'code' 字段。");
        return null;
      }

      if (responseCode === 0) {
        return responseData;
      }

      if (responseCode === -2) {
        console.log(
          `飞牛影视: 认证失败 (尝试 ${attempt + 1}/${maxRetries})，尝试重新登录...`,
        );
        if (relUrl === Fnv.API_LOGIN) {
          console.log("飞牛影视: 登录接口认证失败，请检查用户名和密码。");
          return responseData;
        }
        if (!(await this._login())) {
          console.log("飞牛影视: 重新登录失败，无法继续请求。");
          return null;
        }
        continue;
      }

      const msg = responseData.msg ?? "未知错误";
      console.log(`飞牛影视: API调用失败 (${relUrl}): ${msg}`);
      return responseData;
    }

    console.log(`飞牛影视: 请求 ${relUrl} 在尝试 ${maxRetries} 次后仍然失败。`);
    return null;
  }

  async _login() {
    // 登录到飞牛影视服务器并获取认证token。
    const appName = this.app_name || Fnv.defaultConfig.app_name;
    const username = this.username || Fnv.defaultConfig.username;
    const password = this.password || Fnv.defaultConfig.password;
    console.log("飞牛影视: 正在尝试登录...");

    const payload = { username, password, app_name: appName };
    const responseJson = await this._makeRequest("post", Fnv.API_LOGIN, null, payload);

    if (responseJson?.data?.token) {
      this.token = responseJson.data.token;
      console.log("飞牛影视: 登录成功 ✅");
      return true;
    }

    console.log("飞牛影视: 登录失败 ❌");
    return false;
  }

  async _getLibraryId(libraryName) {
    // 根据媒体库的名称获取其唯一ID (guid)。
    if (!this.token) {
      console.log("飞牛影视: 必须先登录才能获取媒体库列表。");
      return null;
    }

    console.log(`飞牛影视: 正在查找媒体库 '${libraryName}'...`);
    const responseJson = await this._makeRequest("get", Fnv.API_MDB_LIST);

    if (responseJson?.data) {
      for (const library of responseJson.data) {
        if (library.name === libraryName) {
          console.log(`飞牛影视: 找到目标媒体库 ✅，ID: ${library.guid}`);
          return library.guid;
        }
      }
      console.log(`飞牛影视: 未在媒体库列表中找到名为 '${libraryName}' 的媒体库 ❌`);
    }

    return null;
  }

  async _refreshLibrary(libraryId, dirList = null) {
    // 根据给定的媒体库ID触发一次媒体库扫描/刷新。
    if (!this.token) {
      console.log("飞牛影视: 必须先登录才能刷新媒体库。");
      return false;
    }

    if (dirList && dirList.length > 0) {
      console.log(`飞牛影视: 正在为媒体库 ${libraryId} 发送部分目录${JSON.stringify(dirList)}刷新指令...`);
    } else {
      console.log(`飞牛影视: 正在为媒体库 ${libraryId} 发送刷新指令...`);
    }

    const relUrl = Fnv.API_MDB_SCAN.replace("{}", libraryId);
    const requestBody = dirList && dirList.length > 0 ? { dir_list: dirList } : {};
    const responseJson = await this._makeRequest("post", relUrl, null, requestBody);

    if (!responseJson) {
      return false;
    }

    const responseCode = responseJson.code;
    if (responseCode === 0) {
      console.log("飞牛影视: 发送刷新指令成功 ✅");
      return true;
    }

    if (responseCode === -14) {
      if (await this._stopRefreshTask(libraryId)) {
        console.log("飞牛影视: 发现重复任务，已停止旧任务，重新发送刷新指令...");
        const retryJson = await this._makeRequest("post", relUrl, null, {});
        if (retryJson?.code === 0) {
          console.log("飞牛影视: 发送刷新指令成功 ✅");
          return true;
        }
        console.log("飞牛影视: 重新发送刷新指令失败 ❌");
      } else {
        console.log("飞牛影视: 停止旧任务失败，无法继续刷新操作 ❌");
      }
    }

    return false;
  }

  async _stopRefreshTask(libraryId) {
    // 停止指定的媒体库刷新任务。
    if (!this.token) {
      console.log("飞牛影视: 必须先登录才能停止刷新任务。");
      return false;
    }

    console.log(`飞牛影视: 正在停止媒体库刷新任务 ${libraryId}...`);
    const payload = { guid: libraryId, type: "TaskItemScrap" };
    const responseJson = await this._makeRequest("post", Fnv.API_TASK_STOP, null, payload);

    if (responseJson?.code === 0) {
      console.log("飞牛影视: 停止刷新任务成功 ✅");
      return true;
    }

    console.log("飞牛影视: 停止刷新任务失败 ❌");
    return false;
  }

  _cseSign(method, path, params = null, data = null) {
    // 为API请求生成 cse 签名参数字符串。
    const nonce = String(Math.floor(100000 + Math.random() * 900000));
    const timestamp = String(Date.now());

    let serializedStr = "";
    if (method.toLowerCase() === "get") {
      if (params) {
        serializedStr = new URLSearchParams(
          Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
        ).toString();
      }
    } else {
      serializedStr = this._serializeData(data);
    }

    const bodyHash = this._md5Hash(serializedStr);
    const stringToSign = [
      this.secret_string,
      path,
      nonce,
      timestamp,
      bodyHash,
      this.api_key,
    ].join("_");
    const finalSign = this._md5Hash(stringToSign);

    return `nonce=${nonce}&timestamp=${timestamp}&sign=${finalSign}`;
  }

  // =====================================================================
  // Static Utility Methods (静态工具方法)
  // =====================================================================

  _md5Hash(value) {
    // 计算并返回字符串的小写 MD5 哈希值。
    return crypto.createHash("md5").update(value, "utf8").digest("hex");
  }

  _serializeData(data) {
    // 将请求体数据序列化为紧凑的JSON字符串。
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return stableStringify(data);
    }
    if (typeof data === "string") {
      return data;
    }
    if (!data) {
      return "";
    }
    return "";
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

module.exports = Fnv;

