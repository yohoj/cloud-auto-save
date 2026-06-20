# 使用 Node.js 20 作为构建镜像（Vite 5 需 Node 18+；sqlite3 已验证在 Node 20 可用）
FROM node:20-slim AS builder

# 设置工作目录
WORKDIR /home

# 复制源码
COPY . .

# 安装后端依赖并编译
RUN yarn install && \
    yarn build

# 构建前端（独立 frontend/ 工程，产物输出到 frontend/dist）
RUN cd frontend && yarn install && yarn build

# 构建生产版本
FROM node:20-alpine AS production

# 设置工作目录
WORKDIR /home

COPY --from=builder /home/package*.json ./
COPY --from=builder /home/yarn.lock ./

# 安装生产依赖
RUN yarn install --production

# 复制构建好的代码
COPY --from=builder /home/dist ./dist
# Vue 构建产物作为主前端（Express 静态托管 dist/public）
COPY --from=builder /home/frontend/dist ./dist/public

# 安装必要的依赖项
RUN apk update && \
    apk add --no-cache ca-certificates tzdata
    

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone
    
# 创建数据目录
RUN mkdir -p /home/data

# 创建STRM目录
RUN mkdir -p /home/strm

# 挂载点
VOLUME ["/home/data", "/home/strm"]
# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["yarn", "start"]
