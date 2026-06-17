const { LessThan, In, IsNull } = require('typeorm');
const CloudUtils = require('../utils/CloudUtils');
const { MessageUtil } = require('./message');
const { logTaskEvent } = require('../utils/logUtils');
const ConfigService = require('./ConfigService');
const { CreateTaskDto } = require('../dto/TaskDto');
const { BatchTaskDto } = require('../dto/BatchTaskDto');
const { TaskCompleteEventDto } = require('../dto/TaskCompleteEventDto');
const { SchedulerService } = require('./scheduler');

const path = require('path');
const { StrmService } = require('./strm');
const { EventService } = require('./eventService');
const { TaskEventHandler } = require('./taskEventHandler');
const AIService = require('./ai');
const harmonizedFilter = require('../utils/BloomFilter');
const alistService = require('./alistService');

class TaskService {
    constructor(taskRepo, accountRepo) {
        this.taskRepo = taskRepo;
        this.accountRepo = accountRepo;
        this.messageUtil = new MessageUtil();
        this.eventService = EventService.getInstance();
        // 如果还没有taskComplete事件的监听器，则添加
        if (!this.eventService.hasListeners('taskComplete')) {
            const taskEventHandler = new TaskEventHandler(this.messageUtil);
            this.eventService.on('taskComplete', async (eventDto) => {
                eventDto.taskService = this;
                eventDto.taskRepo = this.taskRepo;
                taskEventHandler.handle(eventDto);
            });
        }
    }

    // 解析分享链接
    async getShareInfo(cloud189, shareCode, accessCode = '') {
         const shareInfo = await cloud189.getShareInfo(shareCode, accessCode);
         if (!shareInfo) throw new Error('获取分享信息失败');
         if(shareInfo.res_code == "ShareAuditWaiting") {
            throw new Error('分享链接审核中, 请稍后再试');
         }
         return shareInfo;
    }

    // 创建任务的基础配置
    _createTaskConfig(taskDto, shareInfo, realFolder, resourceName, currentEpisodes = 0, shareFolderId = null, shareFolderName = "") {
        return {
            accountId: taskDto.accountId,
            shareLink: taskDto.shareLink,
            targetFolderId: taskDto.targetFolderId,
            realFolderId:realFolder.id,
            realFolderName:realFolder.name,
            status: 'pending',
            totalEpisodes: taskDto.totalEpisodes,
            resourceName,
            currentEpisodes,
            shareFileId: shareInfo.fileId,
            shareFolderId: shareFolderId || shareInfo.fileId,
            shareFolderName,
            shareId: shareInfo.shareId,
            shareMode: shareInfo.shareMode,
            accessCode: taskDto.accessCode,
            matchPattern: taskDto.matchPattern,
            matchOperator: taskDto.matchOperator,
            matchValue: taskDto.matchValue,
            remark: taskDto.remark,
            realRootFolderId: taskDto.realRootFolderId,
            enableCron: taskDto.enableCron,
            cronExpression: taskDto.cronExpression,
            sourceRegex: taskDto.sourceRegex,
            targetRegex: taskDto.targetRegex,
            enableTaskScraper: taskDto.enableTaskScraper,
            isFolder: taskDto.isFolder
        };
    }

     // 验证用户选择的保存目录
     async _validateAndCreateTargetFolder(cloud189, taskDto) {
        const folderInfo = await cloud189.listFiles(taskDto.targetFolderId);
        if (!folderInfo || folderInfo.res_code === "FileNotFound") {
            throw new Error('保存目录不存在');
        }
        return {id: taskDto.targetFolderId, name: taskDto.targetFolder || ''};
    }

    _getShareFolderId(folder = {}) {
        return folder.id || folder.fileId || folder.fid || '';
    }

    _getShareFolderName(folder = {}) {
        return folder.name || folder.fileName || folder.file_name || '';
    }

    async listShareFolders(cloud189, shareInfo, folderId, accessCode = '', parentPath = '') {
        const result = await cloud189.listShareDir(shareInfo.shareId, folderId, shareInfo.shareMode, accessCode);
        if (!result?.fileListAO) {
            return [];
        }

        const folders = [];
        const subFolders = result.fileListAO.folderList || [];
        for (const folder of subFolders) {
            const id = this._getShareFolderId(folder);
            const folderName = this._getShareFolderName(folder);
            if (!id || !folderName) continue;

            const displayPath = this._joinRelativePath(parentPath, folderName);
            const normalizedFolder = {
                ...folder,
                id,
                name: displayPath,
                folderName,
                path: displayPath,
                isParent: true,
                pId: folderId
            };
            folders.push(normalizedFolder);
            folders.push(...await this.listShareFolders(cloud189, shareInfo, id, accessCode, displayPath));
        }
        return folders;
    }

    async _getSelectedShareFolder(cloud189, taskDto, shareInfo) {
        const selectedFolders = Array.isArray(taskDto.selectedFolders)
            ? taskDto.selectedFolders.filter(Boolean)
            : [];

        if (!taskDto.tgbot && selectedFolders.length > 1) {
            throw new Error('只能选择一个分享目录');
        }

        const selectedFolderId = selectedFolders[0] || '-1';
        if (String(selectedFolderId) === '-1' || String(selectedFolderId) === String(shareInfo.fileId)) {
            return { id: shareInfo.fileId, name: '' };
        }

        const subFolders = await this.listShareFolders(cloud189, shareInfo, shareInfo.fileId, taskDto.accessCode);
        const selectedFolder = subFolders.find(folder => String(folder.id) === String(selectedFolderId));
        if (!selectedFolder) {
            throw new Error('选择的分享目录不存在');
        }
        return { id: selectedFolder.id, name: selectedFolder.name };
    }

    // 处理文件夹分享
    async _handleFolderShare(cloud189, shareInfo, taskDto, targetFolder, tasks) {
        const result = await cloud189.listShareDir(shareInfo.shareId, shareInfo.fileId, shareInfo.shareMode, taskDto.accessCode);
        if (!result?.fileListAO) throw new Error('获取分享目录失败');

        const selectedFolder = await this._getSelectedShareFolder(cloud189, taskDto, shareInfo);
        taskDto.realRootFolderId = targetFolder.id;
        const task = this.taskRepo.create(
            this._createTaskConfig(
                taskDto,
                shareInfo,
                targetFolder,
                shareInfo.fileName,
                0,
                selectedFolder.id,
                selectedFolder.name
            )
        );
        tasks.push(await this.taskRepo.save(task));
    }

    // 处理单文件分享
    async _handleSingleShare(cloud189, shareInfo, taskDto, targetFolder, tasks) {
        const shareFiles = await cloud189.getShareFiles(shareInfo.shareId, shareInfo.fileId, shareInfo.shareMode, taskDto.accessCode, false);
        if (!shareFiles?.length) throw new Error('获取文件列表失败');
        taskDto.realRootFolderId = targetFolder.id;
        const task = this.taskRepo.create(
            this._createTaskConfig(
                taskDto,
                shareInfo, targetFolder, shareInfo.fileName, 0
            )
        );
        tasks.push(await this.taskRepo.save(task));
    }

    async _analyzeResourceInfo(resourcePath, files, type = 'folder') {
        try {
            if (type == 'folder') {
                const result = await AIService.folderAnalysis(resourcePath, files);
                if (!result.success) {
                    throw new Error('AI 分析失败:'+ result.error);
                }
                return result.data;
            }
            const result = await AIService.simpleChatCompletion(resourcePath, files);
            if (!result.success) {
                throw new Error('AI 分析失败: ' + result.error);
            }
            return result.data;
        } catch (error) {
            throw new Error('AI 分析失败: ' + error.message);
        }
    }

