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
| F12 | 模型清单实时同步 | 设置页 🔄 一键拉取各厂商在役模型（OpenAI / Claude / Gemini 三套协议），切换厂商自动刷新下拉；拉不到时回退 OpenRouter 公开聚合目录（无需 Key），再回退内置已校准清单。内置清单经 OpenRouter 实测校准，修 3 处会 400 的错误 ID（claude 点号 / grok-4.5 / deepseek-r1） |
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
| F26 | 引导页模型家族 + 首页试跑常驻（竞品监控 r11） | ① `#/guide` 增补「③ 主流模型家族：风格差异与最佳实践」（OpenAI / Claude / Gemini 三卡：快照锁版本、指令优先级、XML 结构化、多模态、长上下文等）+「生产纪律」callout（锁版本 / 建评测套件 / 提示缓存降本，呼应 F9/F10/F13），并重编号「④ 三步上手」；② 首页两个热门模块卡片加常驻 **🚀 试跑** 入口——「🌟 大家都在用」社区卡（`communityCard` 的 `rec` 分支新增 `cm-try`，复用 F20 `openPreviewModal`）、「🔥 热门模板」内置卡（`TEMPLATES` 按 `slug` 取完整模板后试跑），对标 Gemini 画廊「open in playground」首屏即点。纯前端、零 schema |
| F27 | 评分标度统一标注 + 社区行业×数量聚合（竞品监控 r12） | ① **评分双标度显式标注**（回应报告 #4 头号数据口径风险）：社区卡片与评分弹窗标注 `X.X/10`、热度榜与首页热门标注 `X.X/5`，消除 `community.list`(0–10) 与 `metrics/board`(0–5) 两套 `avgRating` 并排误读；② **社区页行业×数量聚合计数**（报告 #5，对标 Microsoft 11 工作类型计数）：复用首页 `renderIndustryDist` 在社区页新增 `#cm-ind-dist` 容器，按当前列表本地聚合「行业→条数」，点击跳行业落地页 `#/i/行业`。纯前端、零 schema |
| F28 | 一键优化进度反馈（用户实测痛点） | 针对「一键优化」哑等待痛点（点击后长时间无任何反馈、误以为模型挂了）：① `judge.ts` 给单样本内部的 3 步（实例化 / 调被测模型 / 裁判打分）加 **阶段回调 `onStage`**，`judgeSamples` 透传带 idx/total；② `optimize.ts` 弹窗新增 **阶段状态行**（`#opt-stage`：spinner + 当前阶段文字 + **已用时 mm:ss 计时器**）+ 全局阶段提示（评测原版 ▸ 改写 ▸ 复测）+ 启动时**预计耗时提示「1–4 分钟，请勿关闭」**；③ `optimizePrompt` 流式 `onToken` 实时显示「✍️ 改写中…（已生成 N 字）」。纯前端、零 schema，计时器与回调在 catch/finally 清理 |
| F29 | 裁判模型锁定当前 Key 厂商（用户实测痛点修正） | 一键优化的「裁判模型」**锁定为「设置」中当前 Key 所属厂商**（标签直接显示厂商名，不再提供全厂商自由选——因设置只存一份 provider+key，选别家会 Key 对不上无法调用）；模型下拉为该厂商模型列表，首选项「用当前设置的模型」（与被测同模型），可选「🔄 用当前 Key 拉取真实在役列表」。关键修正：`LLM.listModels` 新增 `allowFallback` 参数，裁判场景传 `false` **不再静默回退 OpenRouter 公开目录**（此前无 key/乱填也能拉到一批 `厂商/` 前缀型号却根本调不动，也掩盖了"一半厂商不支持拉取"的真相——其实有效 key 下绝大多数 OpenAI 兼容厂商都支持 `/models`）；**设置页拉取同步改为 `allowFallback=false`**（不再乱填 Key 即假成功，无效 Key 老实报"暂不支持/Key 无效"），仅 `#/models` 公开展示页保留默认 `true` 回退（无需用户 Key 即可展示真实在役型号）。另修复 `listModels` 响应解析只认 OpenAI `{data:[{id}]}` 形态的问题——补充兼容 **Together 顶层数组 / Perplexity `{models:[...]}` / 部分厂商 `{model_list:[...]}`**，使有效 Key 下这些厂商也能拉到真实型号（此前即便填真 Key 也因解析不到而误判"不支持"）；Ollama 本机免 Key 放行拉取。顺带修复隐性 bug：`resolveCfg` 在 `over.provider` 分支 key/secret 缺失时回退 `cfg()`，使同厂商指定裁判模型真正生效 |
| F30 | 优化闭环质量门 + 社区封面（竞品监控 r13） | ① **F13 优化闭环质量门**：`judge.ts` 裁判维度由 4 扩至 6——新增 `safety`（PII/注入/有害内容风险）与 `jsonValid`（JSON 合法）两维度（各 1-5），质量总分仍 0-20 不变、安全/JSON 作并列质量门信号；`optimize.ts` 结果卡动态展示 6 维 + **成本/延迟工程指标**（单样本平均 token 与耗时，取自 `LLM.chatWithPrompt` 的 `usage`/`elapsedMs`，零服务端依赖），对标 Opik/Braintrust 让优化采纳更可靠、抗违规输出。② **社区封面填充**：后端 `COMMUNITY_SEED` 注入内联 SVG 行业封面（`data:image` 无外链、防 XSS、视觉差异化），并对已存在空封面记录自动补填，列表不再千篇一律占位图。纯前端/零 schema |
| F31 | 作者主页聚合 + 社区版本徽标（竞品监控 r14） | ① **作者主页强化**（报告 #4）：后端 `listCommunityByAuthor` 改为返回聚合 `totals`（总 uses / 总 favorites / 入驻时间 `joinedAt`），前端 `author.ts` 新增统计卡（总使用/总收藏/模板数）+ 入驻日期，对标 ProBazaar 作者主页留存。② **社区版本徽标**（报告 #7）：`community` 表新增 `version` 列（**v7 迁移** `ALTER TABLE` + 全量回填 `v1.0`，幂等），种子与既有发布统一首发版本；`communityCard` 与详情页头部加 `pill-version` 青色徽标，传递"持续更新"信号，对标 ProBazaar v3.0。轻量 schema（单列）+ 前端展示，构建产物 `index-CDX4D9j9.js` |
| F32 | 设计系统重做·东方墨韵（Impeccable 视觉升级） | 应"页面太丑"反馈，用 **Impeccable 前端设计 skill** 把整体视觉从「AI 紫蓝」改为**东方墨韵·编辑感**浅色风：`:root` 令牌整组重定向（宣纸暖底 `#f5f0e3` / 墨字 `#1d1812` / 朱砂红 `#b5362a` / 描金 `#b8893f` / 衬线 `--font-display` 系统宋体栈，无外部字体依赖、满足隐私与离线）＋ 组件类（按钮 / 卡片 / 胶囊 / Hero / 价值点 / 步骤 / 行业宫格 / 社区卡 / 代码框 / Toast 等）重写去紫蓝渐变与冷灰＋ 全站硬编码紫 / 冷灰 hex 清理（home / community / detail / models / guide / auth / ui / settings / traces 共 11 处）＋ 社区封面占位图改为赭 / 竹青 / 酱褐 / 青碧 / 墨灰大地色梯度。保留全部 CSS 变量名、仅重定向其值，所有页面自动换肤；设计上下文落 `.impeccable.md`。构建产物 `index-CK6Yo-jI.js` |
| F33 | 模板卡片封面化 + 网格/分区/Hero/顶栏搜索重做（回应"只改了颜色"） | 在 F32 换肤基础上做**真正的组件与结构重做**，对齐 PromptHero/FlowGPT 的「封面+信息」卡片范式：① **模板卡片加行业封面 banner**（复用社区 `INDUSTRY_PH` 大地色梯度 + 行业 emoji + 衬线水印，home `card()` / 热门卡 / 行业页统一带封面的 `tpl-card--cover`），与社区卡视觉一致；② **模板网格改 `auto-fill minmax(280px)` + 18px 间距**（`tpl-grid`，取代 `grid sm:grid-cols-2 gap-3`）；③ **分区标题加朱砂竖条 accent**（`section-title::before`）；④ **Hero 放大留白**（标题 2.35rem、内边距/圆角加大、生成栏控件加高）；⑤ **顶栏加搜索框**（FlowGPT 式搜索优先，`nav-search`，提交跳社区并预填 `window.__headerSearch`）。`communityCard` 导出 `industryPh` 供首页复用。**补刀轮（回应"社区卡还是好丑"）**：`communityCard` 整体重写为与模板卡同一套 `tpl-card--cover` 视觉——统一封面（`iconFor` 行业 emoji + `.tpl-cover-name` 行业水印；真实 `r.cover` 图铺满 `.tpl-cover-img`）、单个官方/社区徽标（去掉原先「官方/社区 + 行业 + 版本」三种尺寸混排的椭圆）、作者·评分·相对时间合成一行元信息、一行统计（`🔥 次数 · ⭐ 收藏`），home 卡去掉独占整行的超长「试跑」改为「🚀 试跑 + 🍴 派生」紧凑双按钮。验证：`tsc` 0 错、`vite build` 31 模块（产物 `index-BteaN4fY.js` / `index-BFdiB7H4.css`） |
| F34 | 种子提示词内容升级 + 示例模板库去重修复 | 用户反馈种子太简单、比不过示例模板；排查发现**示例模板库（templates.ts，102 个）系统性生成 bug**：每个 prompt 的「输出规范」之后整段被复制一遍（`# 输出规范`/`# 边界与兜底` 各出现 2 次）。双线修复：① **8 个官方种子升级为生产级骨架**——统一七段结构 + 新增「# 示例（输入→输出）」具体范例（小红书/代码评审/周报/教案/详情页/理财/科普/合同审查），正文字数翻倍（如小红书 ~600→1128）；种子抽到独立文件 `site/server/src/seedCommunity.ts`，`db.ts` 的 `seedCommunityIfEmpty` 在「已存在」分支同步刷新官方种子正文/标签/备注，已入库旧种子经一次性脚本写入 `data/app.db` 即时生效（后端每次请求实时读库）。② **模板库去重**——`scripts/fix_template_dup.mjs` 按「保留首个头段 + 第二个输出规范 + 首个边界/兜底」规则重写全部 102 个 prompt，修复前只读分析 0 异常、修复后校验 0 异常（每模板精确 7 段）；源文件各 section 现均 102 次、构建 JS 该标记从 204→105（102 模板 + 3 处其它合法七段）。`templates.ts` 经 `tsc` 0 错 + `vite build`，预览 4173 返回新构建（产物 `index-BKAscCul.js`）。 |
| F35 | 社区分享到多平台 + 模板难度/适配元数据（竞品监控 r15） | ① 社区卡片与详情页新增「📤 分享」按钮，纯前端把提示词预填到 ChatGPT / Claude / Gemini / Perplexity / 豆包 / Kimi / 元宝 / Copilot 的新对话 URL；超长提示词自动降级为「复制原文 + 打开首页」；② `community` 表 v8 迁移新增 `difficulty`（入门/进阶/专家）与 `recommend_model` 列，官方 8 条种子补全难度与推荐模型；卡片与详情页展示三级难度徽标与「🎯 适配：X级 · 推荐 Y」元信息。③ 根据用户实测反馈修复分享复制提示：非预填平台（Kimi/元宝）/ 超长文本会自动复制原文，并弹出 6s 长 toast 明确提示「去 X 页面按 Ctrl+V 粘贴」，避免原弹层 700ms 关闭导致用户不知道已复制。 |
| F36 | 社区量级背书条（竞品监控 r16 #3） | 社区广场头部新增「📣 社区数据 · 真实量级」背书条，复用已有 `/metrics/summary` 端点，纯前端展示全站公开提示词数、累计使用数、累计收藏数与创作者数（数字过万自动压缩为 X万），以「社会证明」降低新访客对「社区是否活跃」的信任成本。东方墨韵视觉：暖底卡片 + 朱砂数字 + 宋体 + 分隔线 + 说明行。零 schema、零后端改动。 |
| F37 | 我的模板标签筛选（竞品监控 r17 #3） | 「我的模板」页新增标签云筛选：按当前本地库全部模板的标签频率排序展示（Top30），点击任一 `#标签` 即按该标签过滤分组列表，再点一次或点「✕ 清除筛选」复原；选中态高亮（朱砂填充）。复用社区页同款 `.cm-tagcloud`/`.cm-tag` 东方墨韵样式。纯前端零 schema，降低个人库随模板增多后的查找成本。 |
| F38 | 发送前实时评分入口（竞品监控 r17 #2） | 详情页新增「⚖️ 评一下」入口：编辑态可评模板骨架，生成结果区可评成品提示词。新增 `core/judge.ts` 的 `judgePromptText()` 直接对提示词文本本身按 6 维（清晰度 / 结构 / 可用性 / 具体性 / 安全合规 / JSON 合规）打分，0–100 映射 + 维度条形 + 一句改进建议；无 Key 时友好提示去设置页。东方墨韵弹层：暖底卡片 + 朱砂大分数 + 6 维条形 + 💡 建议。复用 F13 的 JudgeDims/JSON 解析，零后端改动。 |
| F39 | 编辑器一键增强入口（竞品监控 r19 #7） | 详情页编辑 态新增「✨ 增强」按钮，复用 F13 优化闭环对模板骨架做「自动评测→改写→对比」；优化版经新增的 `openOptimizeModal(t, onApply)` 回调写回编辑框，并 `Store.addMine` 落 F10 版本，用户可在「历史版本」做 before/after 对比。与 F38 评分入口衔接，形成编辑器内「⚖️ 评一下 → ✨ 增强」闭环。原 `opt-btn`（生成结果区）/ 社区卡片「🔧 优化」走默认 `Store.addMine` 行为，不受影响。纯前端零 schema，构建产物 `index-CwqBwkzt.js`。 |
| F40 | 卡片「已验证」信任标签（竞品监控 r20 #2） | 对标 PromptMart「认证卖家 + 已测模型」信任锚。社区卡片（`community.ts` cardHtml）新增 `.cm-trust` 信任徽章：基于 `recommendModel` 生成「🎯 已测 X」徽章（取前 2 个模型）、评分文案改为显式「★ X.X · N 人评分」（原括号隐写 `(N)` 改为显式）；社区详情页（`communityDetail`）复用同一套 `.trust-badge` 承载「✓ 官方认证 / ✓ 已认证作者 + 🎯 已测 X + ★ 评分」；内置/我的模板详情（`detail.ts`）同样加「✓ 官方认证 + 🎯 已测 + ★ 评分」。三处一致，纯前端零 schema。样式 `.trust-badge`（东方墨韵浅色：墨绿已认证 / 描金已测 / 朱砂评分）。 |
| F41 | 评分标度统一（竞品监控 r18#5 / r19#4） | 修复历史遗留的双标度混乱：用户评分 UI 为 5 星（1–5），但种子数据原本按 10 分制灌入 `ratingSum`，导致社区详情错误显示「/10」、出现「8.4/5」超满分值。① 前端所有评分展示统一为 `/5`（社区卡片 / 社区详情 / 内置·我的详情信任徽章），消除 `/10` 与 `/5` 混用；② `seedCommunity.ts` 8 条官方种子 `ratingSum` 由 10 分制换算为 5 分制（减半）；③ `db.ts` 的 `seedCommunityIfEmpty` 刷新分支新增 `rating_sum/rating_count` 覆盖（仅 `author='模法师官方'` 且尚未产生真实用户评分时），重启后端即全量刷新。前后端 `tsc` 0 错、`vite build` 31 模块（产物 `index-PKyxEH-p.js`）。 |
| F42 | 社区模板中心筛选补全（竞品监控 r21 #4） | 对标 Coze「行业×难度×模型」填空式模板中心发现层。社区页在已有搜索框 + 行业下拉 + 排序基础上，新增「难度（入门/进阶/专家）」与「推荐模型」两个筛选维度：模型下拉在 `load()` 内基于当前结果集 `recommendModel` 动态去重提取（如 Claude/GPT-4o/Kimi/通义千问/Gemini），难度与模型均走前端本地过滤（拿到全量 `rows` 后派生 `viewRows`，渲染/聚合/统计/标签云全部基于 `viewRows`），无匹配时显示「没有符合当前筛选条件的提示词」友好提示。纯前端零 schema，复用既有 `difficulty`/`recommendModel` 字段。 |

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
- 引导页模型家族 + 首页试跑常驻（竞品监控报告 r11）：本轮报告**已正确基于 `:8000` API JSON + 源码**做"自身现状"分析（昨日修改自动化 prompt 生效），未再误判社会证明等项。真正落地 ① `#/guide` 增补「③ 主流模型家族：风格差异与最佳实践」（OpenAI/Claude/Gemini 三卡 + 生产纪律 callout：锁版本/评测套件/提示缓存降本，呼应 F9/F10/F13）并重编号「④ 三步上手」② 首页两个热门模块卡片加常驻 **🚀 试跑**——「🌟 大家都在用」社区卡（`communityCard` 的 `rec` 分支新增 `cm-try`，复用 F20 `openPreviewModal`）、「🔥 热门模板」内置卡（`TEMPLATES` 按 `slug` 取完整模板后试跑），对标 Gemini 画廊「open in playground」首屏即点。本轮**主动剔除了报告 #7 的"密钥加密存储"表述**——代码核查确认 `Store.saveSettings` 实为明文 `localStorage`，直接写"加密"是虚假文案，故保持现有诚实措辞（"只存本机、不上传"）而非造假；若需真实加密可作为独立中难度任务。r11 其余建议——#1 多模态模板品类（中）、#3 F13 数据集驱动可复现（中）、#4 版本对比叠加每版成本（需捕获成本数据，中）、#5 编辑器内 AI 增量改写（中）——经评估暂不在当前迭代范围

