# 模法师-Promptly 生产镜像
# 构建上下文 = site/（含前端 index.html + src/ 与后端 server/）
FROM node:22-slim

WORKDIR /app

# ---------- 前端构建（Vite + TypeScript）----------
# 仅复制构建所需文件，安装依赖并执行生产打包，产物落在 /app/dist
COPY package.json package-lock.json ./ 
COPY vite.config.ts tsconfig.json ./ 
COPY index.html ./index.html
COPY src ./src
RUN npm install && npm run build && npm cache clean --force

# ---------- 后端依赖（tsx 已置于 dependencies，--omit=dev 仍可用）----------
COPY server/package.json server/package-lock.json ./server/
RUN cd /app/server && npm install --omit=dev && npm cache clean --force

# 后端源码 + 种子语料（运行时复制到可写数据卷）
COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY server/data/templates.json ./server/seed/templates.json

# 启动脚本（确保种子语料就位后运行）
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 8000
ENV PORT=8000
ENV NODE_ENV=production

ENTRYPOINT ["./docker-entrypoint.sh"]
