# 模法师-Promptly 生产镜像
# 构建上下文 = site/（含前端 index.html + src/ 与后端 server/）
FROM node:22-slim

WORKDIR /app

# ---------- 前端构建（Vite + TypeScript）----------
# 仅复制构建所需文件，安装依赖并执行生产打包，产物落在 /app/dist
# VITE_TURNSTILE_SITE_KEY 为「构建期固化」变量（前端验证框的 Cloudflare Site Key）：
#   构建镜像时通过 docker compose build --build-arg VITE_TURNSTILE_SITE_KEY=1x...
#   或 docker-compose.yml 的 build.args 传入（自动读同级 site/.env）。不传则留空，
#   前端自动隐藏验证框、后端因缺 secret 降级放行，不会阻断部署。
ARG VITE_TURNSTILE_SITE_KEY=""
COPY package.json package-lock.json ./ 
COPY vite.config.ts tsconfig.json ./ 
COPY index.html ./index.html
COPY src ./src
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
RUN npm install && npm run build && npm cache clean --force

# ---------- 后端依赖（tsx 已置于 dependencies，--omit=dev 仍可用）----------
COPY server/package.json server/package-lock.json ./server/
RUN cd /app/server && npm install --omit=dev && npm cache clean --force

# 后端源码 + 种子语料 + 备份脚本（运行时复制到可写数据卷）
COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY server/data/templates.json ./server/seed/templates.json

# 启动脚本（确保种子语料就位后运行）
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 8000
ENV PORT=8000
ENV NODE_ENV=production

ENTRYPOINT ["./docker-entrypoint.sh"]
