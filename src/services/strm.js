const fs = require('fs').promises;
const path = require('path');
const got = require('got');
const ConfigService = require('./ConfigService');
const { logTaskEvent } = require('../utils/logUtils');
const CryptoUtils = require('../utils/cryptoUtils');
const alistService = require('./alistService');
const { MessageUtil } = require('./message');

class StrmService {
    constructor() {
        this.enable = ConfigService.getConfigValue('strm.enable');
        this.baseDir = path.join(__dirname + '../../../strm');
        // 从环境变量获取 PUID 和 PGID，默认值设为 0
        this.puid = process.env.PUID || 0;
        this.pgid = process.env.PGID || 0;
        this.dirMode = parseInt(process.env.STRM_DIR_MODE || '775', 8);
        this.fileMode = parseInt(process.env.STRM_FILE_MODE || '664', 8);
        this.messageUtil = new MessageUtil();
    }

    // 确保目录存在并设置权限和组
    async _ensureDirectoryExists(dirPath) {
        // 确保使用相对路径
        const relativePath = dirPath.startsWith(this.baseDir) 
            ? path.relative(this.baseDir, dirPath)
            : dirPath;
            
        const parts = relativePath.split(path.sep);
        let currentPath = this.baseDir;  // 从基础目录开始

        for (const part of parts) {
            if (part) {
                currentPath = path.join(currentPath, part);
                try {
                    await fs.mkdir(currentPath);
                    if (process.getuid && process.getuid() === 0) {
                        await fs.chown(currentPath, parseInt(this.puid), parseInt(this.pgid));
                    }
                    await fs.chmod(currentPath, this.dirMode);
                } catch (error) {
                    if (error.code !== 'EEXIST') {
                        throw new Error(`创建目录失败: ${error.message}`);
                    }
                }
            }
        }
    }

