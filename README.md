# 模法师 · Promptly

> 把"写好一段提示词"升级为"沉淀可复用的提示词模板资产"。

**模法师（Promptly）** 是一个**提示词模板生成器**：先由 AI 生成"带占位符的结构化模板骨架"（F1），再按你的具体目标把模板实例化为可直接使用的成品提示词（F2）。模板是可参数化、可复用、可组合的资产，而不只是一段一次性文本。配套提供社区（发布 / 评分 / 收藏 / 举报 / 审核）、导入导出闭环、模板评测框架与生产级安全基线。

**生成质量即产品底线**：F1 产出的模板骨架与 F2 写出的成品提示词，均按**生产级七段结构**（角色与背景 → 目标 → 核心约束与禁止项 → 工作流 → 输出规范含格式示例 → 边界与兜底 → 自检清单）组织；F2 额外带**自检回路**——首稿生成后对照生产级清单批判并改写一次，逼近人工优化效果。社区官方种子模板、RAG 召回语料、首页模板库与下载样例也统一为同一生产级结构。

---

## 为什么不一样（核心亮点）

- **两阶段范式 F1 → F2（差异化核心）**：区别于大多数"把写好的提示词存起来分享 / 售卖"的平台，Promptly 把"模板"和"实例"分开。模板是带 `{{占位符}}` 的结构化骨架，实例是按目标填槽的结果——模板可被反复复用、组合、版本化。
- **本地优先 / 隐私友好**：模型 API Key 只存在浏览器本地（`localStorage`），用户用自己的额度调用大模型，数据不上交平台去买额度。
- **可自托管**：整套服务可私有化部署，数据完全自控，适合企业内网、个人数据不出域等合规场景。
- **真实多用户 + 作者身份服务端绑定**：开放注册（`scrypt` 加盐哈希），发布时服务端强制绑定作者，杜绝伪造；"我的发布"按作者过滤。
- **社区闭环**：发布 / 评分（1–5 星）/ 收藏 / 举报 / 管理员审核台 / 作者主页 / 热度榜，形成质量飞轮。
- **内置 RAG 检索增强**：默认词法召回，可选开启 bge 语义向量 + RRF 混合召回 + cross-encoder 重排（联网首次下载模型即激活）。
- **生产级安全 + 韧性基线**：鉴权、注册人机验证（Turnstile）、SSRF 防护、CSP/XSS 收口、SQLite WAL、输入长度校验、速率限制、结构化日志、进程优雅退出、Docker（含自动备份调度）、CI/CD、版本化 schema 迁移 + 备份（定时化）、**LLM 指数退避重试 + 主备切换**、**可观测 metrics + 可选 Sentry**、**Prompt 版本锁定**，均已落地。
- **导入 / 导出闭环**：导出支持「成品 OpenAI JSON / Markdown / 纯文本 / 模板 JSON」四格式；导入支持「模板 JSON（含 prompt）/ 成品 OpenAI JSON（含 messages）」两种格式，载入详情页可继续编辑 / 收藏。
- **模板评测框架**：生成端 + 裁判端分离，支持交叉验证，内置评测集（已扩至 33 例），`npm run eval` 一键编排。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vite + TypeScript（零运行时框架，原生 ES 模块，已按 `core/` + `views/` 组件化分层）+ Tailwind（构建期编译，去除运行时 CDN 依赖） |
| 后端 | Node 22 + TypeScript（`tsx` 运行），内置 `node:sqlite` 单文件数据库 |
| Agent | LangGraph `StateGraph`：`clarify → draft → validate →（不通过则回流 draft） → finalize` |
| RAG | LlamaIndex + LanceDB；词法默认 + 可选 bge 语义（RRF 混合）+ 可选 reranker |
| 大模型 | 18 家主流 LLM 厂商预置接入（OpenAI / DeepSeek / Kimi / 智谱 / 通义 / 豆包 / 混元 / Claude / Gemini / 文心 等），**用户自带 Key** |
| 可观测 | LangSmith 云端 trace（可选） + 内置 `/ops/metrics` + 可选 Sentry 错误聚合 |
| 部署 | Docker + docker-compose，反代（Caddy / Nginx）做 TLS |

---

## 技术选型与权衡（Why this stack）

本项目刻意没有采用 React / Postgres 等"主流默认"，而是选用 **零运行时框架前端 + Node 内置 `node:sqlite` 单文件后端**。这不是技术保守，而是与产品定位（可自托管、数据自控、零运维）一致的工程取舍：