    // 创建新任务
    async createTask(params) {
        const taskDto = new CreateTaskDto(params);
        taskDto.validate();
        // 获取分享信息
        const account = await this.accountRepo.findOneBy({ id: taskDto.accountId });
        if (!account) throw new Error('账号不存在');
        
        // 解析url
        const {url: parseShareLink, accessCode} = CloudUtils.parseCloudShare(taskDto.shareLink)
        if (accessCode) {
            taskDto.accessCode = accessCode;
        }
        taskDto.shareLink = parseShareLink;
        this._validateAccountMatchesShareLink(account, taskDto.shareLink);
        const cloud189 = CloudUtils.getService(account);
        const shareCode = CloudUtils.parseShareCode(taskDto.shareLink, account);
        const shareInfo = await this.getShareInfo(cloud189, shareCode, taskDto.accessCode);
        // 如果分享链接是加密链接, 且没有提供访问码, 则抛出错误
        if (shareInfo.shareMode == 1 ) {
            if (!taskDto.accessCode) {
                throw new Error('分享链接为加密链接, 请提供访问码');
            }
            // 校验访问码是否有效
            const accessCodeResponse = await cloud189.checkAccessCode(shareCode, taskDto.accessCode);
            if (!accessCodeResponse) {
                throw new Error('校验访问码失败');
            }
            if (!accessCodeResponse.shareId) {
                throw new Error('访问码无效');
            }
            shareInfo.shareId = accessCodeResponse.shareId;
        }
        if (!shareInfo.shareId) {
            throw new Error('获取分享信息失败');
        }
        // 如果启用了 AI 分析 如果任务名和分享名相同, 则使用AI分析结果更新任务名称
        if (AIService.isEnabled() && taskDto.taskName == shareInfo.fileName) {
            try {
                const resourceInfo = await this._analyzeResourceInfo(shareInfo.fileName, [], 'folder');
                // 使用 AI 分析结果更新任务名称
                shareInfo.fileName = resourceInfo.year?`${resourceInfo.name} (${resourceInfo.year})`:resourceInfo.name;
                taskDto.taskName = shareInfo.fileName;
            } catch (error) {
                logTaskEvent('AI 分析失败，使用原始文件名: ' + error.message);
            }
        }
        // 如果任务名称存在 且和shareInfo的name不一致
        if (taskDto.taskName && taskDto.taskName != shareInfo.fileName) {
            shareInfo.fileName = taskDto.taskName;
        }
        taskDto.isFolder = true
        await this.increaseShareFileAccessCount(cloud189, shareInfo.shareId)
        // 检查用户选择的保存目录
        const targetFolder = await this._validateAndCreateTargetFolder(cloud189, taskDto, shareInfo);
        const tasks = [];
        if (shareInfo.isFolder) {
            await this._handleFolderShare(cloud189, shareInfo, taskDto, targetFolder, tasks);
        }

         // 处理单文件
         if (!shareInfo.isFolder) {
            taskDto.isFolder = false
            await this._handleSingleShare(cloud189, shareInfo, taskDto, targetFolder, tasks);
        }
        if (taskDto.enableCron) {
            for(const task of tasks) {
                SchedulerService.saveTaskJob(task, this)   
            }
        }
        return tasks;
    }
    async increaseShareFileAccessCount(cloud189, shareId ) {
        await cloud189.increaseShareFileAccessCount(shareId)
    }
    // 删除任务
    async deleteTask(taskId, deleteCloud) {
        const task = await this.getTaskById(taskId);
        if (!task) throw new Error('任务不存在');
        const strmService = new StrmService();
        const strmPath = strmService.getTaskLocalRelativePath(task);
        if (!task.enableSystemProxy && deleteCloud) {
            const account = await this.accountRepo.findOneBy({ id: task.accountId });
            if (!account) throw new Error('账号不存在');
            const cloud189 = CloudUtils.getService(account);
            await this.deleteCloudFile(cloud189, await this.getRootFolder(task), 1);
            // 删除strm
            strmService.deleteDir(strmPath)
            // 刷新OpenList/Alist缓存
            await this.refreshAlistCache(task, true)
        }
        if (task.enableSystemProxy) {
            // 删除strm
            strmService.deleteDir(strmPath)
        }
        // 删除定时任务
        if (task.enableCron) {
            SchedulerService.removeTaskJob(task.id)
        }
        await this.taskRepo.remove(task);
    }

    // 批量删除
    async deleteTasks(taskIds, deleteCloud) {
        for(const taskId of taskIds) {
            try{
                await this.deleteTask(taskId, deleteCloud)
            }catch (error){

            }
        }
    }

