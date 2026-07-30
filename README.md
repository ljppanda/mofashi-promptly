# 模法师 · Promptly

> 把"写好一段提示词"升级为"沉淀可复用的提示词模板资产"。

**模法师（Promptly）** 是一个**提示词模板生成器**：先由 AI 生成"带占位符的结构化模板骨架"（F1），再按你的具体目标把模板实例化为可直接使用的成品提示词（F2）。模板是可参数化、可复用、可组合的资产，而不只是一段一次性文本。配套提供社区（发布 / 评分 / 收藏 / 举报 / 审核）、导入导出闭环、模板评测框架与生产级安全基线。

---

## 为什么不一样（核心亮点）

- **两阶段范式 F1 → F2（差异化核心）**：区别于大多数"把写好的提示词存起来分享 / 售卖"的平台，Promptly 把"模板"和"实例"分开。模板是带 `{{占位符}}` 的结构化骨架，实例是按目标填槽的结果——模板可被反复复用、组合、版本化。
- **本地优先 / 隐私友好**：模型 API Key 只存在浏览器本地（`localStorage`），用户用自己的额度调用大模型，数据不上交平台去买额度。
- **可自托管**：整套服务可私有化部署，数据完全自控，适合企业内网、个人数据不出域等合规场景。
- **真实多用户 + 作者身份服务端绑定**：开放注册（`scrypt` 加盐哈希），发布时服务端强制绑定作者，杜绝伪造；"我的发布"按作者过滤。
- **社区闭环**：发布 / 评分（1–5 星）/ 收藏 / 举报 / 管理员审核台 / 作者主页 / 热度榜，形成质量飞轮。
- **内置 RAG 检索增强**：默认词法召回，可选开启 bge 语义向量 + RRF 混合召回 + cross-encoder 重排（联网首次下载模型即激活）。
- **生产级安全 + 韧性基线**：鉴权、SSRF 防护、CSP/XSS 收口、SQLite WAL、输入长度校验、速率限制、结构化日志、进程优雅退出、Docker、CI/CD、版本化 schema 迁移 + 备份、**LLM 指数退避重试 + 主备切换**、**可观测 metrics + 可选 Sentry**、**Prompt 版本锁定**，均已落地。
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
| F1 | 一句话生成模板（流式） | 指定行业 + 一句话 → AI 返回结构化模板草稿（实时逐字流式，可「停止生成」）→ 落入填表流程 |
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
| — | 发现 / 检索 | 行业 × 任务浏览、全文搜索、标签过滤、RAG 检索增强、热门预览 |
| — | 可观测 | 各 provider 成功率 / 延迟、生成成功率、RAG 命中率、主备切换（`/ops/metrics`） |
| — | 移动端适配 | 响应式布局，手机端可用 |

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
- **其他**：集中输入长度校验、内存固定窗口速率限制（全局 240/min、注册 5/h、relay 30/min）、结构化日志、进程优雅退出、Docker、CI/CD。

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
- 前端样式工程化：Tailwind 由运行时 CDN 改为**构建期编译**（PostCSS + autoprefixer 扫描 `index.html` + `src/**` 产出工具类 CSS），彻底去除 `cdn.tailwindcss.com` 运行时依赖；CSP 同步收紧（移除该域名白名单）。`index.html` 补齐 SEO 元信息（description / keywords / Open Graph / Twitter Card / JSON-LD `WebSite` 结构化数据）
- 社区冷启动 + SEO 落地：服务端 `seedCommunityIfEmpty()` **幂等**注入 8 个官方精选模板（小红书种草 / 代码评审 / 周报 / 教案 / 电商详情 / 理财 / 健康科普 / 合同审查，带真实热度与评分），填满社区 / 热度榜 / sitemap 空状态；`/sitemap` 始终含首页 / 社区 / 热度榜核心静态路由，模板页按真实 id 动态列出，保证可被搜索引擎收录
- 生成体验优化：首页生成结果入口由淡链接改为**醒目主按钮**「✨ 打开模板，生成你的提示词」，生成成功后自动滚动入屏；本页已生成过时再次点「生成模板」会**二次确认**，避免误建重复草稿

**后续改进方向（按优先级）**：

1. **公网就绪 Phase 2-4**：注册强防护（Turnstile 验证码 / 邮箱验证）、TLS 反代、备份定时化、DB↔LanceDB 一致性。
2. **模板资产化深化（差异化核心）**：模板组合 / 链式（composable）、引用关系图、跨模板复用与引用追踪。
3. **评测 → 优化闭环**：基于评测结果的自动优化循环（prompt auto-improve，结合 F9 跨模型对比择优）。
4. **社区发现 / SEO**：全文搜索增强、标签体系、作者主页完善（sitemap / OG 元信息已落地）。
5. **协作 / 团队共享库（可选）**、**跨工具嵌入（浏览器插件浮窗 / Coze，claw，可选）**。

---

## 许可证

许可证目标为 **MIT**（计划补充 `LICENSE` 文件）。当前默认保留所有权利，欢迎 Fork 学习；如需商用请先联系作者。