- 评分标度统一标注 + 社区行业×数量聚合（竞品监控报告 r12）：本轮报告"自身现状"分析正确（基于 :8000 API JSON + 源码实测）。真正落地 ① **评分双标度显式标注**（报告 #4 头号数据口径风险）：社区卡片与评分弹窗标注 `X.X/10`、热度榜与首页热门标注 `X.X/5`，消除 `community.list`(0–10) 与 `metrics/board`(0–5) 两套 `avgRating` 并排误读，纯展示层修复；② **社区页行业×数量聚合计数**（报告 #5，对标 Microsoft 11 工作类型计数）：复用首页 `renderIndustryDist` 在社区页新增 `#cm-ind-dist` 容器，按当前列表本地聚合"行业→条数"，点击跳行业落地页 `#/i/行业`。封面占位图此前已就绪（`cover` 为 null 时降级行业渐变首字母图），仅种子数据未填 cover 属后端 seed 范畴，本轮不碰以免动 schema。r12 其余高/中优先级建议——#1 F13 数据集驱动可复现评测（架构级，3–4 天）、#2 UGC 冷启动（运营为主）、#3 封面填充（前端占位已就绪、仅种子未填）、#6 Deploy 只读 API（架构级）、#7 发布前质量门 + A/B（架构级）、#8 多模态品类（中）、#9 prompt registry 元数据（低）、#10 F13 安全维度（低）——经评估暂不在当前迭代范围，部分依赖公网真实用户或后端 schema 扩展
- 一键优化进度反馈（F28，用户实测痛点）：用户上手实测反馈「一键优化」点完后长时间无任何反馈、只能看计数从 0→1→2 缓慢变化、0→1 之间完全空白、以为模型挂了。根因（`judge.ts` / `optimize.ts` 源码核查）：F13 优化全在浏览器用用户 Key 直连 LLM 跑、后端零参与；`judgeSamples` 串行跑 N 样本、每样本内部是「实例化→调被测模型→裁判」3 次顺序 LLM 调用，但进度回调只在**整样本完成后**才触发一次，单样本内部 20–75 秒无任何提示。修复（纯前端零 schema）：① `judge.ts` 给单样本 3 步加 **阶段回调 `onStage`**、`judgeSamples` 透传带 idx/total；② `optimize.ts` 弹窗新增 **阶段状态行**（`#opt-stage`：spinner + 当前第几个样本哪一步 + **已用时 mm:ss 计时器**，计时器走动即证明未卡死）+ 全局阶段提示（评测原版 ▸ 改写 ▸ 复测）+ 启动即显示**预计耗时「1–4 分钟，请勿关闭弹窗」**；③ `optimizePrompt` 流式 `onToken` 实时显示「✍️ 改写中…（已生成 N 字）」。计时器与所有回调在 `catch/finally` 清理。运行时交互需用户在浏览器实际点击验证（dev server 在跑，刷新即可见）

