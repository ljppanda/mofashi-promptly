# 模法师-Promptly 生产镜像
# 构建上下文 = site/（前端源码 + server/）
# 多阶段：builder 负责 Vite 生产打包（含 public/ 静态资源），runtime 只带运行所需文件。

# ---------- 阶段 1：前端构建 ----------
FROM node:22-slim AS web
WORKDIR /app

# VITE_TURNSTILE_SITE_KEY 为历史构建期变量，保留以兼容既有 CI 参数；当前版本不再使用人机验证。
ARG VITE_TURNSTILE_SITE_KEY=""

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000 \
    || (npm cache clean --force && npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000)

COPY vite.config.ts tsconfig.json index.html ./
COPY src ./src
# public/ 必须参与构建：Vite 会把 public/samples/*.json 复制到 dist/samples/，
# 否则线上 /samples/*.json 会 404（SPA 兜底还会返回 index.html，前端更难排查）。
COPY public ./public

ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
RUN npm run build && npm cache clean --force

# ---------- 阶段 2：运行时 ----------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0

# 后端依赖：tsx 在 dependencies 中，--omit=dev 仍可用。
# onnxruntime/sharp/tree-sitter 等安装脚本在 CI 偶发网络失败，失败一次后清缓存重试。
COPY server/package.json server/package-lock.json ./server/
RUN cd /app/server \
    && (npm ci --omit=dev --no-audit --no-fund --foreground-scripts --fetch-retries=5 --fetch-retry-maxtimeout=120000 \
        || (npm cache clean --force && npm ci --omit=dev --no-audit --no-fund --foreground-scripts --fetch-retries=5 --fetch-retry-maxtimeout=120000)) \
    && npm cache clean --force

# 后端源码 + 种子语料 + 运维脚本
COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY server/data/templates.json ./server/seed/templates.json

# 前端构建产物（已包含 public/ 复制过来的 samples）
COPY --from=web /app/dist ./dist

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