- **前端零运行时框架（Vite + 原生 ES 模块）**：用最小依赖把复杂度留在架构而非框架。代码按 `core/` + `views/` 分层，采用 Context（共享状态）/ Module（纯函数工具）/ Component（视图）/ Factory / Configuration / Router 等模式——这些思想与 React / Vue / NestJS 完全同构，证明掌握的是工程方法而非某个库。去除框架运行时后，首屏更轻、构建产物更可控。
- **后端 Node 22 + `tsx` + 内置 `node:sqlite`**：单文件数据库（WAL）让整个服务"拷走即跑"，无需独立数据库进程，天然契合私有化部署 / 内网 / 个人数据不出域的合规场景。`node:sqlite` 为 Node 22 新内置能力，避免引入额外数据库驱动；规模需要时存储层可平滑替换为 Postgres 等（SQL 接口基本同构，迁移 runner 已版本化）。
- **LangGraph + LlamaIndex + LanceDB（可选 RAG）**：Agent 用 LangGraph 状态图表达 `clarify → draft → validate → finalize` 的回流逻辑，比手写回调更可读；RAG 默认词法召回、按需开启 bge 语义向量 + 重排，联网首次下载即激活，零配置可用。
- **18 家 LLM 厂商直连、用户自带 Key**：模型调用走浏览器本地 + 服务端 `/relay` 白名单转发（SSRF 防护），平台不托管用户额度，隐私友好也更轻。

**可迁移性说明**：上面每一层的能力都不绑定特定库。若目标环境要求 React + Postgres + NestJS，本项目的双轨鉴权 / SSRF 收口 / 限流 / 版本化迁移 / 重试主备 / 可观测等实现均可平移到对应技术栈，架构分层与设计模式直接复用。

---

## 架构概览

```
浏览器(SPA) ──HTTP/JSON──▶ Node 后端(:8000)
                            ├─ /api/auth     双轨鉴权（管理员口令 + 开放注册）
                            ├─ /agent        模板生成 Agent（LangGraph）
                            ├─ /relay        带白名单的 LLM 转发（SSRF 防护）
                            ├─ /community    社区（发布 / 评分 / 收藏 / 举报 / 审核台）
                            ├─ /traces       调用记录（需登录：管理员看全部 / 用户仅看本人）
                            ├─ rag           LlamaIndex + LanceDB 检索增强
                            └─ node:sqlite   单文件持久化（WAL + 版本化迁移）
```

前端模块分层：

```
site/src/
├─ core/        基础设施层
│  ├─ ctx.ts      应用上下文（Context / 依赖注入单例，集中共享状态）
│  ├─ ui.ts       纯 UI 工具（Module：转义 / toast / 步骤条渲染）
│  ├─ auth.ts     鉴权（Module：登录 / 注册 / window.Auth）
│  ├─ steps.ts    状态机步骤条（Module）
│  └─ config.ts   常量集中（Configuration：ICON / 行业 / 步骤定义）
└─ views/       视图层（Component，各页面）
   ├─ home.ts / detail.ts / generate.ts / refine.ts
   ├─ community.ts / author.ts / board.ts
   ├─ my.ts / settings.ts / traces.ts / import.ts
   app.ts 为组合根（Router）：仅做路由分发 + 启动
```

---

## 核心功能