- 裁判模型锁定当前 Key 厂商（F29 修正，用户实测痛点）：用户实测指出三连问题——① 接近一半厂商"不支持拉取现役模型"；② 拉取不需要 Key（乱填也能拉到）；③ 裁判模型应能选的应是当前 Key 对应厂商，否则 Key 对不上无法调用。根因（`llm.ts` `listModels` / `OR_FALLBACK` 源码核查）：`OR_FALLBACK` 仅覆盖 9/19 家（openai/deepseek/moonshot/qwen/hunyuan/grok/mistral/claude/gemini），其余 10 家（zhipu/doubao/baichuan/yi/ollama/openrouter/groq/perplexity/together/ernie）无回退、且厂商自身 `/models` 在**无有效 Key 时返回 401** → 静默回退到 **OpenRouter 公开目录**（无需 Key），于是"乱填也能拉取"且那 10 家显示"不支持"；其实有效 Key 下绝大多数 OpenAI 兼容厂商都支持 `/models`。修复（纯前端零 schema）：① `llm.ts` `listModels` 新增第 4 参数 `allowFallback`（默认 `true`，保持 `#/models` 公开页与 settings 页行为不变），裁判场景传 `false` 关闭 OpenRouter 回退，避免列出无对应 Key 不可用的型号；② `optimize.ts` 裁判下拉**删除自由厂商 picker、锁定 `settings.provider`**（标签显示当前厂商名），模型下拉用真实 `settings.key` 拉取（`allowFallback:false`），无 Key/失败回退内置清单，首选项"用当前设置的模型"；打开弹窗即用真实 Key 拉取。