    _normalizePath(value = '') {
        return String(value)
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\/+|\/+$/g, '');
    }

    _dropFirstPathSegment(value = '') {
        const parts = this._normalizePath(value).split('/').filter(Boolean);
        return parts.slice(1).join('/');
    }

    _getRelativePath(fullPath, rootPath = '') {
        const normalizedFullPath = this._normalizePath(fullPath);
        const normalizedRootPath = this._normalizePath(rootPath);
        if (!normalizedFullPath) return '';
        if (!normalizedRootPath) return this._dropFirstPathSegment(normalizedFullPath);
        if (normalizedFullPath === normalizedRootPath) return '';
        if (normalizedFullPath.startsWith(`${normalizedRootPath}/`)) {
            return normalizedFullPath.slice(normalizedRootPath.length + 1);
        }
        return normalizedFullPath;
    }

    _joinPath(...parts) {
        return this._normalizePath(parts.filter(part => part !== undefined && part !== null && part !== '').join('/'));
    }

    _getFileName(file = {}) {
        return file.name || file.fileName || path.basename(file.relativePath || '');
    }

    _getFileRelativeDir(file = {}) {
        const relativeDir = this._normalizePath(file.relativeDir || '');
        if (relativeDir) return relativeDir;

        const relativePath = this._normalizePath(file.relativePath || '');
        if (!relativePath) return '';

        const parts = relativePath.split('/').filter(Boolean);
        parts.pop();
        return parts.join('/');
    }

    getAccountCloudRootPath(account) {
        const cloudStrmPrefix = account?.cloudStrmPrefix || '';
        if (!cloudStrmPrefix) return '';

        try {
            const prefixUrl = new URL(cloudStrmPrefix);
            const pathname = decodeURIComponent(prefixUrl.pathname || '');
            const dIndex = pathname.indexOf('/d/');
            return this._normalizePath(dIndex >= 0 ? pathname.slice(dIndex + 3) : pathname);
        } catch (error) {
            const pathWithoutQuery = cloudStrmPrefix.split(/[?#]/)[0];
            const dIndex = pathWithoutQuery.indexOf('/d/');
            return this._normalizePath(dIndex >= 0 ? pathWithoutQuery.slice(dIndex + 3) : pathWithoutQuery);
        }
    }

    getTaskRelativePath(task) {
        return this._getRelativePath(task?.realFolderName || '', this.getAccountCloudRootPath(task?.account));
    }

    getTaskLocalRelativePath(task) {
        return path.join(task.account.localStrmPrefix || '', this.getTaskRelativePath(task));
    }

    getTaskStrmDir(task) {
        return path.join(this.baseDir, this.getTaskLocalRelativePath(task));
    }

    getAccountLocalRootPath(account) {
        return path.join(account.localStrmPrefix || '');
    }

    getAccountAlistPath(account, relativePath = '') {
        return this._joinPath(this.getAccountCloudRootPath(account), relativePath);
    }

    _isOpenListDirectUrl(value) {
        try {
            const url = new URL(value);
            return ['http:', 'https:'].includes(url.protocol) && url.pathname.includes('/d/');
        } catch (error) {
            return false;
        }
    }

    _appendSignToUrl(value, sign) {
        if (!sign) return value;
        try {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol)) return value;
            url.searchParams.set('sign', sign);
            return url.toString();
        } catch (error) {
            return value;
        }
    }

    _hasSignParam(value) {
        try {
            const url = new URL(value);
            return url.searchParams.has('sign');
        } catch (error) {
            return false;
        }
    }

    _appendQueryParamsToUrl(value, params = {}) {
        try {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol)) return value;
            Object.entries(params).forEach(([key, paramValue]) => {
                if (paramValue !== undefined && paramValue !== null && paramValue !== '') {
                    url.searchParams.set(key, paramValue);
                }
            });
            return url.toString();
        } catch (error) {
            return value;
        }
    }

    _isCasFileName(value = '') {
        return String(value || '').toLowerCase().endsWith('.cas');
    }

    _getCasFallbackRestoreName(casName = '') {
        return String(casName || '').replace(/\.cas$/i, '');
    }

    _deriveCasRestoreName(casName, originalName = '') {
        const nameWithoutCas = this._getCasFallbackRestoreName(casName);
        const baseName = path.parse(nameWithoutCas).name;
        const originalExt = path.extname(originalName || nameWithoutCas);
        const fallbackBaseName = path.parse(originalName || nameWithoutCas).name;
        return `${baseName || fallbackBaseName}${originalExt}`;
    }

    _decodeCasContent(content) {
        const decoded = Buffer.from(String(content || '').trim(), 'base64').toString('utf8');
        const payload = JSON.parse(decoded);
        const info = {
            name: payload.name || payload.Name || '',
            size: payload.size ?? payload.Size,
            md5: payload.md5 || payload.MD5 || '',
            sliceMd5: payload.sliceMd5 || payload.SliceMD5 || payload.sliceMD5 || ''
        };
        if (!info.name || info.size === undefined || info.size < 0 || !info.md5) {
            throw new Error('无效的CAS元数据');
        }
        if (!info.sliceMd5) {
            info.sliceMd5 = info.md5;
        }
        return info;
    }

    async _fetchCasInfoFromCloud189(account, file = {}) {
        const fileId = file.id || file.fileId;
        const CloudUtils = require('../utils/CloudUtils');
        if (!fileId || CloudUtils.isQuarkAccount(account)) {
            return null;
        }
        const cloud189 = CloudUtils.getService(account);
        const content = await cloud189.getFileText(fileId);
        return this._decodeCasContent(content);
    }

    async _fetchCasInfoFromOpenList(account, relativePath, fileName, fileInfo = {}) {
        const contentUrl = this._joinUrl(account.cloudStrmPrefix || '', this._joinPath(relativePath, fileName));
        if (!this._isOpenListDirectUrl(contentUrl)) {
            return null;
        }
        let url = contentUrl;
        try {
            const sign = fileInfo?.sign || await this._getOpenListSign(account, relativePath, fileName, fileInfo);
            url = this._appendSignToUrl(url, sign);
        } catch (error) {
            // 允许公开路径或旧配置继续尝试读取。
        }
        const response = await got(url, {
            followRedirect: true,
            throwHttpErrors: false,
            timeout: { request: 30000 }
        });
        if (response.statusCode >= 300) {
            return null;
        }
        return this._decodeCasContent(response.body);
    }

    async _getCasInfo(account, relativePath, fileName, fileInfo = {}) {
        if (fileInfo.casInfo) {
            return fileInfo.casInfo;
        }
        try {
            const cloudInfo = await this._fetchCasInfoFromCloud189(account, fileInfo);
            if (cloudInfo) {
                fileInfo.casInfo = cloudInfo;
                return cloudInfo;
            }
        } catch (error) {
            logTaskEvent(`读取天翼CAS元数据失败: ${fileName}, 错误: ${error.message}`);
        }
        try {
            const openListInfo = await this._fetchCasInfoFromOpenList(account, relativePath, fileName, fileInfo);
            if (openListInfo) {
                fileInfo.casInfo = openListInfo;
                return openListInfo;
            }
        } catch (error) {
            logTaskEvent(`读取OpenList CAS元数据失败: ${fileName}, 错误: ${error.message}`);
        }
        return null;
    }

    async _getPlayableFileName(file, account, relativePath, mediaSuffixs) {
        const fileName = this._getFileName(file);
        if (!this._isCasFileName(fileName)) {
            return fileName;
        }

        const fallbackName = this._getCasFallbackRestoreName(fileName);
        if (this._checkNameSuffix(fallbackName, mediaSuffixs)) {
            return fallbackName;
        }

        const casInfo = await this._getCasInfo(account, relativePath, fileName, file);
        if (!casInfo) {
            return fallbackName;
        }
        return this._deriveCasRestoreName(fileName, casInfo.name);
    }

    _getStrmBaseName(sourceFileName, playableFileName) {
        const parsedPath = path.parse(playableFileName || sourceFileName || '');
        if (!this._isCasFileName(sourceFileName)) {
            return parsedPath.name;
        }
        const mediaExt = parsedPath.ext.replace(/^\./, '');
        if (!mediaExt) {
            return parsedPath.name;
        }
        return `${parsedPath.name}.(${mediaExt})`;
    }

    async _shouldSkipExistingStrm(strmPath, overwrite) {
        if (overwrite) {
            return false;
        }
        try {
            const content = (await fs.readFile(strmPath, 'utf8')).trim();
            return !this._isOpenListDirectUrl(content) || this._hasSignParam(content);
        } catch (err) {
            return false;
        }
    }

    async _getOpenListSign(account, relativePath, fileName, fileInfo = {}) {
        if (fileInfo?.sign) {
            return fileInfo.sign;
        }

        const alistPath = this.getAccountAlistPath(account, this._joinPath(relativePath, fileName));
        const response = await alistService.getFile(alistPath);
        if (response?.code && response.code !== 200) {
            throw new Error(`获取OpenList签名失败: ${response.message || response.code}`);
        }
        const sign = response?.data?.sign || '';
        if (!sign) {
            throw new Error(`OpenList未返回签名: ${alistPath}`);
        }
        return sign;
    }

    async _buildStrmContent(account, relativePath, fileName, fileInfo = {}) {
        let content = this._joinUrl(account.cloudStrmPrefix || '', this._joinPath(relativePath, fileName));
        if (!this._isOpenListDirectUrl(content)) {
            return content;
        }

        const sign = await this._getOpenListSign(account, relativePath, fileName, fileInfo);
        content = this._appendSignToUrl(content, sign);
        if (this._isCasFileName(fileName)) {
            return this._appendQueryParamsToUrl(content, { type: 'cas_video' });
        }
        return content;
    }

    /**
     * 生成 STRM 文件
     * @param {Array} files - 文件列表，每个文件对象需包含 name 属性
     * @param {boolean} overwrite - 是否覆盖已存在的文件
     * @param {boolean} compare - 是否比较文件名 默认比较
     * @returns {Promise<Array>} - 返回生成的文件列表
     */
    async generate(task, files, overwrite = false, compare = true) {
        if (!this.enable){
            logTaskEvent(`STRM生成未启用, 请启用后执行`);
            return;
        }
        logTaskEvent(`${task.resourceName} 开始生成STRM文件, 总文件数: ${files.length}`);
        const results = [];
        let success = 0;
        let failed = 0;
        let skipped = 0;
        try {
            // mediaSuffixs转为小写
            const mediaSuffixs = ConfigService.getConfigValue('task.mediaSuffix').split(';').map(suffix => suffix.toLowerCase())
            const taskRelativePath = this.getTaskRelativePath(task);
            // 构建完整的目标目录路径
            const rootTargetDir = this.getTaskStrmDir(task);
            if (compare) {
                // 查询出所有目录下的.strm文件
                const strmFiles = await this.listStrmFiles(this.getTaskLocalRelativePath(task));
                const expectedStrmFiles = new Set();
                for (const file of files) {
                    const fileRelativeDir = this._getFileRelativeDir(file);
                    const contentRelativePath = this._joinPath(taskRelativePath, fileRelativeDir);
                    const playableFileName = await this._getPlayableFileName(file, task.account, contentRelativePath, mediaSuffixs);
                    if (!this._checkNameSuffix(playableFileName, mediaSuffixs)) {
                        continue;
                    }
                    const strmBaseName = this._getStrmBaseName(this._getFileName(file), playableFileName);
                    expectedStrmFiles.add(path.join(this.getTaskLocalRelativePath(task), fileRelativeDir, `${strmBaseName}.strm`));
                }
                // 将不在strmFiles中的文件删除
                for (const file of strmFiles) {
                    if (!expectedStrmFiles.has(file.path)) {
                        await this.delete(file.path);
                    }
                }
            }
            overwrite && await this._deleteDirAllStrm(rootTargetDir)
            await this._ensureDirectoryExists(rootTargetDir);
            for (const file of files) {
                // 检查文件是否是媒体文件
                const fileName = this._getFileName(file);
                const fileRelativeDir = this._getFileRelativeDir(file);
                const contentRelativePath = this._joinPath(taskRelativePath, fileRelativeDir);
                const playableFileName = await this._getPlayableFileName(file, task.account, contentRelativePath, mediaSuffixs);
                if (!this._checkNameSuffix(playableFileName, mediaSuffixs)) {
                    // logTaskEvent(`文件不是媒体文件，跳过: ${file.name}`);
                    skipped++
                    continue;
                }
                
                try {
                    const targetDir = path.join(rootTargetDir, fileRelativeDir);
                    const strmBaseName = this._getStrmBaseName(fileName, playableFileName);
                    const strmPath = path.join(targetDir, `${strmBaseName}.strm`);

                    await this._ensureDirectoryExists(targetDir);

                    // 检查文件是否存在
                    if (await this._shouldSkipExistingStrm(strmPath, overwrite)) {
                        // logTaskEvent(`STRM文件已存在，跳过: ${strmPath}`);
                        skipped++
                        continue;
                    }

                    // 生成STRM文件内容
                    const content = await this._buildStrmContent(task.account, contentRelativePath, fileName, file);
                    await fs.writeFile(strmPath, content, 'utf8');
                    // 设置文件权限
                    if (process.getuid && process.getuid() === 0) {
                        await fs.chown(strmPath, parseInt(this.puid), parseInt(this.pgid));
                    }
                    await fs.chmod(strmPath, this.fileMode);
                    results.push({
                        originalFile: fileName,
                        strmFile: `${strmBaseName}.strm`,
                        path: strmPath
                    });
                    logTaskEvent(`生成STRM文件成功: ${strmPath}`);
                    success++
                } catch (error) {
                    logTaskEvent(`生成STRM文件失败: ${fileName}, 错误: ${error.message}`);
                    failed++
                }
            }
        } catch (error) {
            console.log(error)
            logTaskEvent(`生成STRM文件失败: ${error.message}`);
            failed++
        }
        // 记录文件总数, 成功数, 失败数, 跳过数
        const message = `🎉${task.resourceName} 生成STRM文件完成, 总文件数: ${files.length}, 成功数: ${success}, 失败数: ${failed}, 跳过数: ${skipped}`
        logTaskEvent(message);
        return message;
    }

    /**
     * 批量生成STRM文件 根据Alist目录
     * @param {string} startPath - 起始目录路径
     * @returns {Promise<object>} - 返回处理结果统计
     */
    async generateAll(accounts, overwrite = false) {
        if (!alistService.Enable()) {
            throw new Error('Alist功能未启用');
        }
        const messages = [];
        for(const account of accounts) {
            try {
                const startPath = this.getAccountCloudRootPath(account);
                if (!startPath) {
                    throw new Error(`账号 ${account.username} 未配置媒体目录`);
                }
                if (!this._normalizePath(account.localStrmPrefix)) {
                    throw new Error(`账号 ${account.username} 未配置本地目录`);
                }
                // 初始化统计信息
                const stats = {
                    success: 0,
                    failed: 0,
                    skipped: 0,
                    totalFiles: 0,
                    processedDirs: new Set()
                };
                // 获取媒体文件后缀列表
                const mediaSuffixs = ConfigService.getConfigValue('task.mediaSuffix').split(';').map(suffix => suffix.toLowerCase());
                 // 如果覆盖 则直接删除currentPath
                if (overwrite) {
                    await this.deleteDir(this.getAccountLocalRootPath(account))
                }
                await this._processDirectory(startPath, account, stats, mediaSuffixs, overwrite, startPath);
                const userrname = account.username.replace(/(.{3}).*(.{4})/, '$1****$2');
                // 生成最终统计信息
                const message = `🎉账号: ${userrname}生成STRM文件完成\n` +
                              `处理目录数: ${stats.processedDirs.size}\n` +
                              `总文件数: ${stats.totalFiles}\n` +
                              `成功数: ${stats.success}\n` +
                              `失败数: ${stats.failed}\n` +
                              `跳过数: ${stats.skipped}`;
                logTaskEvent(message);
                messages.push(message);
            } catch (error) {
                const message = `生成STRM文件失败: ${error.message}`;
                logTaskEvent(message);
            }
        }
        if (messages.length > 0) {
            this.messageUtil.sendMessage(messages.join('\n\n'));
        }   
    }

    /**
     * 处理单个目录
     * @param {string} dirPath - 目录路径
     * @param {object} stats - 统计信息
     * @param {array} mediaSuffixs - 媒体文件后缀列表
     * @private
     */
    async _processDirectory(dirPath, account, stats, mediaSuffixs, overwrite, rootPath = dirPath) {
        // 获取alist文件列表
        const alistResponse = await alistService.listFiles(dirPath);
        if (!alistResponse || !alistResponse.data) {
            throw new Error(`获取Alist文件列表失败: ${dirPath}`);
        }
        if (!alistResponse.data.content) {
            return;
        }

        const files = alistResponse.data.content;
        stats.processedDirs.add(dirPath);
        logTaskEvent(`开始处理目录 ${dirPath}, 文件数量: ${files.length}`);

        for (const file of files) {
            try {
                if (file.is_dir) {
                    // 递归处理子目录
                    await this._processDirectory(this._joinPath(dirPath, file.name), account, stats, mediaSuffixs, overwrite, rootPath);
                } else {
                    stats.totalFiles++;
                    const relativePath = this._getRelativePath(dirPath, rootPath);
                    const playableFileName = await this._getPlayableFileName(file, account, relativePath, mediaSuffixs);
                    // 检查是否为媒体文件
                    if (!this._checkNameSuffix(playableFileName, mediaSuffixs)) {
                        // console.log(`文件不是媒体文件，跳过: ${file.name}`);
                        stats.skipped++;
                        continue;
                    }

                    // 构建STRM文件路径
                    const targetDir = path.join(this.baseDir, account.localStrmPrefix, relativePath);
                    const strmBaseName = this._getStrmBaseName(file.name, playableFileName);
                    const strmPath = path.join(targetDir, `${strmBaseName}.strm`);
                    // overwrite && await this._deleteDirAllStrm(targetDir)
                    // 检查文件是否存在
                    if (await this._shouldSkipExistingStrm(strmPath, overwrite)) {
                        // console.log(`STRM文件已存在，跳过: ${strmPath}`);
                        stats.skipped++
                        continue;
                    }

                    await this._ensureDirectoryExists(targetDir);

                    // 生成STRM文件内容
                    const content = await this._buildStrmContent(account, relativePath, file.name, file);
                    // 写入STRM文件
                    await fs.writeFile(strmPath, content, 'utf8');
                    if (process.getuid && process.getuid() === 0) {
                        await fs.chown(strmPath, parseInt(this.puid), parseInt(this.pgid));
                    }
                    await fs.chmod(strmPath, this.fileMode);

                    stats.success++;
                    logTaskEvent(`生成STRM文件成功: ${strmPath}`);
                }
            } catch (error) {
                stats.failed++;
                logTaskEvent(`处理文件失败: ${file.name}, 错误: ${error.message}`);
            }
        }
    }

    async listStrmFiles(dirPath = '') {
        try {
            const targetPath = path.join(this.baseDir, dirPath);
            const results = [];
            
            // 检查目录是否存在
            try {
                await fs.access(targetPath);
            } catch (err) {
                return results;
            }
            // 读取目录内容
            const items = await fs.readdir(targetPath, { withFileTypes: true });
            for (const item of items) {
                const fullPath = path.join(targetPath, item.name);
                const relativePath = path.relative(this.baseDir, fullPath);
                if (item.isDirectory()) {
                    const childResults = await this.listStrmFiles(relativePath);
                    results.push(...childResults);
                } else if (item.isFile() && !item.name.startsWith('.') && path.extname(item.name) === '.strm') {
                    // 读取STRM文件内容
                    results.push({
                        id: item.name,
                        name: item.name,
                        path: relativePath
                    });
                }
            }
            
            return results;
        } catch (error) {
            throw new Error(`列出STRM文件失败: ${error.message}`);
        }
    }

    /**
     * 删除STRM文件
     * @param {string} fileName - 原始文件名
     * @returns {Promise<void>}
     */
    async delete(fileName) {
        const parsedPath = path.parse(fileName);
        const dirPath = parsedPath.dir;
        const fileNameWithoutExt = parsedPath.name;
        const strmPath = path.join(this.baseDir, dirPath, `${fileNameWithoutExt}.strm`);
        const nfoPath = path.join(this.baseDir, dirPath, `${fileNameWithoutExt}.nfo`);
        const thumbPath = path.join(this.baseDir, dirPath, `${fileNameWithoutExt}-thumb.jpg`);
        try {
           // 删除 .strm 文件
           try {
                await fs.access(strmPath);
                await fs.unlink(strmPath);
                logTaskEvent(`删除STRM文件成功: ${strmPath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') { // 如果不是文件不存在错误，则记录
                    logTaskEvent(`尝试删除STRM文件失败: ${strmPath}, 错误: ${err.message}`);
                }
            }

            // 删除 .nfo 文件
            try {
                await fs.access(nfoPath);
                await fs.unlink(nfoPath);
                logTaskEvent(`删除NFO文件成功: ${nfoPath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') { // 如果不是文件不存在错误，则记录
                    logTaskEvent(`尝试删除NFO文件失败: ${nfoPath}, 错误: ${err.message}`);
                }
            }

            // 删除 -thumb.jpg 图片
            try {
                await fs.access(thumbPath);
                await fs.unlink(thumbPath);
                logTaskEvent(`删除Thumb图片成功: ${thumbPath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') { // 如果不是文件不存在错误，则记录
                    logTaskEvent(`尝试删除Thumb图片失败: ${thumbPath}, 错误: ${err.message}`);
                }
            }
            
            // 尝试删除空目录
            const targetDir = path.join(this.baseDir, dirPath);
            const files = await fs.readdir(targetDir);
            if (files.length === 0) {
                await fs.rmdir(targetDir);
                logTaskEvent(`删除空目录: ${targetDir}`);
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw new Error(`删除STRM文件失败: ${error.message}`);
            }
        }
    }
    // 删除目录
    async deleteDir(dirPath) {
        try {
            const targetDir = path.join(this.baseDir, dirPath);
             // 检查目录是否存在
             try {
                await fs.access(targetDir);
            } catch (err) {
                // 目录不存在，直接返回
                // logTaskEvent(`STRM目录不存在，跳过删除: ${targetDir}`);
                return;
            }
            await fs.rm(targetDir, { recursive: true });
            logTaskEvent(`删除STRM目录成功: ${targetDir}`);

            // 检查并删除空的父目录
            const parentDir = path.dirname(targetDir);
            try {
                const files = await fs.readdir(parentDir);
                if (files.length === 0) {
                    await fs.rm(parentDir, { recursive: true });
                    logTaskEvent(`删除空目录: ${parentDir}`);
                }
            } catch (err) {
                
            }
        } catch (error) {
            logTaskEvent(`删除STRM目录失败: ${error.message}`);
        }
    }
    // 删除目录下的所有.strm文件
    async  _deleteDirAllStrm(dirPath) {
        // 检查目录是否存在
        try {
            await fs.access(dirPath);
        } catch (err) {
            // 目录不存在，直接返回
            logTaskEvent(`STRM目录不存在，跳过删除: ${dirPath}`);
            return;
        }
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        await Promise.all(files.map(async file => {
            const filePath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                await this._deleteDirAllStrm(filePath);
            } else if (path.extname(filePath) === '.strm') {
                try {
                    await fs.unlink(filePath);
                    logTaskEvent(`删除文件成功: ${filePath}`);
                } catch (err) {
                    logTaskEvent(`删除文件失败: ${err.message}`);
                }
            }
        }));
    }
    _checkNameSuffix(fileName, mediaSuffixs) {
         const fileExt = path.extname(fileName || '').toLowerCase();
         return mediaSuffixs.includes(fileExt)
    }

    //检查文件是否是媒体文件
    _checkFileSuffix(file, mediaSuffixs) {
         return this._checkNameSuffix(this._getFileName(file), mediaSuffixs)
    }

    _joinUrl(base, path) {
        // 移除 base 末尾的斜杠（如果有）
        base = base.replace(/\/$/, '');
        // 移除 path 开头的斜杠（如果有）
        path = path.replace(/^\//, '');
        return `${base}/${path}`;
    }

    // 根据文件名获取STRM文件路径
    getStrmPath(task) {
        if (!this.enable){
            // 如果cloudStrmPrefix存在 且不是url地址
            if (task.account.cloudStrmPrefix && !task.account.cloudStrmPrefix.startsWith('http')) {
                return path.join(task.account.cloudStrmPrefix, this.getTaskRelativePath(task));
            }
        }else{
            return this.getTaskStrmDir(task);
        }
        return '';
    }
}

module.exports = { StrmService };
