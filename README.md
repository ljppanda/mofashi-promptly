# 模法师 · Promptly

> 纯本地、零账号的提示词模板生成与优化工具。

把「写好一段提示词」升级为「沉淀可复用的提示词模板资产」：先由 AI 生成带 `{{占位符}}` 的结构化模板骨架（F1），再按你的目标实例化为可直接使用的成品提示词（F2）。内置 102 个带可填变量的结构化模板作为 RAG 知识库，生成时自动检索相似范例作参考。

定位是**高质量的个人产品**：只服务本人、按产品级标准打磨，不追求用户量；因此「高质量」是减法而非加法——把已有链路磨到没有毛刺，而不是堆功能。取舍判据、可判定基线与收敛后的迭代路线见 [ADR 0001 · 产品定位](docs/adr/0001-product-positioning.md)，设计文档见 [docs/system_design.md](docs/system_design.md) 与 [docs/dashboard_design.md](docs/dashboard_design.md)。

## 功能特性

- **两阶段范式 F1 → F2**：模板骨架（可复用、可参数化）与成品实例分离，模板可反复复用、组合、版本化。
- **一键优化闭环（带留出集）**：对模板采样测试目标 → 实例化 → 跑模型 → 多维打分 → 低于阈值自动改写；改写依据只来自调参集，涨分以留出集为准，两者方向不一致时提示过拟合。
- **本地模板库 + RAG 知识库**：首页按行业浏览 102 个内置生产级模板，生成时自动检索相似范例作 few-shot 参考。
- **导入 / 导出闭环**：支持模板 JSON / OpenAI 消息 JSON 导入，载入详情页可继续编辑与「增强」；导出支持成品 / Markdown / 纯文本 / 模板 JSON。
- **在线试跑**：在详情页直接用你的 Key 试跑模板，即时验证效果。
- **实时思考时间线**：生成 / 代写时实时展示 Agent 状态机流程与模型思维链（捕获 Qwen3 / DeepSeek / Claude thinking 等推理 token），长任务也能看清「正在想什么」，不再误以为卡住。
- **按流程统计 token 用量**：可选开启 LangSmith 追踪，13 条流程（生成 / 实例化 / 试跑 / 评测 / 优化 / 增强等）各自上报 token 与成本，界面上直接看到「📊 分环节：节点名 输入X/输出Y」。不配置则完全不生效、零开销。
- **本机用量看板**：顶部导航进入，按流程 / 按模型汇总调用次数、token、成本、错误率与时延，支持多时间窗口切换，不必登录 LangSmith 网站即可判断链路是否正常。
- **本地优先 / 隐私友好**：API Key 持久化在浏览器本地；模型调用默认由浏览器直连厂商，数据不出本机（使用服务端生成链路时会随请求发送到本机服务端，见「隐私与安全」）。

## 快速开始

### 环境要求

- Node.js 22+

### 安装与运行

```bash
# 1. 安装前端依赖
cd site && npm install

# 2. 启动后端（静态托管 + /relay 转发 + /agent 生成 + RAG 检索）
cd site/server && npm install && npm start

# 3. 启动前端（开发模式）
cd site && npm run dev
```

打开 http://localhost:5173 即可使用。

> 不想起两套服务？可直接 `docker compose -f site/docker-compose.yml up` 一键本地运行。

### 配置 API Key

进入「设置」页，选择模型服务商、填入 API Key（仅保存在本机浏览器），即可开始生成与优化。

### 可选：开启 token 用量追踪