- 设置页拉取模型同样不需 Key 的假成功 + 多厂商解析失败修正（F29 延续，用户实测痛点）：用户指出设置页「🔄 拉取真实列表」乱填也报"成功拉取在役模型"、且智谱/豆包/百川/零一/ollama/groq/perplexity/together/文心等大量厂商拉不到。根因（`settings.ts` `refreshModels` / `llm.ts` `listModels` 源码核查）：① 设置页 🔄 仅校验 Key **非空**不校验**正确**，乱填非空串通过 `!k` 校验 → 对 OR_FALLBACK 那 9 家走 OpenRouter 回退假成功，对另 10 家（无回退）显示"暂不支持"；② **更严重**：`listModels` 响应解析只认 OpenAI `{data:[{id}]}` 形态，而 **Together 返回顶层数组**、**Perplexity 返回 `{models:[{id}]}`**——即便填真 Key 也解析不到 → 误判"不支持"。修复（纯前端零 schema）：① `listModels` 响应解析改为兼容多种形态（`{data}` / 顶层数组 / `{models}` / `{model_list}`，取 `id||name||model`），有效 Key 下 together/perplexity 等现在真能拉到；② `refreshModels` 传 `allowFallback=false` → 不再用 OpenRouter 假成功，无效 Key 老实报"Key 可能无效或该厂商不支持 /models"；③ Ollama 本机免 Key 放行拉取（其余厂商仍要求填 Key）。`#/models` 公开展示页保持默认 `allowFallback=true`（无需用户 Key 展示真实在役型号，回退合理）。