    _normalizeRelativePath(value = '') {
        return String(value || '')
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\/+|\/+$/g, '');
    }

    _joinRelativePath(...parts) {
        return this._normalizeRelativePath(parts.filter(Boolean).join('/'));
    }

    _withFolderRelativePath(file, relativeDir = '') {
        const normalizedRelativeDir = this._normalizeRelativePath(relativeDir);
        const fileName = file.name || file.fileName || '';
        const relativePath = this._joinRelativePath(normalizedRelativeDir, fileName);
        return {
            ...file,
            name: fileName,
            fileName: file.fileName || fileName,
            relativeDir: normalizedRelativeDir,
            relativePath,
            displayName: relativePath || fileName
        };
    }

    async _collectFolderFiles(cloud189, folderId, relativeDir = '', folderInfo = null, includeFolders = false) {
        const currentFolderInfo = folderInfo || await cloud189.listFiles(folderId);
        if (!currentFolderInfo || currentFolderInfo.res_code === "FileNotFound" || !currentFolderInfo.fileListAO) {
            return [];
        }

        const files = (currentFolderInfo.fileListAO.fileList || [])
            .map(file => this._withFolderRelativePath(file, relativeDir));

        const folders = currentFolderInfo.fileListAO.folderList || [];
        for (const folder of folders) {
            const folderId = folder.id || folder.fileId;
            const folderName = folder.name || folder.fileName;
            if (!folderId || !folderName) continue;
            const childRelativeDir = this._joinRelativePath(relativeDir, folderName);
            if (includeFolders) {
                files.push(this._withFolderRelativePath(folder, relativeDir));
            }
            const childFiles = await this._collectFolderFiles(cloud189, folderId, childRelativeDir, null, includeFolders);
            files.push(...childFiles);
        }

        return files;
    }

    // 获取文件夹下的所有文件
    async getAllFolderFiles(cloud189, task, includeFolders = false) {
        if (task.enableSystemProxy) {
            throw new Error('系统代理模式已移除');
        }
        const folderId = task.realFolderId
        const folderInfo = await cloud189.listFiles(folderId);
        // 如果folderInfo.res_code == FileNotFound 需要重新创建目录
        if (folderInfo?.res_code == "FileNotFound") {
            logTaskEvent('文件夹不存在!')
            if (!task) {
                throw new Error('文件夹不存在!');
            }
            logTaskEvent('正在重新创建目录');
            const enableAutoCreateFolder = ConfigService.getConfigValue('task.enableAutoCreateFolder');
            if (enableAutoCreateFolder) {
                await this._autoCreateFolder(cloud189, task);
                return await this.getAllFolderFiles(cloud189, task, includeFolders);
            }
        }
        if (!folderInfo || !folderInfo.fileListAO) {
            return [];
        }

        return await this._collectFolderFiles(cloud189, folderId, '', folderInfo, includeFolders);
    }

    _evaluateTransferCandidate(task, file, options) {
        const {
            existingFiles,
            existingFileNames,
            existingFolderNames,
            enableOnlySaveMedia,
            mediaSuffixs,
            aiFiltered,
            isQuarkTask
        } = options;
        const existsByMd5 = !file.isFolder && file.md5 ? existingFiles.has(file.md5) : false;
        // 子目录文件用完整相对路径去重（避免不同子目录同名文件被误拦），根目录文件仍用裸文件名
        const fileRelativePath = file._relativeDir ? `${file._relativeDir}/${file.name}` : file.name;
        const existsByFileName = !file.isFolder && (existingFileNames.has(file.name) || existingFileNames.has(fileRelativePath));
        const existsByFolderName = file.isFolder && existingFolderNames.has(file.name);
        const suffixPassed = file.isFolder || this._checkFileSuffix(file, enableOnlySaveMedia, mediaSuffixs);
        const matchPassed = aiFiltered || this._handleMatchMode(task, file);
        const harmonized = this.isHarmonized(file);
        const folderAllowed = !file.isFolder || isQuarkTask;
        const duplicatePassed = file.isFolder
            ? folderAllowed && !existsByFolderName
            : !existsByMd5 && !existsByFileName && suffixPassed;
        const blockedBy = [];

        if (file.isFolder) {
            if (!folderAllowed) blockedBy.push('非夸克目录');
            if (existsByFolderName) blockedBy.push('同名目录已存在');
        } else {
            if (existsByMd5) blockedBy.push('md5重复');
            if (existsByFileName) blockedBy.push('同名文件已存在');
            if (!suffixPassed) blockedBy.push('后缀不匹配');
        }
        if (!matchPassed) blockedBy.push('匹配规则不通过');
        if (harmonized) blockedBy.push('和谐记录');

        return {
            transferable: duplicatePassed && matchPassed && !harmonized,
            blockedBy,
            existsByMd5,
            existsByFileName,
            existsByFolderName,
            suffixPassed,
            matchPassed,
            harmonized
        };
    }

    _logTransferFilterDiagnostics(task, filterResults, context) {
        const counts = {
            md5: 0,
            fileName: 0,
            folderName: 0,
            suffix: 0,
            match: 0,
            harmonized: 0,
            nonQuarkFolder: 0
        };

        for (const { status } of filterResults) {
            if (status.blockedBy.includes('md5重复')) counts.md5++;
            if (status.blockedBy.includes('同名文件已存在')) counts.fileName++;
            if (status.blockedBy.includes('同名目录已存在')) counts.folderName++;
            if (status.blockedBy.includes('后缀不匹配')) counts.suffix++;
            if (status.blockedBy.includes('匹配规则不通过')) counts.match++;
            if (status.blockedBy.includes('和谐记录')) counts.harmonized++;
            if (status.blockedBy.includes('非夸克目录')) counts.nonQuarkFolder++;
        }

        const samples = filterResults.slice(0, 10).map(({ file, status }) => {
            const type = file.isFolder ? '目录' : '文件';
            const md5 = file.md5 ? `md5=${String(file.md5).slice(0, 12)}` : 'md5=空';
            const reasons = status.blockedBy.length > 0 ? status.blockedBy.join('/') : '通过';
            return `${type}:${file.name}(${md5})=>${reasons}`;
        });

        logTaskEvent(`${task.resourceName} 过滤详情: 目标文件${context.existingFileNames.size}个, 目标md5${context.existingFiles.size}个, 目标目录${context.existingFolderNames.size}个, 拦截统计: md5重复${counts.md5}, 同名文件${counts.fileName}, 同名目录${counts.folderName}, 后缀${counts.suffix}, 匹配规则${counts.match}, 和谐${counts.harmonized}, 非夸克目录${counts.nonQuarkFolder}`);
        if (samples.length > 0) {
            logTaskEvent(`${task.resourceName} 过滤样例: ${samples.join('；')}`);
        }
    }

    // 自动创建目录
    async _autoCreateFolder(cloud189, task) {
         // 检查 targetFolderId 是否存在
         const targetFolderInfo = await cloud189.listFiles(task.targetFolderId);
         if (targetFolderInfo.res_code === "FileNotFound") {
             throw new Error('保存目录不存在，无法自动创建目录');
         }

        // 如果 realRootFolderId 存在，先检查是否可用
        if (task.realRootFolderId) {
            const rootFolderInfo = await cloud189.listFiles(task.realRootFolderId);
            if (rootFolderInfo.res_code === "FileNotFound") {
                // realRootFolderId 不存在或不可用，需要创建
                const rootFolderName = task.resourceName.replace('(根)', '').trim();
                logTaskEvent(`正在创建根目录: ${rootFolderName}`);
                const rootFolder = await cloud189.createFolder(rootFolderName, task.targetFolderId);
                if (!rootFolder?.id) throw new Error('创建根目录失败');
                task.realRootFolderId = rootFolder.id;
                logTaskEvent(`根目录创建成功: ${rootFolderName}`);
            }
        }

        // 如果是子文件夹任务，在 realRootFolderId 下创建子文件夹
        if (task.realRootFolderId !== task.realFolderId) {
            logTaskEvent(`正在创建子目录: ${task.shareFolderName}`);
            const subFolder = await cloud189.createFolder(task.shareFolderName, task.realRootFolderId);
            if (!subFolder?.id) throw new Error('创建子目录失败');
            task.realFolderId = subFolder.id;
            logTaskEvent(`子目录创建成功: ${task.shareFolderName}`);
        } else {
            // 如果是根目录任务，则 realFolderId 等于 realRootFolderId
            task.realFolderId = task.realRootFolderId;
        }

        await this.taskRepo.save(task);
        logTaskEvent('目录创建完成');
    }

    _isQuarkStokenExpired(responseOrError) {
        const code = responseOrError?.code || responseOrError?.res_code || responseOrError?.status;
        const message = responseOrError?.res_msg || responseOrError?.message || '';
        return code == 41016 || message.includes('stoken过期') || message.includes('stoken已过期');
    }

    async _refreshQuarkShareToken(cloud189, task) {
        if (!CloudUtils.isQuarkAccount(task.account)) return false;

        logTaskEvent(`任务 ${task.id}: 夸克分享stoken已过期，正在重新获取`);
        const shareId = task.shareId || CloudUtils.parseShareCode(task.shareLink, task.account);
        const shareInfo = await this.getShareInfo(cloud189, shareId, task.accessCode);
        const stoken = shareInfo?.stoken || shareInfo?.shareMode;
        if (shareInfo?.res_code != 0 || !stoken) {
            throw new Error(shareInfo?.res_msg || '刷新夸克分享stoken失败');
        }

        task.shareId = shareInfo.shareId || shareId;
        task.shareMode = stoken;
        await this.taskRepo.save(task);
        logTaskEvent(`任务 ${task.id}: 夸克分享stoken刷新成功`);
        return true;
    }

    // 获取或创建本地子目录（在指定父目录下查找同名目录，不存在则新建）
    async _getOrCreateLocalFolder(cloud189, parentFolderId, folderName) {
        const folderInfo = await cloud189.listFiles(parentFolderId);
        if (folderInfo?.fileListAO?.folderList) {
            const existing = folderInfo.fileListAO.folderList.find(
                f => (f.name || f.fileName) === folderName
            );
            if (existing) {
                return existing.id || existing.fileId;
            }
        }
        const newFolder = await cloud189.createFolder(folderName, parentFolderId);
        if (!newFolder?.id) throw new Error(`创建子目录 ${folderName} 失败`);
        logTaskEvent(`已创建子目录: ${folderName}`);
        return newFolder.id;
    }

    // 递归收集分享目录下的所有文件（扁平化，含子目录），每个文件附带来源目录ID和相对路径
    async _collectShareFilesRecursive(cloud189, task, shareFolderId, relativeDir = '') {
        let dir;
        try {
            dir = await cloud189.listShareDir(task.shareId, shareFolderId, task.shareMode, task.accessCode, true);
        } catch (e) {
            logTaskEvent(`获取分享子目录文件列表失败(${relativeDir || '根目录'}): ${e.message}`);
            return [];
        }
        if (this._isQuarkStokenExpired(dir)) {
            await this._refreshQuarkShareToken(cloud189, task);
            dir = await cloud189.listShareDir(task.shareId, shareFolderId, task.shareMode, task.accessCode, true);
        }
        if (!dir?.fileListAO) return [];

        // 当前层级的文件，附加来源目录信息
        const files = (dir.fileListAO.fileList || []).map(file => ({
            ...file,
            _shareFolderId: shareFolderId,
            _relativeDir: relativeDir
        }));

        // 递归处理子目录
        for (const folder of dir.fileListAO.folderList || []) {
            const folderId = this._getShareFolderId(folder);
            const folderName = this._getShareFolderName(folder);
            if (!folderId || !folderName) continue;
            const childRelativeDir = this._joinRelativePath(relativeDir, folderName);
            const childFiles = await this._collectShareFilesRecursive(cloud189, task, folderId, childRelativeDir);
            files.push(...childFiles);
        }
        return files;
    }

    // 处理新文件（支持子目录：按来源分享目录分组，分别找到/创建目标子目录后执行转存）
    async _handleNewFiles(task, newFiles, cloud189, mediaSuffixs) {
        const fileNameList = [];
        let fileCount = 0;

        if (task.enableSystemProxy) {
            throw new Error('系统代理模式已移除');
        }

        // 按来源分享目录分组，同一来源目录的文件一起转存到对应的目标子目录
        const groupMap = new Map(); // key: `${shareFolderId}::${relativeDir}`
        for (const file of newFiles) {
            const shareFolderId = file._shareFolderId || task.shareFolderId;
            const relativeDir = file._relativeDir || '';
            const groupKey = `${shareFolderId}::${relativeDir}`;
            if (!groupMap.has(groupKey)) {
                groupMap.set(groupKey, { files: [], shareFolderId, relativeDir });
            }
            groupMap.get(groupKey).files.push(file);
            const displayName = relativeDir ? `${relativeDir}/${file.name}` : file.name;
            fileNameList.push(`├─ ${displayName}`);
            if (this._checkFileSuffix(file, true, mediaSuffixs)) fileCount++;
        }

        // 如果有多个文件，最后一个文件使用└─
        if (fileNameList.length > 0) {
            const lastItem = fileNameList.pop();
            fileNameList.push(lastItem.replace('├─', '└─'));
        }

        // 对每个分组执行转存任务
        for (const { files, shareFolderId, relativeDir } of groupMap.values()) {
            // 根据相对路径逐级找到或创建目标子目录
            let targetFolderId = task.realFolderId;
            if (relativeDir) {
                const parts = relativeDir.split('/');
                let parentId = task.realFolderId;
                for (const part of parts) {
                    parentId = await this._getOrCreateLocalFolder(cloud189, parentId, part);
                }
                targetFolderId = parentId;
            }

            const taskInfoList = files.map(file => ({
                fileId: file.id,
                fileName: file.name,
                isFolder: file.isFolder ? 1 : 0,
                md5: file.md5,
                shareFidToken: file.shareFidToken,
                fidToken: file.fidToken,
            }));

            const batchTaskDto = new BatchTaskDto({
                taskInfos: JSON.stringify(taskInfoList),
                type: 'SHARE_SAVE',
                targetFolderId,
                shareId: task.shareId,
                shareMode: task.shareMode,
                shareFolderId
            });
            try {
                await this.createBatchTask(cloud189, batchTaskDto);
            } catch (error) {
                if (!this._isQuarkStokenExpired(error)) throw error;
                await this._refreshQuarkShareToken(cloud189, task);
                batchTaskDto.shareMode = task.shareMode;
                await this.createBatchTask(cloud189, batchTaskDto);
            }
        }

        // 修改省略号的显示格式
        if (fileNameList.length > 20) {
            fileNameList.splice(5, fileNameList.length - 10, '├─ ...');
        }

        return { fileNameList, fileCount };
    }

    // 使用 AI 过滤文件列表
    async _filterFilesWithAI(task, fileList) {
        logTaskEvent(`任务 ${task.id}: 尝试使用 AI 进行文件过滤...`);

        // 1. 构建中文过滤描述
        let filterDescription = '';
        const pattern = task.matchPattern; // 例如: "剧集", "文件名"
        const operator = task.matchOperator; // 例如: "lt", "gt", "eq", "contains", "not contains"
        const value = task.matchValue; // 例如: "8", "特效", "1080p"

        if (!pattern || !operator || !value) {
            logTaskEvent(`任务 ${task.id}: AI 过滤条件不完整，跳过 AI 过滤。`);
            return null; // 条件不完整，无法生成描述
        }

        let operatorText = '';
        switch (operator) {
            case 'gt': operatorText = '大于'; break;
            case 'lt': operatorText = '小于'; break;
            case 'eq': operatorText = '等于'; break;
            case 'contains': operatorText = '包含'; break;
            case 'not contains': operatorText = '不包含'; break;
            default:
                logTaskEvent(`任务 ${task.id}: 未知的过滤操作符 "${operator}"，跳过 AI 过滤。`);
                return null;
        }

        // 根据 pattern 生成更自然的描述
        filterDescription = `筛选出 ${pattern} ${operatorText} "${value}" 的文件。请根据文件名判断。`;
        logTaskEvent(`任务 ${task.id}: 生成 AI 过滤描述: "${filterDescription}"`);


        // 2. 准备给 AI 的文件列表 (仅含 id 和 name)
        const filesForAI = fileList.map(f => ({ id: f.id, name: f.name }));

        // 3. 调用 AI 服务
        try {
            const aiResponse = await AIService.filterMediaFiles(task.resourceName, filesForAI, filterDescription);

            if (aiResponse.success && Array.isArray(aiResponse.data)) {
                logTaskEvent(`任务 ${task.id}: AI 文件过滤成功，保留 ${aiResponse.data.length} 个文件。`);
                // 使用 AI 返回的 id 列表来过滤原始的完整文件列表
                const keptFileIds = new Set(aiResponse.data);
                // 先应用后缀过滤，再应用AI过滤结果
                const filteredList = fileList.filter(file => keptFileIds.has(file.id));
                return filteredList; 
            } else {
                logTaskEvent(`任务 ${task.id}: AI 文件过滤失败: ${aiResponse.error || '未知错误'}。`);
                return null;
            }
        } catch (error) {
            logTaskEvent(`任务 ${task.id}: 调用 AI 文件过滤时发生错误: ${error.message}`);
            console.error(`AI filter error for task ${task.id}:`, error);
            return null; 
        }
    }

    // 执行任务
    async processTask(task) {
        let saveResults = [];
        try {
            const account = await this.accountRepo.findOneBy({ id: task.accountId });
            if (!account) {
                logTaskEvent(`账号不存在，accountId: ${task.accountId}`);
                throw new Error('账号不存在');
            }
            task.account = account;
            const cloud189 = CloudUtils.getService(account);
            const isQuarkTask = CloudUtils.isQuarkAccount(account);
             // 获取分享文件列表并进行增量转存
             let shareDir = await cloud189.listShareDir(task.shareId, task.shareFolderId, task.shareMode,task.accessCode, task.isFolder);
             if (this._isQuarkStokenExpired(shareDir)) {
                await this._refreshQuarkShareToken(cloud189, task);
                shareDir = await cloud189.listShareDir(task.shareId, task.shareFolderId, task.shareMode,task.accessCode, task.isFolder);
             }
             if(shareDir.res_code == "ShareAuditWaiting") {
                logTaskEvent("分享链接审核中, 等待下次执行")
                return ''
             }
             if (!shareDir?.fileListAO?.fileList) {
                logTaskEvent("获取文件列表失败: " + JSON.stringify(shareDir));
                throw new Error('获取文件列表失败');
            }
            // 递归收集所有子目录中的文件（天翼/夸克统一处理，解决子目录媒体文件无法转存的问题）
            const rootFiles = (shareDir.fileListAO.fileList || []).map(f => ({
                ...f, _shareFolderId: task.shareFolderId, _relativeDir: ''
            }));
            const subDirFiles = [];
            for (const folder of shareDir.fileListAO.folderList || []) {
                const subFolderId = this._getShareFolderId(folder);
                const subFolderName = this._getShareFolderName(folder);
                if (!subFolderId || !subFolderName) continue;
                const childFiles = await this._collectShareFilesRecursive(
                    cloud189, task, subFolderId, subFolderName
                );
                subDirFiles.push(...childFiles);
            }
            let shareFiles = [...rootFiles, ...subDirFiles];
            const sourceFileCount = shareDir.fileListAO.fileList?.length || 0;
            const sourceFolderCount = shareDir.fileListAO.folderList?.length || 0;
            const folderFiles = await this.getAllFolderFiles(cloud189, task, isQuarkTask);
            const enableOnlySaveMedia = ConfigService.getConfigValue('task.enableOnlySaveMedia');
            // mediaSuffixs转为小写
            const mediaSuffixs = ConfigService.getConfigValue('task.mediaSuffix').split(';').map(suffix => suffix.toLowerCase())
            const { existingFiles, existingFileNames, existingFolderNames, existingMediaCount } = folderFiles.reduce((acc, file) => {
                if (file.isFolder) {
                    acc.existingFolderNames.add(file.name);
                    if (file.relativePath) acc.existingFolderNames.add(file.relativePath);
                    return acc;
                }
                if (!file.isFolder) {
                    if (file.md5) {
                        acc.existingFiles.add(file.md5);
                    }
                    acc.existingFileNames.add(file.name);
                    // 同时记录带路径的完整名称，用于子目录文件去重
                    if (file.relativePath) acc.existingFileNames.add(file.relativePath);
                    if ((task.totalEpisodes == null || task.totalEpisodes <= 0) || this._checkFileSuffix(file, true, mediaSuffixs)) {
                        acc.existingMediaCount++;
                    }
                }
                return acc;
            }, { 
                existingFiles: new Set(), 
                existingFileNames: new Set(), 
                existingFolderNames: new Set(),
                existingMediaCount: 0 
            });
            let aiFiltered = false;
            if (AIService.isEnabled() && task.matchPattern && task.matchOperator && task.matchValue) {
                const aiResult = await this._filterFilesWithAI(task, shareFiles)
                if (aiResult != null) {
                    shareFiles = aiResult;
                    aiFiltered = true;
                }
            }
            
            const filterOptions = {
                existingFiles,
                existingFileNames,
                existingFolderNames,
                enableOnlySaveMedia,
                mediaSuffixs,
                aiFiltered,
                isQuarkTask
            };
            const filterResults = shareFiles.map(file => ({
                file,
                status: this._evaluateTransferCandidate(task, file, filterOptions)
            }));
            const newFiles = filterResults
                .filter(({ status }) => status.transferable)
                .map(({ file }) => file);

            // 处理新文件并保存到数据库和云盘
            if (newFiles.length > 0) {
                const { fileNameList, fileCount } = await this._handleNewFiles(task, newFiles, cloud189, mediaSuffixs);
                const resourceName = task.shareFolderName? `${task.resourceName}/${task.shareFolderName}` : task.resourceName;
                saveResults.push(`${resourceName}追更${fileCount}集: \n${fileNameList.join('\n')}`);
                const firstExecution = !task.lastFileUpdateTime;
                task.status = 'processing';
                task.lastFileUpdateTime = new Date();
                task.currentEpisodes = existingMediaCount + fileCount;
                task.retryCount = 0;
                process.nextTick(() => {
                    this.eventService.emit('taskComplete', new TaskCompleteEventDto({
                        task,
                        cloud189,
                        fileList: newFiles,
                        overwriteStrm: false,
                        firstExecution: firstExecution
                    }));
                })
            } else if (task.lastFileUpdateTime) {
                // 检查是否超过3天没有新文件
                const now = new Date();
                const lastUpdate = new Date(task.lastFileUpdateTime);
                const daysDiff = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
                if (daysDiff >= ConfigService.getConfigValue('task.taskExpireDays')) {
                    task.status = 'completed';
                }
                task.currentEpisodes = existingMediaCount;
                logTaskEvent(`${task.resourceName} 没有增量剧集`)
            } else {
                logTaskEvent(`${task.resourceName} 未发现可转存文件，源文件${sourceFileCount}个，源目录${sourceFolderCount}个，过滤后0个`)
                this._logTransferFilterDiagnostics(task, filterResults, {
                    existingFiles,
                    existingFileNames,
                    existingFolderNames
                });
            }
            // 检查是否达到总数
            if (task.totalEpisodes && task.currentEpisodes >= task.totalEpisodes) {
                task.status = 'completed';
                logTaskEvent(`${task.resourceName} 已完结`)
            }

            task.lastCheckTime = new Date();
            await this.taskRepo.save(task);
            return saveResults.join('\n');
        } catch (error) {
            return await this._handleTaskFailure(task, error);
        }
    }

    // 获取所有任务
    async getTasks() {
        return await this.taskRepo.find({
            order: {
                id: 'DESC'
            }
        });
    }

    // 获取待处理任务
    async getPendingTasks(ignore = false, taskIds = []) {
        const conditions = [
            {
                status: 'pending',
                nextRetryTime: null,
                enableSystemProxy: IsNull(),
                ...(ignore ? {} : { enableCron: false })
            },
            {
                status: 'processing',
                enableSystemProxy: IsNull(),
                ...(ignore ? {} : { enableCron: false })
            }
        ];
        return await this.taskRepo.find({
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    cloudType: true,
                    localStrmPrefix: true,
                    cloudStrmPrefix: true,
                    embyPathReplace: true
                }
            },
            where: [
                ...(taskIds.length > 0 
                    ? [{ id: In(taskIds) }] 
                    : conditions)
            ]
        });
    }

    // 更新任务
    async updateTask(taskId, updates) {
        const task = await this.taskRepo.findOne({
            where: { id: taskId },
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    cloudType: true,
                    localStrmPrefix: true,
                    cloudStrmPrefix: true,
                    embyPathReplace: true
                }
            }
        });
        if (!task) throw new Error('任务不存在');

        // 如果原realFolderName和现realFolderName不一致 则需要删除原strm
        if (updates.realFolderName && updates.realFolderName !== task.realFolderName && ConfigService.getConfigValue('strm.enable')) {
            // 删除原strm
            const strmService = new StrmService();
            strmService.deleteDir(strmService.getTaskLocalRelativePath(task))
        }
        // 处理分享链接/账号变更(仅当真正发生变化时才重新解析)
        if (updates.shareLink !== undefined) {
            await this._applyShareLinkUpdate(task, updates);
        }
        // 只允许更新特定字段
        const allowedFields = ['resourceName', 'realFolderId', 'currentEpisodes', 'totalEpisodes', 'status','realFolderName', 'shareFolderName', 'shareFolderId', 'matchPattern','matchOperator','matchValue','remark', 'enableCron', 'cronExpression', 'enableTaskScraper'];
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                task[field] = updates[field];
            }
        }
        // 如果currentEpisodes和totalEpisodes为null 则设置为0
        if (task.currentEpisodes === null) {
            task.currentEpisodes = 0;
        }
        if (task.totalEpisodes === null) {
            task.totalEpisodes = 0;
        }
        
        // 验证状态值
        const validStatuses = ['pending', 'processing', 'completed', 'failed'];
        if (!validStatuses.includes(task.status)) {
            throw new Error('无效的状态值');
        }

        // 验证数值字段
        if (task.currentEpisodes !== null && task.currentEpisodes < 0) {
            throw new Error('更新数不能为负数');
        }
        if (task.totalEpisodes !== null && task.totalEpisodes < 0) {
            throw new Error('总数不能为负数');
        }
        if (task.matchPattern && !task.matchValue) {
            throw new Error('匹配模式需要提供匹配值');
        }
        const newTask = await this.taskRepo.save(task)
        SchedulerService.removeTaskJob(task.id)
        if (task.enableCron && task.cronExpression) {
            SchedulerService.saveTaskJob(newTask, this)
        }
        return newTask;
    }

    // 处理更新任务时的分享链接/账号变更: 重新解析分享、校验网盘类型与保存目录
    async _applyShareLinkUpdate(task, updates) {
        // 解析url及内嵌访问码
        const { url: parsedShareLink, accessCode: parsedAccessCode } = CloudUtils.parseCloudShare(updates.shareLink);
        const accessCode = parsedAccessCode || updates.accessCode || '';
        const targetAccountId = updates.accountId !== undefined ? Number(updates.accountId) : task.accountId;

        // 变更判定: 链接/访问码/账号均未变化则无需重新解析
        const linkUnchanged = parsedShareLink === task.shareLink;
        const accessCodeUnchanged = accessCode === (task.accessCode || '');
        const accountUnchanged = targetAccountId === task.accountId;
        if (linkUnchanged && accessCodeUnchanged && accountUnchanged) {
            return;
        }

        const account = await this.accountRepo.findOneBy({ id: targetAccountId });
        if (!account) throw new Error('账号不存在');

        // 校验账号与分享链接网盘类型一致
        this._validateAccountMatchesShareLink(account, parsedShareLink);

        const cloud189 = CloudUtils.getService(account);
        const shareCode = CloudUtils.parseShareCode(parsedShareLink, account);
        const shareInfo = await this.getShareInfo(cloud189, shareCode, accessCode);
        // 如果分享链接是加密链接, 校验访问码
        if (shareInfo.shareMode == 1) {
            if (!accessCode) {
                throw new Error('分享链接为加密链接, 请提供访问码');
            }
            const accessCodeResponse = await cloud189.checkAccessCode(shareCode, accessCode);
            if (!accessCodeResponse) {
                throw new Error('校验访问码失败');
            }
            if (!accessCodeResponse.shareId) {
                throw new Error('访问码无效');
            }
            shareInfo.shareId = accessCodeResponse.shareId;
        }
        if (!shareInfo.shareId) {
            throw new Error('获取分享信息失败');
        }

        // 校验保存目录属于目标账号(账号/网盘变化时旧目录会失效)
        const newRealFolderId = updates.realFolderId !== undefined ? updates.realFolderId : task.realFolderId;
        if (!newRealFolderId) {
            throw new Error('请选择保存目录');
        }
        const folderInfo = await cloud189.listFiles(newRealFolderId);
        if (!folderInfo || folderInfo.res_code === 'FileNotFound') {
            throw new Error('保存目录不存在或不属于该账号, 请重新选择');
        }

        // 应用变更
        task.accountId = account.id;
        task.account = account;
        task.shareLink = parsedShareLink;
        task.accessCode = accessCode;
        task.shareId = shareInfo.shareId;
        task.shareFileId = shareInfo.fileId;
        task.shareMode = shareInfo.shareMode;
        task.targetFolderId = newRealFolderId;
        // 若前端未重选源目录, 默认使用分享根目录
        if (updates.shareFolderId === undefined) {
            task.shareFolderId = shareInfo.fileId;
            task.shareFolderName = '';
        }
    }

    // 自动重命名
    async autoRename(cloud189, task) {
        if ((!task.sourceRegex || !task.targetRegex) && !AIService.isEnabled()) return [];
        let message = []
        let newFiles = [];
        let files = [];

        if (task.enableSystemProxy) {
            throw new Error('系统代理模式已移除');
        } else {
            const folderInfo = await cloud189.listFiles(task.realFolderId);
            if (!folderInfo || !folderInfo.fileListAO) return [];
            files = folderInfo.fileListAO.fileList;
        }
        if (!files || files.length === 0) return [];
        
        // 过滤掉文件夹
        files = files.filter(file => !file.isFolder);

        // 使用 AI 重命名或正则重命名  如果写了正则, 那么优先使用正则
        if (AIService.isEnabled() && (!task.sourceRegex || !task.targetRegex)) {
            logTaskEvent(` ${task.resourceName} 开始使用 AI 重命名`);
            try {
                const resourceInfo = await this._analyzeResourceInfo(
                    task.resourceName,
                    files.map(f => ({ id: f.id, name: f.name })),
                    'file'
                );
                await this._processRename(cloud189, task, files, resourceInfo, message, newFiles);
            } catch (error) {
                logTaskEvent('AI 重命名失败，使用正则表达式重命名: ' + error.message);
                await this._processRegexRename(cloud189, task, files, message, newFiles);
            }
        } else {
            logTaskEvent(` ${task.resourceName} 开始使用正则表达式重命名`);
            await this._processRegexRename(cloud189, task, files, message, newFiles);
        }

        // 处理消息和保存结果
        await this._handleRenameResults(task, message, newFiles);
        return newFiles;
    }


    // 处理重命名结果
    async _handleRenameResults(task, message, newFiles) {
        if (message.length > 0) {
            const lastMessage = message[message.length - 1];
            message[message.length - 1] = lastMessage.replace('├─', '└─');
        }
        if (task.enableSystemProxy && newFiles.length > 0) {
            throw new Error('系统代理模式已移除');
        }
        // 修改省略号的显示格式
        if (message.length > 20) {
            message.splice(5, message.length - 10, '├─ ...');
        }
        message.length > 0 && logTaskEvent(`${task.resourceName}自动重命名完成: \n${message.join('\n')}`)
        message.length > 0 && this.messageUtil.sendMessage(`${task.resourceName}自动重命名: \n${message.join('\n')}`);
    }

    // 根据AI分析结果生成新文件名
    _generateFileName(file, aiFile, resourceInfo, template) {
        if (!aiFile) return file.name;
        
        // 构建文件名替换映射
        const replaceMap = {
            '{name}': aiFile.name || resourceInfo.name,
            '{year}': resourceInfo.year || '',
            '{s}': aiFile.season?.padStart(2, '0') || '01',
            '{e}': aiFile.episode?.padStart(2, '0') || '01',
            '{sn}': parseInt(aiFile.season) || '1',                    // 不补零的季数
            '{en}': parseInt(aiFile.episode) || '1',                   // 不补零的集数
            '{ext}': aiFile.extension || path.extname(file.name),
            '{se}': `S${aiFile.season?.padStart(2, '0') || '01'}E${aiFile.episode?.padStart(2, '0') || '01'}`
        };

        // 替换模板中的占位符
        let newName = template;
        for (const [key, value] of Object.entries(replaceMap)) {
            newName = newName.replace(new RegExp(key, 'g'), value);
        }
        // 清理文件名中的非法字符
        return this._sanitizeFileName(newName);
    }
    // 处理重命名过程
    async _processRename(cloud189, task, files, resourceInfo, message, newFiles) {
        const newNames = resourceInfo.episode;
        // 处理aiFilename, 文件命名通过配置文件的占位符获取
        // 获取用户配置的文件名模板，如果没有配置则使用默认模板
        const template = resourceInfo.type === 'movie' 
        ? ConfigService.getConfigValue('openai.rename.movieTemplate') || '{name} ({year}){ext}'  // 电影模板
        : ConfigService.getConfigValue('openai.rename.template') || '{name} - {se}{ext}';  // 剧集模板
        for (const file of files) {
            try {
                const aiFile = newNames.find(f => f.id === file.id);
                if (!aiFile) {
                    newFiles.push(file);
                    continue;
                }
                const newName = this._generateFileName(file, aiFile, resourceInfo, template);
                // 判断文件名是否已存在
                if (file.name === newName) {
                    newFiles.push(file);
                    continue;   
                }
                await this._renameFile(cloud189, task, file, newName, message, newFiles);
            } catch (error) {
                logTaskEvent(`${file.name}重命名失败: ${error.message}`);
                newFiles.push(file);
            }
        }
    }

    // 清理文件名中的非法字符
    _sanitizeFileName(fileName) {
        // 移除文件名中的非法字符
        return fileName.replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, ' ')  // 合并多个空格
            .trim();
    }
    // 处理正则表达式重命名
    async _processRegexRename(cloud189, task, files, message, newFiles) {
        if (!task.sourceRegex || !task.targetRegex) return [];
        for (const file of files) {
            try {
                const destFileName = file.name.replace(new RegExp(task.sourceRegex), task.targetRegex);
                if (destFileName === file.name) {
                    newFiles.push(file);
                    continue;
                }
                await this._renameFile(cloud189, task, file, destFileName, message, newFiles);
            } catch (error) {
                logTaskEvent(`${file.name}重命名失败: ${error.message}`);
                newFiles.push(file);
            }
        }
    }

    // 执行单个文件重命名
    async _renameFile(cloud189, task, file, newName, message, newFiles) {
        let renameResult;
        if (task.enableSystemProxy) {
            throw new Error('系统代理模式已移除');
        } else {
            renameResult = await cloud189.renameFile(file.id, newName);
        }

        if (!task.enableSystemProxy && (!renameResult || renameResult.res_code != 0)) {
            // message.push(`├─ ${file.name} → ${newName}失败, 原因:${newName}${renameResult?.res_msg}`);
            newFiles.push(file);
        } else {
            message.push(`├─ ${file.name} → ${newName}`);
            newFiles.push({
                ...file,
                name: newName
            });
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 检查任务状态
    async checkTaskStatus(cloud189, taskId, count = 0, batchTaskDto) {
        // 前 10 次快速轮询（200ms），之后耐心等待（2000ms），最多约 52 秒
        if (count > 35) {
            logTaskEvent(`任务编号: ${taskId} 状态轮询超时，任务已提交成功，视为处理中`);
            return true;
        }
        const delay = count < 10 ? 200 : 2000;
        let type = batchTaskDto.type || 'SHARE_SAVE';
        // 轮询任务状态
        const task = await cloud189.checkTaskStatus(taskId, batchTaskDto)
        if (!task) {
            return false;
        }
        const statusDetail = task.rawStatus !== undefined ? `, 原始状态: ${task.rawStatus}` : '';
        const statusMessage = task.res_msg || task.resMsg || task.message || '';
        logTaskEvent(`任务编号: ${task.taskId}, 任务状态: ${task.taskStatus}${statusDetail}${statusMessage ? `, 信息: ${statusMessage}` : ''}`)
        if (task.taskStatus == 3 || task.taskStatus == 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return await this.checkTaskStatus(cloud189, taskId, count + 1, batchTaskDto)
        }
        if (task.taskStatus == 4) {
            // 如果failedCount > 0 说明有失败或者被和谐的文件, 需要查一次文件列表
            if (task.failedCount > 0 && type == 'SHARE_SAVE') {
                const targetFolderId = batchTaskDto.targetFolderId;
                const fileList = await this.getAllFolderFiles(cloud189, {
                    enableSystemProxy: false,
                    realFolderId: targetFolderId
                });
                //  当前转存的文件列表为taskInfos 需反序列化
                const taskInfos = JSON.parse(batchTaskDto.taskInfos);
                // fileList和taskInfos进行对比 拿到不在fileList中的文件
                const conflictFiles = taskInfos.filter(taskInfo => {
                    return !fileList.some(file => file.md5 === taskInfo.md5);
                });
                if (conflictFiles.length > 0) {
                    // 打印日志
                    logTaskEvent(`任务编号: ${task.taskId}, 任务状态: ${task.taskStatus}, 有${conflictFiles.length}个文件冲突, 已忽略: ${conflictFiles.map(file => file.fileName).join(',')}`);
                    // 加入和谐文件中
                    const conflictMd5List = conflictFiles.map(file => file.md5).filter(Boolean);
                    if (conflictMd5List.length > 0) {
                        harmonizedFilter.addHarmonizedList(conflictMd5List)
                    }
                }
            }
            return true;
        }
        // 如果status == 2 说明有冲突
        if (task.taskStatus == 2) {
            const conflictTaskInfo = await cloud189.getConflictTaskInfo(taskId);
            if (!conflictTaskInfo) {
                return false
            }
            // 忽略冲突
            const taskInfos = conflictTaskInfo.taskInfos;
            for (const taskInfo of taskInfos) {
                taskInfo.dealWay = 1;
            }
            await cloud189.manageBatchTask(taskId, conflictTaskInfo.targetFolderId, taskInfos);
            await new Promise(resolve => setTimeout(resolve, 200));
            return await this.checkTaskStatus(cloud189, taskId, count + 1, batchTaskDto)
        }
        if (statusMessage) {
            logTaskEvent(`批量任务失败原因: ${statusMessage}`);
        }
        return false;
    }

    // 执行所有任务
    async processAllTasks(ignore = false, taskIds = []) {
        const tasks = await this.getPendingTasks(ignore, taskIds);
        if (tasks.length === 0) {
            logTaskEvent('没有待处理的任务');
            return;
        }
        let saveResults = []
        logTaskEvent(`================================`);
        for (const task of tasks) {
            const taskName = task.shareFolderName?(task.resourceName + '/' + task.shareFolderName): task.resourceName || '未知'
            logTaskEvent(`任务[${taskName}]开始执行`);
            try {
                const result = await this.processTask(task);
            if (result) {
                saveResults.push(result)
            }
            } catch (error) {
                logTaskEvent(`任务${task.id}执行失败: ${error.message}`);
            }finally {
                logTaskEvent(`任务[${taskName}]执行完成`);
            }
            // 暂停500ms
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (saveResults.length > 0) {
            this.messageUtil.sendMessage(saveResults.join("\n\n"))
        }
        logTaskEvent(`================================`);
        return saveResults
    }
    // 处理匹配模式
    _handleMatchMode(task, file) {
        if (!task.matchPattern || !task.matchValue) {
            return true;
        } 
        const matchPattern = task.matchPattern;
        const matchOperator = task.matchOperator; // lt eq gt
        const matchValue = task.matchValue;
        const regex = new RegExp(matchPattern);
        // 根据正则表达式提取文件名中匹配上的值 然后根据matchOperator判断是否匹配
        const match = file.name.match(regex);
        if (match) {
            const matchResult = match[0];
            const values = this._handleMatchValue(matchOperator, matchResult, matchValue);
            if (matchOperator === 'lt' && values[0] < values[1]) {
                return true;
            }
            if (matchOperator === 'eq' && values[0] === values[1]) {
                return true;
            }
            if (matchOperator === 'gt' && values[0] > values[1]) {
                return true;
            }
            if (matchOperator === 'contains' && matchResult.includes(matchValue)) {
                return true;
            }
            if (matchOperator === 'notContains' && !matchResult.includes(matchValue)) {
                return true;
            }
        }
        return false;
    }

    // 根据matchOperator判断值是否要转换为数字
    _handleMatchValue(matchOperator, matchResult, matchValue) {    
        if (matchOperator === 'lt' || matchOperator === 'gt') {
            return [parseFloat(matchResult), parseFloat(matchValue)];
        }
        return [matchResult, matchValue];
    }

    // 任务失败处理逻辑
    async _handleTaskFailure(task, error) {
        logTaskEvent(error);
        const maxRetries = ConfigService.getConfigValue('task.maxRetries');
        const retryInterval = ConfigService.getConfigValue('task.retryInterval');
        // 初始化重试次数
        if (!task.retryCount) {
            task.retryCount = 0;
        }
        
        if (task.retryCount < maxRetries) {
            task.retryCount++;
            task.status = 'pending';
            task.lastError = `${error.message} (重试 ${task.retryCount}/${maxRetries})`;
            // 设置下次重试时间
            task.nextRetryTime = new Date(Date.now() + retryInterval * 1000);
            logTaskEvent(`任务将在 ${retryInterval} 秒后重试 (${task.retryCount}/${maxRetries})`);
        } else {
            task.status = 'failed';
            task.lastError = `${error.message} (已达到最大重试次数 ${maxRetries})`;
            logTaskEvent(`任务达到最大重试次数 ${maxRetries}，标记为失败`);
        }
        
        await this.taskRepo.save(task);
        return '';
    }

     // 获取需要重试的任务
     async getRetryTasks() {
        const now = new Date();
        return await this.taskRepo.find({
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    cloudType: true,
                    localStrmPrefix: true,
                    cloudStrmPrefix: true,
                    embyPathReplace: true
                }
            },
            where: {
                status: 'pending',
                nextRetryTime: LessThan(now),
                retryCount: LessThan(ConfigService.getConfigValue('task.maxRetries')),
                enableSystemProxy: IsNull()
            }
        });
    }

    // 处理重试任务
    async processRetryTasks() {
        const retryTasks = await this.getRetryTasks();
        if (retryTasks.length === 0) {
            return [];
        }
        let saveResults = [];
        logTaskEvent(`================================`);
        for (const task of retryTasks) {
            const taskName = task.shareFolderName?(task.resourceName + '/' + task.shareFolderName): task.resourceName || '未知'
            logTaskEvent(`任务[${taskName}]开始重试`);
            try {
                const result = await this.processTask(task);
                if (result) {
                    saveResults.push(result);
                }
            } catch (error) {
                console.error(`重试任务${task.name}执行失败:`, error);
            }finally {
                logTaskEvent(`任务[${taskName}]重试完成`);
            }
            // 任务间隔
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        if (saveResults.length > 0) {
            this.messageUtil.sendMessage(saveResults.join("\n\n"));
        }
        logTaskEvent(`================================`);
        return saveResults;
    }
    // 创建批量任务
    async createBatchTask(cloud189, batchTaskDto) {
        const resp = await cloud189.createBatchTask(batchTaskDto);
        if (!resp) {
            throw new Error('批量任务处理失败');
        }
        if (resp.res_code != 0) {
            const error = new Error(resp.res_msg || '批量任务处理失败');
            error.res_code = resp.res_code;
            error.status = resp.status;
            error.code = resp.code;
            throw error;
        }
        logTaskEvent(`批量任务处理中: ${JSON.stringify(resp)}`)
        const success = await this.checkTaskStatus(cloud189, resp.taskId, 0, batchTaskDto);
        if (!success) {
            // 任务状态查询失败（非超时），记录警告但不中断流程，避免因状态接口异常触发不必要的重试
            logTaskEvent(`警告: 批量任务 ${resp.taskId} 状态查询失败，转存请求已提交，请手动确认结果`);
        } else {
            logTaskEvent(`批量任务处理完成`);
        }
    }
    // 定时清空回收站
    async clearRecycleBin(enableAutoClearRecycle, enableAutoClearFamilyRecycle) {
        const accounts = await this.accountRepo.find()
        if (accounts) {
            for (const account of accounts) {
                let username = account.username.replace(/(.{3}).*(.{4})/, '$1****$2');
                try {
                    if (CloudUtils.isQuarkAccount(account)) {
                        logTaskEvent(`跳过[${username}]回收站清理: 夸克网盘暂不支持自动清空回收站`);
                        continue;
                    }
                    const cloud189 = CloudUtils.getService(account); 
                    await this._clearRecycleBin(cloud189, username, enableAutoClearRecycle, enableAutoClearFamilyRecycle)
                } catch (error) {
                    logTaskEvent(`定时[${username}]清空回收站任务执行失败:${error.message}`);
                }
            }
        }
    }

    // 执行清空回收站
    async _clearRecycleBin(cloud189, username, enableAutoClearRecycle, enableAutoClearFamilyRecycle) {
        const params = {
            taskInfos: '[]',
            type: 'EMPTY_RECYCLE',
        }   
        const batchTaskDto = new BatchTaskDto(params);
        if (enableAutoClearRecycle) {
            logTaskEvent(`开始清空[${username}]个人回收站`)
            await this.createBatchTask(cloud189, batchTaskDto)
            logTaskEvent(`清空[${username}]个人回收站完成`)
            // 延迟10秒
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
        if (enableAutoClearFamilyRecycle) {
            // 获取家庭id
            const familyInfo = await cloud189.getFamilyInfo()
            if (familyInfo == null) {
                logTaskEvent(`用户${username}没有家庭主账号, 跳过`)
                return
            }
            logTaskEvent(`开始清空[${username}]家庭回收站`)
            batchTaskDto.familyId = familyInfo.familyId
            await this.createBatchTask(cloud189, batchTaskDto)
            logTaskEvent(`清空[${username}]家庭回收站完成`)
        }
    }
    // 校验文件后缀
    _checkFileSuffix(file,enableOnlySaveMedia, mediaSuffixs) {
        // 获取文件后缀
        const fileExt = path.extname(file.name || '').toLowerCase();
        let isMedia = mediaSuffixs.includes(fileExt)
        if (!isMedia && fileExt === '.cas') {
            const sourceExt = path.extname((file.name || '').replace(/\.cas$/i, '')).toLowerCase();
            isMedia = !sourceExt || mediaSuffixs.includes(sourceExt);
        }
        // 如果启用了只保存媒体文件, 则检查文件后缀是否在配置中
        if (enableOnlySaveMedia && !isMedia) {
            return false
        }
        return true
    }
    // 根据realRootFolderId获取根目录
    async getRootFolder(task) {
        if (task.realFolderId === task.targetFolderId && task.realRootFolderId === task.targetFolderId) {
            logTaskEvent(`任务[${task.resourceName}]直接保存到用户选择目录，删除任务时跳过删除保存目录`);
            return null;
        }
        if (task.realRootFolderId) {
            // 判断realRootFolderId下是否还有其他目录, 通过任务查询 查询realRootFolderId是否有多个任务, 如果存在多个 则使用realFolderId
            const tasks = await this.taskRepo.find({
                where: {
                    realRootFolderId: task.realRootFolderId
                }
            })
            if (tasks.length > 1) {
                return {id: task.realFolderId, name: task.realFolderName}    
            }
            return {id: task.realRootFolderId, name: task.shareFolderName}
        }
        logTaskEvent(`任务[${task.resourceName}]为老版本系统创建, 无法删除网盘内容, 跳过`)
        return null
    }
    // 删除网盘文件
    async deleteCloudFile(cloud189, file, isFolder) {
        if (!file) return;
        const taskInfos = []
        // 如果file是数组, 则遍历删除
        if (Array.isArray(file)) {
            for (const f of file) {
                taskInfos.push({
                    fileId: f.id,
                    fileName: f.name,
                    isFolder: isFolder
                })
            }
        }else{
            taskInfos.push({
                fileId: file.id,
                fileName: file.name,
                isFolder: isFolder
            })
        }
        console.log(taskInfos)
        
        const batchTaskDto = new BatchTaskDto({
            taskInfos: JSON.stringify(taskInfos),
            type: 'DELETE',
            targetFolderId: ''
        });
        await this.createBatchTask(cloud189, batchTaskDto)
    }

    // 根据任务创建STRM文件
    async createStrmFileByTask(taskIds, overwrite) {
        const tasks = await this.taskRepo.find({
            where: {
                id: In(taskIds)
            },
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    cloudType: true,
                    localStrmPrefix: true,
                    cloudStrmPrefix: true,
                    embyPathReplace: true
                }
            },
        })
        if (tasks.length == 0) {
            throw new Error('任务不存在')
        }
        for (const task of tasks) {
            try {
                await this._createStrmFileByTask(task, overwrite)   
            }catch (error) {
                logTaskEvent(`任务[${task.resourceName}]生成strm失败: ${error.message}`)
            }
        }
    }
    // 根据任务执行生成strm
    async _createStrmFileByTask(task, overwrite) {
        if (!task) {
            throw new Error('任务不存在')
        }
        let account = await this._getAccountById(task.accountId)
        if (!account) {
            logTaskEvent(`任务[${task.resourceName}]账号不存在, 跳过`)
            return
        }
        const cloud189 = CloudUtils.getService(account);
        // 获取文件列表
        const fileList = await this.getAllFolderFiles(cloud189, task)
        if (fileList.length == 0) {
            throw new Error('文件列表为空')
        }
        const strmService = new StrmService()
        const message = await strmService.generate(task, fileList, overwrite);
        this.messageUtil.sendMessage(message);
    }
    // 根据accountId获取账号
    async _getAccountById(accountId) {
        return await this.accountRepo.findOne({
            where: {
                id: accountId
            }
        })
    }

    _validateAccountMatchesShareLink(account, shareLink) {
        const shareCloudType = CloudUtils.getShareLinkCloudType(shareLink);
        if (!shareCloudType) return;

        const accountCloudType = CloudUtils.isQuarkAccount(account) ? 'quark' : 'cloud189';
        if (shareCloudType !== accountCloudType) {
            throw new Error(`${shareCloudType === 'quark' ? '夸克网盘' : '天翼云盘'}分享链接只能使用${shareCloudType === 'quark' ? '夸克网盘' : '天翼云盘'}账号`);
        }
    }

    // 根据分享链接获取可选择的分享目录
    async parseShareFolderByShareLink(shareLink, accountId, accessCode) {
        const account = await this._getAccountById(accountId)
        if (!account) {
            throw new Error('账号不存在')
        }
        this._validateAccountMatchesShareLink(account, shareLink);
        const cloud189 = CloudUtils.getService(account);
        const shareCode = CloudUtils.parseShareCode(shareLink, account)
        const shareInfo = await this.getShareInfo(cloud189, shareCode, accessCode)
        if (shareInfo.shareMode == 1) {
            if (!accessCode) {
                throw new Error('分享链接为私密链接, 请输入提取码')
            }
            // 校验访问码是否有效
            const accessCodeResponse = await cloud189.checkAccessCode(shareCode, accessCode);
            if (!accessCodeResponse) {
                throw new Error('校验访问码失败');
            }
            if (!accessCodeResponse.shareId) {
                throw new Error('访问码无效');
            }
            shareInfo.shareId = accessCodeResponse.shareId;
        }
        const folders = []
        folders.push({
            id: shareInfo.fileId,
            name: shareInfo.fileName,
            folderName: shareInfo.fileName,
            path: shareInfo.fileName,
            isParent: true
        })
        if (!shareInfo.isFolder) {
            return folders;
        }
        const subFolders = await this.listShareFolders(cloud189, shareInfo, shareInfo.fileId, accessCode, shareInfo.fileName);
        folders.push(...subFolders);
        return folders;
    }

    // 根据id获取任务
    async getTaskById(id) {
        return await this.taskRepo.findOne({
            where: { id: parseInt(id) },
            relations: {
                account: true
            },
            select: {
                account: {
                    username: true,
                    cloudType: true,
                    localStrmPrefix: true,
                    cloudStrmPrefix: true,
                    embyPathReplace: true
                }
            }
        });
    }
    // ai命名处理
    async handleAiRename(files, resourceInfo) {
        const template = resourceInfo.type === 'movie' 
        ? ConfigService.getConfigValue('openai.rename.movieTemplate') || '{name} ({year}){ext}'  // 电影模板
        : ConfigService.getConfigValue('openai.rename.template') || '{name} - {se}{ext}';  // 剧集模板
        const aiNames = resourceInfo.episode
        const newFiles = [];
        for (const file of files) {
            try {
                const aiFile = aiNames.find(f => f.id === file.id);
                if (!aiFile) {
                    continue;
                }
                const newName = this._generateFileName(file, aiFile, resourceInfo, template);
                // 判断文件名是否已存在
                if (file.name === newName) {
                    continue;   
                }
                newFiles.push({
                    ...file,
                    fileId: file.id,
                    oldName: file.name,
                    destFileName: newName
                });
            } catch (error) {
                logTaskEvent(`${file.name}AI重命名处理失败: ${error.message}`);
            }
        }
        return newFiles;
    }
    // 根据布隆过滤器判断是否被和谐
    isHarmonized(file) {
        if (!file.md5) {
            return false;
        }
        // 检查资源是否被和谐
        if (harmonizedFilter.isHarmonized(file.md5)) {
            logTaskEvent(`文件 ${file.name} 被和谐`);
            return true;
        }    
        return false
    }

    // 根据文件id批量删除文件
    async deleteFiles(taskId, files) {
        const task = await this.getTaskById(taskId)
        if (!task) {
            throw new Error('任务不存在')
        }
        const strmService = new StrmService()
        let strmList = []
        strmList = files.map(file => path.join(strmService.getTaskLocalRelativePath(task), file.relativeDir || '', file.name));
        // 判断是否启用了系统代理
        if (task.enableSystemProxy) {
            // 代理文件
        }else{
            // 删除网盘文件
            const cloud189 = CloudUtils.getService(task.account);
            await this.deleteCloudFile(cloud189,files, 0);
            await this.refreshAlistCache(task)
        }
        for (const strm of strmList) {
            // 删除strm文件
            await strmService.delete(strm);
        }
    }

    // 根据任务刷新OpenList/Alist缓存
    async refreshAlistCache(task, firstExecution = false) {
        try{
            if (ConfigService.getConfigValue('alist.enable') && !task.enableSystemProxy && task.account.cloudStrmPrefix) {
                const strmService = new StrmService();
                const taskRelativePath = strmService.getTaskRelativePath(task);
                const resourceName = (task.resourceName || '').replace('(根)', '').trim();
                const relativeParts = taskRelativePath.split('/').filter(Boolean);
                let refreshPath = "";
                // 首次执行任务需要刷新所有目录缓存
                if (firstExecution) {
                    const resourceIndex = relativeParts.indexOf(resourceName);
                    const parentParts = resourceIndex >= 0
                        ? relativeParts.slice(0, resourceIndex)
                        : relativeParts.slice(0, -1);
                    refreshPath = strmService.getAccountAlistPath(task.account, parentParts.join('/'));
                } else {
                    // 非首次只刷新当前目录
                    refreshPath = strmService.getAccountAlistPath(task.account, taskRelativePath);
                }
                logTaskEvent(`刷新OpenList/Alist目录缓存: ${refreshPath}`);
                await alistService.listFiles(refreshPath);
            }
        }catch (error) {
            logTaskEvent(`刷新OpenList/Alist缓存失败: ${error.message}`);
        }
    }

    // 根据task获取文件列表
    async getFilesByTask(task) {
        if (task.enableSystemProxy) {
            throw new Error('系统代理模式已移除');
        }
        const cloud189 = CloudUtils.getService(task.account);
        return await this.getAllFolderFiles(cloud189, task)
    }
}

module.exports = { TaskService };