| # | 功能 | 说明 |
|---|---|---|
| F1 | 一句话生成模板（流式）+ 智能澄清 | 指定行业 + 一句话 → AI 返回**生产级模板骨架**（实时逐字流式，可「停止生成」），骨架自带 角色/背景/目标/约束/工作流/输出规范/边界兜底/自检 七段结构；信息不足时 Agent 反问澄清，支持**单选与多选**（如语气 / 维度可叠加）→ 落入填表流程 |
| F2 | 智能补全 / 模板改写 | 填表点「补全」给候选；「改写（refine）」基于上下文重写模板骨架 |
| F3 | 交互式填表 | 4 种变量输入（文本域 / 单行 / 下拉 / 多选）→ 实时拼装预览 |
| F4 | 一键复制 / 导出 / 导入 | 复制成品；导出 JSON / Markdown / 纯文本 / 模板 JSON；导入两种格式闭环 |
| F5 | 我的模板 | 浏览器 `localStorage` 持久化（AI 生成的 + 收藏的 + 云端草稿回流） |
| F6 | 设置 | 配置自有 LLM Key + 模型选择（🔄 一键拉取真实在役模型）+「测试连接」回显实际模型 + 代理开关 |
| F7 | 社区 | 发布 / 评分（1–5 星）/ 收藏 / 举报 / 审核台 / 作者主页 / 热度榜 |
| F8 | 评测框架 | 生成端 + 裁判端分离，交叉验证，评测集 33 例，`npm run eval` 编排 |
| F9 | 跨模型对比 + 成本预估 | 同一提示词并发跑 2–3 个模型，并排看输出 + token 用量 + 按公开价目估算成本（测试沙盒内 🔬 一键发起） |
| F10 | 模板版本历史 + diff/回滚 | 「我的模板」每次编辑自动留版（限 30 版），行级 diff（红删 / 绿增）+ 一键回滚 |
| F11 | Remix / 派生社区模板 | 社区详情页「🍴 派生」克隆为带来源的私有可编辑副本，改完可再发布回社区，形成 Remix 闭环 |
| F12 | 模型清单实时同步 | 设置页 🔄 一键拉取各厂商在役模型（OpenAI / Claude / Gemini 三套协议），切换厂商自动刷新下拉；拉不到时回退 OpenRouter 公开聚合目录（无需 Key），再回退内置已校准清单。内置清单经 OpenRouter 实测校准，修 3 处会 400 的错误 ID（claude 连字符 / grok-4-latest / ollama deepseek-r2） |
| F13 | 提示词自动优化闭环 | 详情页「🔧 一键优化」：对模板采样 N 组测试目标 → 实例化 → 跑被测模型 → LLM-as-judge 4 维打分（0-20）→ 均分低于阈值则基于「评测结论」自动改写并复测，原版 vs 优化版并排对比 + 行级 diff；采用即进「历史版本」可回滚。**全程浏览器本地用用户自己的 Key，零服务端依赖** |
| F14 | 修改密码 | 登录态下「设置」页可改密码：校验当前密码 → 更新（scrypt 加盐重哈希）。管理员口令走服务端环境变量，不入用户表 |
| F15 | 邮箱密码重置 | 业界标准自助找回：登录页「忘记密码？」→ 填邮箱 → 服务端生成一次性令牌（SHA-256 存储、30 分钟过期、单次用），邮件发重置链接；点击后设新密码（≥8 位）。忘记密码均匀返回 200 + 枚举防护，前置 5 次/小时/IP 限流。生产需配置 `RESEND_API_KEY` + `RESEND_FROM` + `APP_PUBLIC_URL`（未配置走 dev 降级，链接落盘 `data/dev-reset-links.log`） |
| F16 | 发现 / 检索 | 行业 × 任务浏览、全文搜索、标签过滤、RAG 检索增强、热门预览 |
| F17 | 可观测 | 各 provider 成功率 / 延迟、生成成功率、RAG 命中率、主备切换（`/ops/metrics`） |
| F18 | 移动端适配 | 响应式布局，手机端可用 |
| F19 | 社区「合集 / 专辑」 | 用户创建命名合集，把已公开社区模板分组收藏；合集列表页（`#/collections`）+ 合集详情页（`#/col/:id`，复用社区卡片）+ 模板详情「📚 加入合集」弹窗（可新建 / 加入 / 移出）。归属以服务端鉴权身份为准，仅作者或管理员可增删成员 |
| F20 | 模板「示例预览」 | 详情页「🔍 示例预览」弹窗：填示例目标后两步流式——① 按模板实例化为成品提示词（折叠展示）② 用成品提示词跑出示例回答（主展示），直接看模板真实产出，对标 PromptBase。复用用户自带 Key，零服务端改动、零外泄 |
| F21 | 社区体验增强（竞品监控 r6） | ① **封面轻量版**：社区模板支持封面（http(s) 链接或 `data:image`），列表 / 详情展示，无封面回退行业渐变占位图；发布表单接受封面，`validate` 限 3MB 且仅放行 http(s)/`data:image`（拦截 `javascript:` 等注入）；`community` 表 `cover` 列（v6 迁移）。② **🚀 在线试跑**：社区卡片 + 详情页「🚀 一键试跑」，复用 F20 的 `openPreviewModal`（用户自带 Key 本地流式跑示例，零服务端改动）。③ **标签云 + 相对时间**：社区列表 top20 频率标签云（点击填入搜索框）；相对时间 `fmtRelative`（刚刚 / X 分钟前 / …） |
| F22 | 首页社区热门 + 热门合集榜（竞品监控 r7） | ① 首页「🌟 大家都在用」：复用 `communityCard` 拉取社区 `heat` 排序 Top6，点击进入社区详情。② **热门合集榜**：合集列表按模板数排序，Top1 带「🔥 热门」徽标。两者均为纯前端增强，零 schema 改动 |
| F23 | 公开「模型支持」矩阵页 + 隐私信任徽标（竞品监控 r8） | 新增 `#/models` 落地页：复用 `LLM.PROVIDERS` 展示 **19 家厂商 + 内置模型矩阵**，并提供「🔄 拉取当前设置厂商真实在役模型」（复用 F12 的 `LLM.listModels`，含失败回退 + 提示）；首页信任条下方加隐私卖点（**API Key 仅存本机浏览器、平台不训练你的数据**）+ 跳转移模型页链接。补 SEO 落地页 + 专业信任，纯前端、零 schema |
| F24 | 社区卡片 fork+优化常驻 + 排序补全（竞品监控 r9） | ① 社区 square 卡片新增常驻 **🍴 派生**（复用 F11 `remixToMine`，一键 fork 到「我的模板」带 `forkedFrom` 来源标记）与 **🔧 优化**（复用 F13 `openOptimizeModal`，采用时自动存为我的模板副本、不改写原社区模板）按钮，对标 PromptForge Gallery 的 forkable + ChatGPT Pro Tools 优化器前置；② 列表排序 `cm-sort` 补全 **收藏最多 / 使用最多**（后端 r7 已支持 favorites/uses，前端此前缺 option）。纯前端、零 schema |
| F25 | 新手引导 + 合规信任强化（竞品监控 r10） | ① 新增 `#/guide` 提示词工程入门落地页：科普「变量化模板（`{{占位符}}`）」与「七段生产级结构（角色/背景/目标/约束/工作流/输出规范/边界兜底/自检）」，含示例对比 + 三步上手，对标 LearnPrompting 降低首访门槛；② 首页加「3 步上手」引导区（`#/guide` 入口）；③ `#/models` 页补「🛡️ 数据不出域·合规说明」陈述段（Key 不离开设备 / 白名单转发防 SSRF / 自托管友好 / 社区审核）+ 行业场景占位墙。纯前端、零 schema |