- 优化闭环质量门 + 社区封面填充（竞品监控报告 r13）：本轮报告聚焦 prompt registry/版本治理/评测治理，10 条建议中 #5 统一评分标度（r12 已选显式标注路线）、#8 F2 Live Preview（F3 填表已实时预览）、#9 行业×数量计数（r12 已落地 `#cm-ind-dist`）实际已被覆盖，#4 发布门禁/#6 热度打通/#7 Consume API+MCP/#10 多模态属架构或后端级留评估。真正落地 ① **F13 优化闭环质量门**：`judge.ts` 裁判维度 4→6（新增 `safety` PII/注入风险、`jsonValid` JSON 合法），`optimize.ts` 动态展示 6 维并采集 `usage`/`elapsedMs` 呈「单样本平均 token / 耗时」成本延迟指标；② **社区封面填充**（回应 r12 #3）：`db.ts` `COMMUNITY_SEED` 注入 8 个行业内联 SVG 封面（无外链、防 XSS），并对已存在空封面记录自动补填。验证：前端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-88-UrUGm.js` 含 6 维与 `avgTokens`/`avgLatencyMs` 接线）；后端 `tsc` 0 错。需重启后端使 seed 封面生效。

- 作者主页聚合 + 社区版本徽标（竞品监控报告 r14，新角度=团队协作+创作者经济+运行/分享化）：报告 8 条建议先经**源码逐条核对**避免误判——#1 UGC 冷启动（投稿链路代码已存在，`publishCommunity` 绑定 `author_id`、`author.ts`/`drafts` 已支持，8 条 `authorId` 全 null 仅因都是官方种子、无真人投稿，属产品/运营问题非代码缺口，跳过）、#2 创作者榜（零 schema 可算，但当前仅 1 个官方创作者、即时价值低，缓做）、#3 克隆即运行+分享结果（F20/F21 试跑已落地，但产出未持久化、需轻量新表+分享页，偏重留排期）、#5 垂直行业落地页（依赖公网流量，缓做）、#6 可嵌入小组件（依赖流量+防 XSS，缓做）、#8 统一评分标度（双标度确存 community `/10` vs board `/5`，F27 已标注，低紧急缓做）。真正落地 ① **作者主页强化**（#4）：后端 `listCommunityByAuthor` 改返回聚合 `totals`（总 uses/总 favorites/入驻时间 `joinedAt`），前端 `author.ts` 新增统计卡（总使用/总收藏/模板数）+ 入驻日期，对标 ProBazaar 作者主页留存；② **社区版本徽标**（#7）：`community` 表加 `version` 列（**v7 迁移** `ALTER TABLE` + 全量回填 `v1.0` 幂等），`communityCard` 与详情页头部加 `pill-version` 青色徽标，对标 ProBazaar v3.0。验证：前端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-CDX4D9j9.js`）、后端 `tsc` 0 错；启动后端实测 `/community/list` 8 条 `version` 全 `v1.0`、`/community/author` 返回新 `totals` 结构、`/community/detail` 含 `version`。
- 设计系统重做·东方墨韵（Impeccable 视觉升级，回应"页面太丑"）：用 **Impeccable 前端设计 skill** 把整体视觉从「AI 紫蓝渐变 + 冷灰」改为**东方墨韵·编辑感**浅色风——`:root` 令牌整组重定向（宣纸暖底 `#f5f0e3` / 墨字 `#1d1812` / 朱砂红主强调 `#b5362a` / 描金次强调 `#b8893f` / 衬线标题 `--font-display` 系统宋体栈，**无外部字体依赖**、满足隐私与离线约束）＋ 组件类（按钮 / 卡片 / 胶囊 / Hero / 价值点 / 步骤 / 行业宫格 / 社区卡 / 代码框 / Toast 等）重写去紫蓝渐变与冷灰＋ 全站硬编码紫 / 冷灰 hex 清理（home / community / detail / models / guide / auth / ui / settings / traces 共 11 处）＋ 社区封面占位图改为赭 / 竹青 / 酱褐 / 青碧 / 墨灰低饱和大地色梯度。保留全部 CSS 变量名、仅重定向其值，所有页面自动换肤。设计上下文落 `.impeccable.md`。验证：前端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-CK6Yo-jI.js` / `index-BeMOYKku.css`）。
- 模板卡片封面化 + 网格/分区/Hero/顶栏搜索重做（F33，回应"只改了颜色"）：在 F32 换肤基础上做**真正的组件与结构重做**，对齐 PromptHero/FlowGPT 的「封面+信息」卡片范式——① 模板卡片加行业封面 banner（复用社区 `INDUSTRY_PH` 大地色梯度 + 行业 emoji + 衬线水印，`home.card()`/热门卡/行业页统一 `tpl-card--cover`，与社区卡视觉一致）；② 模板网格改 `auto-fill minmax(280px)` + 18px 间距（`tpl-grid`，取代 `grid sm:grid-cols-2 gap-3`）；③ 分区标题加朱砂竖条 accent（`section-title::before`）；④ Hero 放大留白（标题 2.35rem、内边距/圆角加大、生成栏控件加高）；⑤ 顶栏加搜索框（FlowGPT 式搜索优先，`nav-search`，提交跳社区并预填 `window.__headerSearch`）。`communityCard` 导出 `industryPh` 供首页复用。**补刀轮（回应"社区卡还是好丑"）**：`communityCard` 整体重写为与模板卡同一套 `tpl-card--cover` 视觉——统一封面（`iconFor` 行业 emoji + 行业水印；真实封面图铺满）、单个官方/社区徽标（去掉原先三种尺寸混排的椭圆）、作者·评分·时间合成一行、一行统计；home 卡把独占整行的超长「试跑」改为「🚀 试跑 + 🍴 派生」紧凑双按钮。验证：前端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-BteaN4fY.js` / `index-BFdiB7H4.css`）。
- 种子提示词内容升级 + 示例模板库去重修复（F34）：用户反馈种子太简单、比不过示例模板；排查发现**示例模板库（templates.ts，102 个）本身有系统性生成 bug**——每个 prompt 的「输出规范」之后整段被复制一遍（`# 输出规范`/`# 边界与兜底` 各出现 2 次）。双线修复：① 8 个官方种子升级为生产级骨架（统一七段 + 新增「# 示例（输入→输出）」具体范例，正文字数翻倍），抽到 `site/server/src/seedCommunity.ts`，`db.ts.seedCommunityIfEmpty` 在「已存在」分支同步刷新官方种子正文/标签/备注，已入库旧种子经一次性脚本写入 `data/app.db` 即时生效；② 模板库去重（`scripts/fix_template_dup.mjs`，修复前只读分析 0 异常、修复后校验 0 异常，每模板精确 7 段），源文件各 section 现均 102 次、构建 JS 该标记从 204→105。验证：前后端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-BKAscCul.js` / `index-BFdiB7H4.css`），预览 4173 返回新构建。
- 社区分享到多平台 + 模板难度/适配元数据（竞品监控报告 r15 #2/#3，F35）：① 社区卡片与详情页新增「📤 分享」按钮，纯前端生成 8 个外部 AI 平台（ChatGPT / Claude / Gemini / Perplexity / 豆包 / Kimi / 元宝 / Copilot）预填提示词的 URL，超长提示词自动降级为「复制原文 + 打开首页」；② `community` 表 **v8 迁移**新增 `difficulty`（入门/进阶/专家）与 `recommend_model` 列，官方 8 条种子补全难度与推荐模型；卡片与详情页展示三级难度徽标（绿/金/朱砂）与「🎯 适配：X级 · 推荐 Y」元信息。③ 修复分享弹层在 hash 路由切换后残留的边界情况。④ 根据用户实测反馈修复分享复制提示：非预填平台（Kimi/元宝）/ 超长文本会自动复制原文，并弹出 6s 长 toast 明确提示「去 X 页面按 Ctrl+V 粘贴」，避免原弹层 700ms 关闭导致用户不知道已复制。验证：后端 v8 迁移生效，`/community/list` 返回 8 条 difficulty / recommendModel；Playwright 验证 Kimi 非预填 + Claude 长文本降级两条路径均正确复制并显示长 toast；前后端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-CbJ8XHlJ.js` / `index-KsXnvjIj.css`）。
- 社区量级背书条（竞品监控报告 r16 #3，F36）：报告 r16 分析「新访客可能因社区规模小而不信任」，落地 ① 社区广场头部新增「📣 社区数据 · 真实量级」背书条，复用已有 `GET /metrics/summary` 端点，纯前端零 schema 展示 `communityPublished` / `totalUses` / `totalFavorites` / `creators`，数字过万自动压缩为 `X万`；② 东方墨韵视觉：暖底卡片（`#fbf6ec→#f5eedd`）+ 朱砂数字（`var(--brand-700)`）+ 衬线 `--font-display` + 分隔线 + 说明行；③ 注入点在 `section-title` 下方 / tab 行上方，避免干扰原有筛选操作。验证：Playwright 截图确认社区页显示「8 公开提示词 / 10.0万 累计使用 / 2.0万 累计收藏 / 来自 1 位创作者」且无 console 错误；前后端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-BwNjwLjh.js` / `index-6OkbJjAA.css`）。
- 我的模板标签筛选（竞品监控报告 r17 #3，F37）：报告 r17 监控「提示词优化器工具 + 创作者经济货币化 + 中文教育落地」，自身现状核对确认 `views/my.ts` 仅有行业分组、无标签筛选维度。落地：① 「我的模板」页新增 `#my-tags` 标签云，按当前本地库全部模板的标签频率排序展示（Top30，带计数）；② 点击任一 `#标签` 即按该标签过滤分组列表，再点一次或点「✕ 清除筛选」复原，筛选态头部显示「已筛选标签 #X，共 N 个模板」；选中标签朱砂填充高亮；③ 复用社区页同款 `.cm-tagcloud`/`.cm-tag`（新增 `.cm-tag.active`/`.cm-tag-clear` 东方墨韵样式）。删除/发布按钮的绑定改到 `renderBody` 内层，随筛选重渲染自动绑定。验证：Playwright 注入 6 条带标签模板，确认标签云 11 个标签计数正确（#文案 2 / #电商 2 / 其余 1），点击 #文案正确过滤出 2 条电商模板，无 console 错误；前后端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-CgDgl_LY.js` / `index-Cw8OqSMA.css`）。

