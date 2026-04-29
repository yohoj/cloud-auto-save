
本项目 fork 自 https://github.com/1307super/cloud189-auto-save，新增了 smartstrm 的功能支持。
# SmartStrm 通知配置
- **功能说明**：支持在任务执行完成后自动触发 SmartStrm 的 Webhook
- **配置项**：
  - **Webhook URL**：SmartStrm 提供的 Webhook 接收地址。
  - **任务映射**：支持将本系统的资源名映射为 SmartStrm 中的任务名。
    - 格式：`关键字:映射任务名`
    - 示例：`动漫:tianyi_动漫;电影:tianyi_电影`
    - 逻辑：当转存路径或资源名包含`动漫`时，发送给 SmartStrm 的任务名将自动变为 `tianyi_动漫`。
- **触发时机**：系统会严格在 AI 自动重命名、STRM 生成等所有后置处理完成后再发送通知，确保 SmartStrm 处理的是最终正确的文件。