---

## 快速开始

### 本地开发（前后端分离）
```bash
# 后端（监听 :8000）
cd site/server && npm install && npm start

# 前端开发服务器（:5173，/api 等自动代理到 :8000，免跨域联调）
cd site && npm install && npm run dev
```

### 生产构建 + 运行（单进程托管前端静态）
```bash
cd site && npm install && npm run build     # 产出 site/dist
cd site/server && npm install && npm start  # 后端自动托管 dist
# 打开 http://localhost:8000
```

### Docker（含构建期内打包前端）
```bash
docker compose up -d --build
```

### 快速部署 Checklist（公网发布）

下面是从零把服务跑在公网的最小步骤；所有密钥都写在 `site/server/.env`（由 `.env.example` 复制而来，已被 `.gitignore` 忽略，**不会进仓库**）。

1. **准备服务器**：一台装好 Docker + docker compose 的云服务器；把域名 `A` 记录解析到服务器 IP。
2. **取代码**：`git clone git@github.com:ljppanda/mofashi-promptly.git && cd mofashi-promptly/site`
3. **写配置**：`cp server/.env.example server/.env`，编辑 `.env` 至少填：
   - `APP_ADMIN_PASSPHRASE=...`（**必填**：后台审核台 / 下架 / metrics 登录口令）
   - `TURNSTILE_SECRET_KEY=...`（**注册人机验证建议开启**：在 [Cloudflare Turnstile](https://dash.cloudflare.com/turnstile) 免费申请；不填则注册降级放行、验证框不出现。前端 Site Key 写在项目根 `site/.env` 的 `VITE_TURNSTILE_SITE_KEY=1x...`，构建镜像时通过 `docker compose build --build-arg VITE_TURNSTILE_SITE_KEY=1x...` 注入，或靠 compose 同级 `site/.env` 自动读取）
   - `RESEND_API_KEY` / `RESEND_FROM` / `APP_PUBLIC_URL`（**邮箱重置必填**：三项都不填则走 dev 降级，只把重置链接打印到容器日志并落盘 `server/data/dev-reset-links.log`，用户收不到邮件）
   - `APP_CORS_ORIGIN=https://你的域名`（前端走独立域名 / 反代时填前端源；同源部署可不设）
   - 其余按需：`LLM_FALLBACK_*`、`MODERATION_*`、`SENTRY_DSN`、`RAG_EMBEDDING` 等（详见 `.env.example` 注释）
4. **构建并启动**：`docker compose up -d --build`
5. **验证**：`curl https://你的域名/healthz` 返回 `ok`；打开站点注册一个账号，实测一次「忘记密码」——生产链路用户会收到邮件，dev 降级则链接出现在 `docker compose logs` 与 `server/data/dev-reset-links.log`。
6. **HTTPS（TLS）**：在容器前放 Caddy / Nginx 反代 80/443。最小 Caddy 片段（自动签发证书）：
    ```caddyfile
    # Caddyfile
    your-domain.com {
        reverse_proxy localhost:8000
    }
    ```
7. **数据备份（自动定时化）**：镜像随容器启动即自动备份一次、并每 `BACKUP_INTERVAL_MS`（默认 6h，下限 60s）循环备份到 `server/data/backups/`（compose 的 `appdata` 卷内，已持久化并轮转保留多份），**无需手动操作**。如需手动触发：进容器执行 `node scripts/backup.mjs`。备份目录已被 `.gitignore` 忽略，**切勿备份进仓库**。

> 说明：`docker-compose.yml` 已内置 `/healthz` 健康检查、数据卷 `appdata` 持久化、`unless-stopped` 重启策略；环境变量优先读 `./server/.env`（`env_file`），也可在 `environment:` 段覆盖。

---

### 提交与推送（SSH 免 Token）

> 本项目推送**只用 SSH 密钥**，不在命令 / 对话里出现任何 PAT 明文。
> 注意：GitHub **连接器（MCP）只授权 AI 调 GitHub API**（建 issue / PR / 看 CI 等），**不参与 `git push` 的 Git 传输层认证**——所以本机 git 推送仍需下面这套 SSH 凭证。

换机器或重新配置时照此执行：

```bash
# 1. 生成专用 ed25519 密钥（无 passphrase 以便推送免交互）
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_github -N "" -C "your-github-handle"

# 2. 把公钥加到 GitHub：Settings → SSH and GPG keys → New SSH key
#    复制下面整行（.pub 文件内容）粘进去即可
cat ~/.ssh/id_ed25519_github.pub

# 3. 写 ~/.ssh/config，让 SSH 自动用该密钥并自动接受 github 主机指纹
#    Host github.com
#      HostName github.com
#      User git
#      IdentityFile ~/.ssh/id_ed25519_github
#      StrictHostKeyChecking accept-new

# 4. 把仓库 remote 切到 SSH（首次克隆若是 HTTPS，改一下）
git remote set-url origin git@github.com:ljppanda/mofashi-promptly.git

# 5. 验证（首次会提示接受主机指纹，之后零 token 直接成功）
ssh -T git@github.com          # 看到 "You've successfully authenticated" 即 OK
git push origin main           # 不再需要任何 PAT
```

> ⚠️ 私钥 `~/.ssh/id_ed25519_github` 本机持有即可推送，请妥善保管；若设了 passphrase，推送时会交互式询问（CI 环境需改用 deploy key 或凭据助手）。

---

## 配置

复制 `site/server/.env.example` 为 `site/server/.env` 后按需填写。核心项：

- `APP_ADMIN_PASSPHRASE`：管理员口令（**建议必填**，留空则每次启动生成临时口令）。
- `APP_CORS_ORIGIN`：跨域白名单（默认同源收紧）。
- `LLM_MAX_RETRIES` / `LLM_FALLBACK_PROVIDERS`：LLM 韧性——指数退避重试次数、主备 provider 切换列表（服务端持有备用 Key 时启用）。
- `RAG_EMBEDDING` / `RAG_RERANKER`：语义检索开关（首次需联网下载模型）。
- `MODERATION_PROVIDER` / `MODERATION_MODEL` / `MODERATION_API_KEY`：社区 AI 审核（公网建议开启）。
- `SENTRY_DSN`：可选错误聚合（仅设则启用）。
- `LOG_FORMAT`：日志格式（`json` 切 JSON 行便于采集）。
- `RESEND_API_KEY` / `RESEND_FROM` / `APP_PUBLIC_URL`：**邮箱密码重置（F15）投递所需**。`RESEND_API_KEY` 走 Resend 发信（纯 fetch，无需装包）；`RESEND_FROM` 发件人（缺省 `onboarding@resend.dev`）；`APP_PUBLIC_URL` 站点公网地址，用于生成重置链接（`https://<站点>/?token=...`）。三者均**未配置**时走 dev 降级：仅把重置链接打印到服务端日志并同步落盘 `site/server/data/dev-reset-links.log`，便于本地/自测。
- `LANGSMITH_*`：可选链路追踪。

> ⚠️ 安全提示：`.env`、会话密钥 `.app_secret`、数据库 `*.db*`、向量库 `lancedb/`、构建产物 `dist/`、`node_modules/` 均已在 `.gitignore` 中排除，**切勿提交**。

---

## 安全与加固

- **鉴权**：HMAC-SHA256 会话令牌（有效期 30 天）；普通用户闸（发布 / 评分 / 收藏 / 举报 / 删除）+ 管理员闸（公开 / 下架 / 审核台 / 处理举报 / metrics 重置）。
- **SSRF**：`/relay` 仅允许 LLM 厂商公网域名白名单 + DNS 解析后拒绝私有 / 环回 / 链路本地地址（fail closed）。
- **XSS / CSP**：模型输出走 `textContent`，用户输入统一转义；统一 CSP + `X-Frame-Options` + `nosniff` + `no-referrer`。
- **数据可靠性**：SQLite WAL + `busy_timeout` 防并发写锁；**版本化 schema 迁移 runner**（改表结构不炸老库）；`scripts/backup.mjs` 安全备份（含 WAL 伴随文件 + 轮转）。
- **LLM 韧性**：指数退避重试（仅可重试错误）+ provider 主备切换。
- **可观测**：内存指标（provider 成功率 / 延迟、生成成功率、RAG 命中率、主备切换）+ `/ops/metrics`（ADMIN）+ 可选 Sentry。
- **其他**：集中输入长度校验、内存固定窗口速率限制（全局 240/min、注册 5/h、忘记密码 5/h、relay 30/min、**发布 12/h**）、结构化日志、进程优雅退出、Docker、CI/CD（含 Docker 镜像构建冒烟测试）。

---

## 项目状态与路线图

**当前状态**：具备完整产品闭环的**内测级可上线**项目——两阶段生成、真实多用户鉴权、社区闭环、RAG、评测框架、生产级安全 / 韧性 / 可观测、CI 齐备，可自用 / 小范围内测；公网规模发布仍需 Phase 2-4（见下）。

**已完成（本仓库已落地）**：
- 两阶段模板资产化（F1 / F2）基础链路
- 生产加固第一档：版本化迁移 + 备份、LLM 重试退避 + 主备、Prompt 版本锁定、可观测 metrics + 可选 Sentry、限流、结构化日志、优雅退出、Docker、CI
- 社区闭环（发布 / 评分 / 收藏 / 举报 / 审核台 / 作者页 / 热度榜）+ 移动端适配
- 前端工程化：Vite + TS 组件化（`core/` + `views/` 分层，Context / Module / Component / Factory / Configuration / Router 设计模式）
- 导入 / 导出闭环、token 消耗展示、流式生成 + 停止、RAG 检索增强
- 三大高优先级能力：① 跨模型对比测试 + token / 成本预估（F9）；② 用户模板版本历史 + 行级 diff / 回滚（F10）；③ Remix / 派生社区模板（F11）
- 模型清单自愈（F12）：设置页实时拉取厂商在役模型 + OpenRouter 聚合目录二级兜底 + 内置清单经实测校准（修 claude 连字符 / grok-4-latest / ollama deepseek-r2 三处 400 bug）
- 提示词自动优化闭环（F13）：详情页「一键优化」——采样评测 → LLM-as-judge 4 维打分 → 低于阈值自动改写并复测 → 原版/优化版对比 + 行级 diff；采用即进版本历史可回滚，全程浏览器本地、零服务端依赖
- 账号自助密码体系（F14 / F15）：**修改密码**（登录态校验当前密码后更新，scrypt 加盐重哈希；管理员口令走环境变量不入用户表）+ **邮箱密码重置**（业界标准自助找回：`forgot-password` 均匀返回 200 + 枚举防护 + 5 次/小时/IP 限流 → `reset-password` 用 SHA-256 一次性令牌、30 分钟过期、单次用、新密码 ≥8 位；生产走 Resend，未配置走 dev 降级并落盘 `data/dev-reset-links.log`）
- 前端样式工程化：Tailwind 由运行时 CDN 改为**构建期编译**（PostCSS + autoprefixer 扫描 `index.html` + `src/**` 产出工具类 CSS），彻底去除 `cdn.tailwindcss.com` 运行时依赖；CSP 同步收紧（移除该域名白名单）。`index.html` 补齐 SEO 元信息（description / keywords / Open Graph / Twitter Card / JSON-LD `WebSite` 结构化数据）
- 社区冷启动 + SEO 落地：服务端 `seedCommunityIfEmpty()` **幂等**注入 8 个官方精选模板（小红书种草 / 代码评审 / 周报 / 教案 / 电商详情 / 理财 / 健康科普 / 合同审查，带真实热度与评分），填满社区 / 热度榜 / sitemap 空状态；`/sitemap` 始终含首页 / 社区 / 热度榜核心静态路由，模板页按真实 id 动态列出，保证可被搜索引擎收录
- 生成体验优化：首页生成结果入口由淡链接改为**醒目主按钮**「✨ 打开模板，生成你的提示词」，生成成功后自动滚动入屏；本页已生成过时再次点「生成模板」会**二次确认**，避免误建重复草稿
- 澄清问答多选支持：生成提示词时 Agent 反问的澄清选项，原本强制单选；现 `ClarifyQuestion` 支持 `multi` 标记，LLM 可对"语气风格 / 覆盖维度"等天然可叠加的维度标注可多选，前端 chip 可点选多个、答案用"、"连接，单选保持原行为
- 社区体验增强（竞品监控报告 r4 的 #4/#5/#7）：社区列表 / 详情按 `author==="模法师官方"` 区分「官方」/「社区」来源徽章；模板详情页新增结构化元信息（变量数 / 骨架字数 / 适配任意模型）；社区页头部增加量化信任背书条（模板数 / 行业数 / 变量化定位）
- 模板「示例预览」（报告 r4 #3）：详情页「🔍 示例预览」弹窗——填示例目标后两步流式，先实例化为成品提示词（折叠），再跑出示例回答（主展示），直接对标 PromptBase 的"看模板真实产出"；复用 `LLM.useTemplate` + `LLM.chatWithPrompt`，自动读用户自带 Key，零服务端改动
- 社区「合集 / 专辑」（报告 r4 #2 核心项）：新增 `collections` + `collection_items` 两表（v5 迁移）；社区页头部「📚 合集」入口、合集列表页（`#/collections`）、合集详情页（`#/col/:id`，复用社区卡片）、模板详情「📚 加入合集」弹窗（列我的合集、加入 / 移出、当场新建）。归属以服务端鉴权身份为准，仅作者或管理员可增删成员；目标模板须已公开
- 社区发布反垃圾去重（报告 r4 #6）：公开动作（`publish-now`）前先算相似度（bigram，阈值 0.6），命中相似公开模板且未确认则返回 `needsConfirm` 暂不发公开，用户确认后带 `confirmDuplicate` 重调才上架（对标 PromptBase / Snack 的重复投稿提示）；`publish` 与 `publish-now` 顶部加按 IP 发布频控（`RL_PUBLISH_LIMIT` 默认 12/h）防批量灌水
- 工程化收尾：根目录补标准 **MIT LICENSE**（此前 README 声明 MIT 却缺文件）；`ci.yml` 新增 **Docker 镜像构建冒烟测试 job**（`docker compose build` 后 `up -d` 轮询 `/healthz`，失败即红），兜住一键部署镜像长期可构建可启动
- 竞品监控报告（r4）的 8 条建议已**全部落地或确认完成**：#1 排序 tab（前端 `cm-sort` 下拉早已实现，报告误判，复核后确认完成）、#2 合集（本轮）、#3 示例预览（本轮）、#4/#5/#7（本轮）、#6 反垃圾（本轮）；仅 #8 workflow 市场（多步工作流模型，架构级扩展）留待后续评估
- **生成质量升到生产级（回应"做提示词的网站自己产出的提示词却很水"）**：① F1 `draft` 与 F2 `use` 元提示词升级到 v2，强制产出 角色/背景/目标/约束与禁止项/工作流/输出规范(含格式示例)/边界与兜底/自检 七段生产级结构（前后端 prompt 注册表 `prompts.ts` + 前端直连 `llm.ts` 同步升级）；② F2 新增**自检回路**——首稿生成后对照生产级清单批判并改写一次（前端 `useTemplate(selfCheck)` + 服务端 `runAgentUse` 均实现，逼近人工优化效果，多一次调用）；③ 橱窗同步升级：8 个官方种子模板（`COMMUNITY_SEED`）重写为生产级，并用脚本 `scripts/upgrade-templates.mjs` 把 102 个首页模板库（`templates.ts`）、RAG 语料（`data/templates.json`）、下载样例（`samples/*.json`）统一重写为同一生产级结构（保留各模板原有具体写法要求、补缺失章节）。改动零破坏性：`use`/`draft` 旧版 v1 保留可回滚，prompt 版本锁定机制不变
- 社区体验增强（竞品监控报告 r6 / r7）：r6 落地 ① **封面轻量版**（`community` 表 `cover` 列 v6 迁移 + `validate` 格式白名单仅放行 http(s)/`data:image`、限 3MB、拦截 `javascript:` 注入 + 无封面回退行业渐变占位图）② **🚀 在线试跑**（社区卡片 / 详情页复用 F20 的 `openPreviewModal`，用户自带 Key 本地流式跑示例，零服务端改动）③ **标签云**（社区列表 top20 频率标签，点击填入搜索框）+ **相对时间**（`fmtRelative`）；r7 落地 ① 首页「🌟 大家都在用」社区 `heat` Top6 模块（复用 `communityCard`）② **热门合集榜**（合集按模板数排序 + 🔥 热门徽标）。r7 报告其余建议（封面自动截图 / 二级下钻 / 创作者榜 / SEO 落地页 / 策展包 / Agent API）经评估暂不在当前迭代范围
- 公开「模型支持」矩阵页 + 隐私信任徽标（竞品监控报告 r8）：报告 #1「社区卡片社会证明」经代码核查**已落地**（社区卡片早已展示 uses/favorites/avgRating + 官方/社区徽章，报告因前端 SPA 未启动误判），跳过；本轮落地 #4 **公开模型矩阵页 `#/models`**——复用 `LLM.PROVIDERS` 渲染 19 家厂商 + 内置模型矩阵，提供「🔄 拉取当前设置厂商真实在役模型」（复用 F12 `LLM.listModels`，失败回退 + 提示），并把「API Key 仅存浏览器本地、平台不训练你的数据」做成首页信任条下的隐私卖点 + 模型页隐私横幅，补 SEO 落地页与专业信任。r8 其余建议（#2 轻量增强钩子 / #3 Deploy API / #5 Playbook 策展包 / #6 浏览器扩展 / #7 团队共享）经评估暂不在当前迭代范围
- 社区卡片 fork + 优化常驻 + 排序补全（竞品监控报告 r9）：报告再次误判「社区卡片社会证明未显性化」（实际 r8 已核，卡片早已展示 uses/favorites/avgRating + 来源徽章，跳过）；真正落地 ① 社区 square 卡片新增常驻 **🍴 派生**（`remixToMine` 从详情页内联逻辑抽成复用导出函数，fork 到「我的模板」带 `forkedFrom` 来源标记，形成完整 Remix 闭环）与 **🔧 优化**（复用 F13 `openOptimizeModal`，采用时 `Store.addMine` 落为我的副本、不改写原社区模板，安全）② 列表排序 `cm-sort` 补全「收藏最多 / 使用最多」（后端 r7 已支持 favorites/uses，前端此前缺 option）。r9 其余建议——#1 模板 Consume API（中，后端只读 + 限流）、#3 F13 优化器进一步前置到首页 / 生成结果区、#4 版本 stable/latest 频道、#5 发布前 QA 闸门、#6 浏览器扩展（高）——经评估暂不在当前迭代范围
- 新手引导 + 合规信任强化（竞品监控报告 r10）：报告"不足"段经核查剔除重复项——#2 跨模型对比 `detail.ts` 详情页**已有** `🔬 跨模型对比` 按钮（报告误判未常驻，跳过）、#5「最近更新」=`cm-sort` 的 `new` 已覆盖；真正落地 ① **`#/guide` 提示词工程入门落地页**（科普变量化模板 + 七段生产级结构，含示例对比与三步上手，对标 LearnPrompting）② 首页加「3 步上手」引导区（链 `#/guide`）③ `#/models` 补「🛡️ 数据不出域·合规说明」段（Key 不离开设备 / 白名单转发防 SSRF / 自托管友好 / 社区审核）+ 行业场景占位墙（强化 B 端信任）。r10 其余建议——#1 模板 Consume API（中，后端只读 + 限流，r9 #1 顺延）、#4 多模态模板品类（高）、#5「最多贡献」排序（需后端按作者聚合，新维度）、#6 发布前 QA 质量门（中，后端）——经评估暂不在当前迭代范围

**后续改进方向（按优先级）**：

1. **公网就绪 Phase 2-4**：✅ 注册强防护（Turnstile 验证码）已落地、✅ 备份定时化（`backup-scheduler` 随容器自动运行）已落地、DB↔LanceDB 一致性经核查机制健全无需改动；仅 TLS 反代（按上方 Caddy 片段即配）与邮箱验证（可选增强）待上线前配置。
2. **模板资产化深化（差异化核心）**：模板组合 / 链式（composable）、引用关系图、跨模板复用与引用追踪。
3. **评测 → 优化闭环**：基于评测结果的自动优化循环（prompt auto-improve，结合 F9 跨模型对比择优）。
4. **社区发现 / SEO**：全文搜索增强、标签体系、作者主页完善（sitemap / OG 元信息已落地）。
5. **协作 / 团队共享库（可选）**、**跨工具嵌入（浏览器插件浮窗 / Coze，claw，可选）**。
6. **workflow 市场 / 多步编排（可选）**：竞品监控报告 r4 唯一未落地的 #8，需新增「工作流 / 步骤」数据模型与编排 UI，属架构级扩展，建议公网跑出真实用户后再评估。

---

## 许可证

本项目采用 **MIT 许可证**，详见仓库根目录 `LICENSE`（Copyright 2026 ljppanda）。欢迎 Fork 学习；如需商用请先联系作者。