- 发送前实时评分入口（竞品监控报告 r17 #2，F38）：报告 r17 将「对标 Velocity live scoring」列为高价值项，源码核对确认现有 `core/judge.ts` 的 `judgeSample` 评的是「被测模型输出」（需实例化 + 跑模型 + 裁判两次调用），不能直接用。落地：① `judge.ts` 新增 `judgePromptText(promptText, meta)` —— 直接评价「提示词文本本身」，一次 LLM 调用，按清晰度 / 结构 / 可用性 / 具体性 / 安全合规 / JSON 合规 6 维打分，`total` 取前四质量维之和 0–20 并映射为 0–100；② `views/detail.ts` 新增两个入口：编辑态「⚖️ 评一下骨架」评当前骨架、生成结果区「⚖️ 评一下」评成品提示词（`ctx.current._lastPrompt`），两者共用 `scoreCurrentPrompt()` + `openScoreModal()`；③ 弹层东方墨韵：暖底卡片 + 朱砂大分数 + `优/良/中/待改进` 徽标 + 6 维进度条 + 💡 裁判建议；④ 无 Key 时 try/catch 捕获 `LLM.chatWithPrompt` 的「未配置 API Key」错误，弹层提示「请先到「设置」页填写 API Key」，避免静默失败。验证：Playwright 拦截 `/relay` 与直连 `chat/completions` 返回 mock SSE，验证编辑态评分弹层正确显示 `80/100 优`、6 维条形与建议；无 Key 路径正确显示设置页引导；前后端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-DYaRF6UO.js` / `index-D9YKF3ji.css`）。
- 编辑器一键增强入口（竞品监控报告 r19 #7，F39）：报告 r19 监控「提示词评测可信度 / 信任信号」，将「编辑器内一键增强入口（对标 Promptaa + F13）」列为中优先级；源码核对确认 F13 优化闭环入口在社区卡片（🔧优化）与生成结果区（🔧一键优化），但编辑态内没有增强按钮。落地：① `views/detail.ts` 编辑态按钮行新增「✨ 增强」（与 F38「⚖️ 评一下骨架」并列）；② `openOptimizeModal(t, onApply?)` 新增可选 `onApply` 回调——编辑态增强时，优化版应用后回调把 `rec.prompt` 写回 `#ed-prompt` 编辑框、`Store.addMine` 存为新版本（before/after 可在「历史版本」回滚）；不传 `onApply` 时保持原行为（直接存版并关闭）。与 F38 评分入口形成「评分→增强」编辑器工作流。验证：Playwright 注入「我的模板」后进入编辑态，确认 `✨ 增强` 按钮可见、点击打开 F13 优化弹窗（`🔧 一键优化（F13 · 自动评测→改写→对比）`）；前后端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-CwqBwkzt.js`）；F13 实际跑模型需真 Key，留手动验证。
- 卡片「已验证」信任标签（竞品监控报告 r20 #2，F40）：报告 r20 聚焦创作者声誉 / 榜单 + 信任信号（PromptMart「认证卖家 + 已测模型」），源码核对确认社区卡片评分是隐写 `(N)`、缺信任锚。落地：① `community.ts` 卡片（`cardHtml`）新增 `.cm-trust` 信任区——基于 `recommendModel` 取前 2 模型渲染「🎯 已测 X」徽章，评分文案改为显式「★ X.X · N 人评分」；② `community.ts` 社区详情（`communityDetail`）复用同一套 `.trust-badge` 承载「✓ 官方认证 / ✓ 已认证作者 + 🎯 已测 X + ★ 评分」，并把原「🎯 适配：X级 · 推荐 X」收敛为「🎯 适配：X级」（模型信息并入徽章，避免重复）；③ `detail.ts` 内置/我的模板详情也加「✓ 官方认证 + 🎯 已测 + ★ 评分」保持一致。新增样式 `.trust-badge`（墨绿/描金/朱砂三态，东方墨韵浅色）。验证：Playwright 访问 `#/community` 与 `#/c/seed-code-review`，断言卡片与详情页均含「已测 / 人评分 / 官方认证 / trust-badge」；前后端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-DmR-D4TR.js` / `index-Dze9aLZ7.css`）。
- 评分标度统一（竞品监控报告 r18#5 / r19#4，F41）：报告将「双标度 / 标度统一」反复列为未根治项。源码核对发现并非「双标度设计」，而是种子数据按 10 分制灌入 `ratingSum`、而用户评分 UI 是 5 星（1–5），两者混在同一 `avgRating` 字段，导致社区详情错误显示「/10」、出现「8.4/5」超满分。落地：① 前端所有评分展示统一为 `/5`（社区卡片 `community.ts`、社区详情 `community.ts`、内置·我的详情 `detail.ts` 信任徽章），消除 `/10` 与 `/5` 混用；② `seedCommunity.ts` 8 条官方种子 `ratingSum` 由 10 分制换算为 5 分制（减半），使 `avgRating` 落在 4.x/5 的合理区间；③ `db.ts` 的 `seedCommunityIfEmpty` 刷新分支新增 `rating_sum/rating_count` 覆盖（仅 `author='模法师官方'` 且该行 `rating_count` 尚未超过种子基线），重启后端即全量刷新既有库。验证：Playwright 确认社区卡片与详情页均显示 `/5`、无 `/10`；后端重启后 `seed-code-review` 均分由 8.4/5 修正为 4.2/5；前后端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-PKyxEH-p.js`）。
- 社区模板中心筛选补全（竞品监控报告 r21 #4，F42）：报告 r21 角度=「提示词→可运行应用/Bot/智能体商店」市场形态，竞品 Coze 以「行业×难度×模型」填空式模板中心作为发现层。源码核对确认社区页已有搜索框 + 行业下拉 + 排序 + 行业聚合 + 标签云，但缺「难度」与「模型」两个筛选维度。落地：① 筛选栏新增 `#cm-diff`（入门/进阶/专家）与 `#cm-model` 两个 `<select>`；② `load()` 内先基于当前结果集 `recommendModel` 动态去重提取模型 token 填充 `#cm-model` 选项（保留当前选中值），再对全量 `rows` 前端过滤为 `viewRows`（难度精确匹配、`recommendModel` 按 `/`/`,` 切分包含匹配）；③ 卡片渲染、行业聚合、标签云、统计行全部改用 `viewRows`，无匹配时显示「没有符合当前筛选条件的提示词」友好提示。纯前端零 schema，复用既有 `difficulty`/`recommendModel` 字段。验证：Playwright 访问 `#/community` 确认 `#cm-model` 动态填充 6 个模型（Claude/GPT-4o/Kimi/通义千问/Gemini）；选「专家」卡片 8→1、选「Claude」8→7 且卡片确含该模型；专家+Kimi 组合卡片=0 并正确显示空提示；无控制台报错；前后端 `tsc` 0 错、`vite build` 31 模块成功（产物 `index-BtMfGmu1.js`）。

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