想统计每条流程消耗了多少 token，可在 `site/server/.env` 填入 [LangSmith](https://smith.langchain.com) 的 Key：

```bash
LANGSMITH_API_KEY=lsv2_pt_xxx
LANGSMITH_PROJECT=模法师-Promptly
```

重启后端即生效。留空则完全不启用（不发任何网络请求、不影响速度）。也可用 `LANGSMITH_ENABLED=0` 临时关闭。

开启后有两种查看方式：

- **本机「用量看板」**（顶部导航进入）：按流程 / 按模型汇总**调用次数、token 消耗、成本、错误率与时延**，支持「今天 / 近 7 天 / 近 30 天 / 全部」切换，无需登录任何网站。
- **LangSmith 官方站点**：看单条 run 的完整链路树与节点级明细。

看板的错误率口径把「未完成（pending）」单独统计、不混入失败——进程被中断的 run 不等于业务失败。调用次数只统计业务流程根 run，重试与运维遥测记录（`·attempt` / `llm:failover`）单列、不重复计数；「模型请求」则按真实 LLM 请求累计（含重试）。

## 使用流程

1. **浏览模板库**：首页按行业浏览 102 个内置模板，点开任一模板查看结构。
2. **生成提示词**：在模板详情页填入参数，一键生成成品提示词。
3. **优化 / 增强**：用「🔧 一键优化 / ✨ 增强」让模型基于测试目标迭代提升，对比并采用。
4. **导入自己的模板**：导入模板 JSON，载入后可直接编辑、增强、保存。
5. **我的模板**：收藏 / 保存的模板集中管理，支持版本历史与回滚。

## 技术栈

- **前端**：Vite + TypeScript（零运行时框架，hash 路由），Tailwind 构建期编译。
- **后端**：Node 22 + `tsx`，无数据库；`/relay` 转发 LLM 请求（仅放行已知厂商 origin，与 CSP 同源），`/agent` 跑生成 / 优化状态机，`/agent/trace` 中转前端链路用量上报，`/agent/stats` 提供用量看板聚合数据。
- **RAG**：LanceDB + 词法 / 可选 bge 语义向量召回，语料为内置 102 模板。
- **模型**：内置 20+ 家主流 LLM 服务商适配（OpenAI 兼容为主，Claude / Gemini / 文心走原生协议）。
- **可观测**：可选对接 LangSmith，按流程上报 token / 成本 / 耗时（默认关闭）；内置本机「用量看板」，按流程 / 模型汇总调用次数、token、成本、错误率与时延。

## 评测：如何验证「两阶段优于直出」

核心主张不能靠感觉。仓库内置一套可复现的盲测成对评测：

```bash
cd site/server
# 离线跑通全流程（无需 Key，用于验证评测链路本身）
npm run eval:chain:dry

# 真实评测（需要模型 Key）
EVAL_PROVIDER=deepseek EVAL_MODEL=deepseek-chat EVAL_API_KEY=sk-xxx \
  EVAL_JUDGE_MODELS="openai:gpt-4o-mini" npm run eval:chain
```

方法论：

- **盲测**：裁判只看到「方案甲 / 方案乙」，不知道哪条来自实验组；每次重复重新随机左右顺序，抵消位置偏好。
- **多裁判 + 重复**：默认 3 次重复，支持多个裁判模型多数票。
- **统计口径**：报告胜率、bootstrap 95% 置信区间、精确二项符号检验 p 值；区间跨 0.5 时明确写「无显著差异」。
- **不混口径**：默认链路不含 RAG；验证检索增益需单独设 `EVAL_WITH_RAG=1`。
- **可复现**：同 seed 下顺序与区间一致。

报告写入 `site/server/scripts/eval_chain_report.md` / `.json`（已 gitignore）。

## 工程与质量

> 一次系统性整改的记录（问题 → 修复 → 验证 → 仍存在的限制）见 [docs/engineering-notes.md](docs/engineering-notes.md)。

- **单一数据源**：`site/src/templates.ts` 是模板唯一来源，`server/data/templates.json` 由 `npm run corpus:build` 生成；`npm run corpus:check` 校验条数、prompt、variables、章节唯一性与占位符对齐，CI 强制通过。
- **测试**：150+ 离线单测覆盖重试分类、语料校验、评测统计与随机化、trace / relay / stats 等纯函数；`npm test` 前置语料校验。
- **CI**：服务端 typecheck + 语料校验 + 单测；前端 typecheck + build；Docker 构建与 `/healthz` 冒烟。
- **容错**：LLM 调用对 429/5xx 指数退避重试，区分「用户停止」与「服务端超时」，支持主备切换。

## 隐私与安全

- API Key **持久化在浏览器 `localStorage`**。浏览器直连厂商时 Key 不出本机；使用 `/agent/*` 服务端生成链路时，Key 会随请求体发送到**本机服务端**并由服务端转发给厂商——这是功能所需，不是「永不上传」。请勿把服务端暴露到不可信网络。
- 后端无账号、无业务数据库；整个服务「拷走即跑」，天然契合数据不出域。
- 唯一的对外上报是**可选**的 LangSmith 用量追踪（需自行填 Key 才生效，默认关闭）；上报内容为流程名、模型名、token 数与耗时，**不含提示词正文与 API Key**。
- 代理 `/relay` 仅转发已知模型厂商域名（按 origin 校验，与 CSP `connect-src` 共用同一份白名单）；自定义服务商可在服务端 `.env` 配置 `RELAY_ALLOWED_ORIGINS` 扩展并重启。
- **安全默认值**：服务端默认只监听 `127.0.0.1`；`/relay` 可选用 `RELAY_TOKEN` 加共享密钥；请求体上限 2MB（`MAX_BODY_BYTES`）；容器部署时显式 `HOST=0.0.0.0` 并建议只映射到回环地址。
- 仍不建议将服务端口直接暴露到公网：`/relay` 在没有 `RELAY_TOKEN` 时无鉴权。

## 许可证

[MIT](LICENSE)
