
本项目 fork 自 https://github.com/1307super/cloud189-auto-save，新增了 smartstrm 的功能支持。

# 部署与安全提示
- 首次部署后请立即修改默认登录账号密码，默认值仅用于初始化。
- Session 密钥会优先读取 `SESSION_SECRET` 环境变量；未配置时系统会自动生成并写入 `data/config.json`。
- 如需限制跨域访问，可通过 `CORS_ORIGINS` 环境变量配置允许来源，多个来源使用英文逗号分隔。
- 生产环境默认关闭 TypeORM 自动同步；如确需临时同步数据库结构，可设置 `TYPEORM_SYNC=true`。
- 升级镜像或修改配置前，建议备份 `/home/data`，其中包含数据库、配置和登录 token。
- STRM 目录默认权限为目录 `775`、文件 `664`；如 NAS 环境需要特殊权限，可通过 `STRM_DIR_MODE`、`STRM_FILE_MODE` 覆盖。

# SmartStrm 通知配置
- **功能说明**：支持在任务执行完成后自动触发 SmartStrm 的 Webhook
- **配置项**：
  - **Webhook URL**：SmartStrm 提供的 Webhook 接收地址。
  - **任务映射**：支持将本系统的资源名映射为 SmartStrm 中的任务名。
    - 格式：`关键字:映射任务名`
    - 示例：`动漫:tianyi_动漫;电影:tianyi_电影`
    - 逻辑：当转存路径或资源名包含`动漫`时，发送给 SmartStrm 的任务名将自动变为 `tianyi_动漫`。
- **触发时机**：系统会严格在 AI 自动重命名、STRM 生成等所有后置处理完成后再发送通知，确保 SmartStrm 处理的是最终正确的文件。

# 飞牛影视 (FNTV) 入库通知配置
- **功能说明**：支持在任务执行完成后自动通知飞牛影视刷新指定媒体库。配置参数获取方式可参考 [此教程](https://github.com/Cp0204/quark-auto-save/pull/106)。
- **配置位置**：系统设置 → 媒体 → 飞牛影视 (FNTV) 设置
- **配置项**：
  - **服务器地址**：飞牛影视的访问地址，例如 `http://10.0.0.6:5666`
  - **用户名 / 密码**：飞牛影视登录账号
  - **secret_string**：飞牛影视 API 签名密钥字符串
  - **API Key**：飞牛影视 API 密钥
  - **媒体库映射**：根据任务路径动态选择要刷新的媒体库
    - 格式：`路径关键字:媒体库名称`，每行一条，也支持分号分隔
    - 示例：
      ```
      动漫:动漫
      电影:电影
      ```
    - 逻辑：当任务的存储路径或资源名**包含**该关键字时，通知对应媒体库刷新；未匹配到任何规则则跳过通知。
- **测试按钮**：填写完配置后，可点击"测试连接"按钮，系统会自动保存配置并向映射中第一条规则的媒体库发送刷新指令，验证配置是否正确。
- **触发时机**：与 SmartStrm 通知相同，严格在 AI 重命名、STRM 生成等所有后置处理完成后触发。

# docker安装
```
  docker run -d \
  -v /vol2/1000/docker/cloud-auto-save:/home/data \
  -v /vol1/1000/link/cloud:/home/strm \
  -p 6001:3000 \
  --restart unless-stopped \
  --name cloud-auto-save \
  -e PUID=0 \
  -e PGID=0 \
  yahoj/cloud-auto-save
```
