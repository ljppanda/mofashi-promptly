# Agent 架构设计方案（v2 作品集版）

> 版本：v0.1 架构草案 ｜ 日期：2026-07-24
> 目标：把当前「普通 API 调用的提示词模板站」升级为**作品集级 AI 原生提示词工作台**，核心差异点是一个**有状态、有工具、有循环的真·Agent**（模板架构师 + 可选的运行/自优化 Agent），而非单次 LLM 调用。
> 本文档是落地前的设计，确认后转入实施。

---

## 1. 定位重述（作品集叙事）

- **v1.8（现状）**：零构建 vanilla 静态站，F1/F2 是单次 `fetch` 调用，`/relay` 代理解决跨域。功能闭环通，但「技术亮点被朴素 UI + 内容少掩盖」。
- **v2（本方案）**：**AI 原生提示词工作台**。叙事从「我有很多模板」升级为「我有一个能替你构思、检索最佳实践、自我校验、迭代精炼的 Agent」。这是作品集里能讲出深度的点。

---

## 2. Agent 范围（两个 Agent，分期）

### 2.1 模板架构师 Agent（MVP，必做）
输入一句模糊需求（如「帮我做个让 AI 当营养师排每周食谱的模板」），多步产出**可填模板草稿**。

状态图（LangGraph）：
```
START
  → clarify        # 识别行业/交付物/受众；信息不足则追问（human-in-the-loop 节点）
  → retrieve       # LlamaIndex RAG：从模板库召回相似结构与最佳实践做 few-shot
  → draft          # 生成 variables + prompt 骨架（带 {{占位}}）
  → validate       # 自审：是否有角色/上下文/约束/输出格式？{{var}} 是否都有定义？行业是否匹配？
       ├─ 不通过 → draft（带 critique 反馈，循环精炼，最多 N 次）
       └─ 通过  → finalize
  → finalize       # 结构化 JSON（同现有 generateTemplate 输出格式，向前兼容）
END
```
- **为什么是 agent 而非单次调用**：澄清+检索+自审+循环精炼，是单次 prompt 做不到的；且 `validate→draft` 的回路是 agent 的「反思」能力，作品集里可演示。
- **向前兼容**：`finalize` 输出字段与现有 `generateTemplate` 完全一致（`title/industry/task/summary/variables/prompt`），前端渲染零改动。

### 2.2 运行 / 自优化 Agent（Stretch，作品集加分）
- 用户在详情页点「运行」：Agent 把填好的成品提示词发给模型，**直接显示输出**（对齐 Prompt Ark 的页内执行差异点）。
- 进一步：Agent 比对「输出质量 vs 用户目标」，自动回写优化建议到模板（多版本对比）。
- 这是与竞品正面对打的差异点，但属 v2.1，不阻塞 MVP。

---

## 3. 技术栈（诚实子集，不用满四个库）

| 库 | 用途 | 必要性 | 备注 |
|---|---|---|---|
| **@langchain/langgraph**（JS） | Agent 状态图编排（节点/边/条件分支/循环/人审） | **核心** | agent 骨架 |
| **llamaindex**（TS） | RAG：把模板库做成可检索索引，retrieve 节点召回最佳实践 | **推荐** | 让生成有依据，非瞎编 |
| **LangSmith**（可选） | 链路追踪 / 评估 / 轨迹回放 | 锦上添花 | 作品集里是「我做了可观测性」的硬证明；接 `LANGCHAIN_TRACING_V2` 即可 |
| LangChain 本体 | — | 一般不需 | LangGraph 已含 core；重复引入是反模式 |

> 说明：不堆 LangChain+LangGraph+LangSmith+LlamaIndex 四个 buzzword。核心 = **LangGraph（编排）+ LlamaIndex（RAG）**，LangSmith 作为可选可观测层。

---

## 4. 运行形态与端点（基于现有 server.js 扩展）

现有 `server.js`（Node 内置模块，零依赖，托管静态 + `/relay`）。v2 引入依赖后：
- 升级为 **Node + TypeScript** 服务（引入 `tsx`/`ts` 运行，或编译）。保留静态托管。
- 新增端点：
  - `POST /agent/generate` — 接收 `{industry, sentence, apiKey, provider, model, customModel, stream}`；内部跑 LangGraph；**支持 SSE 流式**（把 graph 各节点进度 + 最终 draft 逐字推回，复用前端现有 `gen-live` 框）。
  - `POST /agent/complete` — F2 补全走 agent（带 retrieve 上下文）。
  - `POST /agent/run`（stretch）— 运行成品提示词，返回模型输出。
- **用户带 Key 模型不变**：Key 由前端随请求传入（或 v2 服务端 env 托管免费额度），`/relay` 与 `/agent` 共用底层 provider 调用层。

### 前端影响
- 浏览 / 搜索 / 填空 / 复制 / 导出导入 / 我的模板：**保持纯前端、本地优先、零后端**（这些不需要 agent）。
- 仅 F1 生成、F2 补全、运行：改调 `/agent/*`（流式）。前端调用方式几乎不变（仍是 fetch + SSE）。
- 设计上明确「agent 功能需要服务端；其余功能静态可用」——既保住本地优先卖点，又讲清 agent 边界。

---

## 5. RAG 数据（模板库即知识库）

- **索引源**：`src/templates.js`（24 种子）+ `samples/*.json` + v2 新写的 100+ 全文模板 + 抓取的公开最佳实践片段（可选）。
- **切片**：按 `industry / task / 结构标签（角色/约束/输出格式）` 做元数据过滤，retrieve 时按行业召回相似结构做 few-shot。
- **轻量实现**：LlamaIndex.TS + 本地向量（如 `ollama` embed 或火山/OpenAI embed），索引持久化到 `data/template.index`，服务启动时加载。无外部向量库依赖也可跑（小库用内存向量）。

---

## 6. 迁移路径（v1.8 → v2）

1. **内容优先（并行）**：先把 24 条骨架升级为高质量全文框架，并扩到 100+（见 §8）。这是作品集地基，agent 空库无意义。
2. **服务端 TS 化**：`server.js` → `server/`（TS），抽 `providers.ts`（复用现有各厂商协议）、`agent/graph.ts`、`rag/index.ts`。
3. **接 LangGraph**：实现 §2.1 状态图，先非流式跑通，再加 SSE 流式。
4. **接 LlamaIndex**：构建模板索引，retrieve 节点接入。
5. **前端切换 F1/F2 → /agent**：复用现有流式 UI。
6. **可选 LangSmith**：加 tracing，作品集截图用。
7. **视觉/品牌重做**（独立任务）：落地页 + 设计系统，从「工具原型」变「像样产品」。

---

## 7. 里程碑（建议）

| 阶段 | 交付 | 作品集可见度 |
|---|---|---|
| M0 | 内容升级到 100+ 高质量全文框架 | 内容产品成型 |
| M1 | 服务端 TS + providers 抽象（复用现有协议） | 工程结构 |
| M2 | 模板架构师 Agent（非流式）跑通 | **核心 agent** |
| M3 | Agent SSE 流式 + 前端切换 | 交互演示 |
| M4 | LlamaIndex RAG 接入 | agent 有「依据」 |
| M5 | 视觉/品牌重做（LangSmith 留作可选，未接入） | 完整作品集 |
| M6 | 模板 = 生成器，模型代写（用户不填表） | 产品定位纠偏 |
| M7 | 交互式访谈澄清（模型追问、用户点选确认，直到信息完整） | 体验闭环 |
| M8 | 修复「伪·Agent 不可用」与详情页空白（厂商名对齐 + 模板正文渲染 + 代理透传） | 上线前必过的健壮性 |
| M9 | 页内直接运行提示词看输出（F4 闭环：生成 → 运行 → 模型真实回答流式展示） | 差异化体验闭环 |
| M10 | 热度榜（服务端聚合 使用/收藏/评分 + 综合热度分 + 首页热门 Top5 + 详情页评分） | 真·产品化、可运营 |
| M11 | LangSmith 可观测（agent 调用建父 run、模型调用建子 run，无 Key 静默跳过） | 调试/监控闭环 |

---

## 8. 内容标准（给写作用）

每条模板的 `prompt` 不是 2 行 stub，而是**结构完整、可直接填、填完即高质量**的提示词骨架，含：
- **角色**（你是…）
- **上下文/背景**
- **任务与约束**
- **输入占位 `{{var}}`**（仅用户特有信息用占位，通用结构写死）
- **输出格式**（步骤/表格/结构）
- 必要时**示例**

竞品的「全文可抄」我们是「框架可填」——这是产品定位差异，内容要补的是**骨架的「厚度」与「行业覆盖广度」**，不是变成纯全文站。

---

## 9. 风险与诚实提醒

- **复杂度上升**：引入 LangGraph/LlamaIndex 后不再是零依赖；部署需 `npm i` + 起服务。对作品集合理，但需写清 README。
- **agent 质量依赖底模**：clarify/validate 节点效果取决于所用模型；默认用用户 Key 走的模型，需在 prompt 里约束。
- **不是所有功能都要 agent**：浏览/填空/复制保持纯前端，避免为了「agent 化」而过度工程。
- **RAG 对小库收益有限**：100 条模板的 RAG 价值在于「风格一致 + 行业对齐」，而非海量检索；不要神化。

---

## 10. 已确认（2026-07-24 用户拍板：按推荐来）

- [x] **Agent 范围**：先做 §2.1 模板架构师 Agent（MVP，必做）；§2.2 运行/自优化 Agent 纳入 v2.1（stretch，不阻塞 MVP）。这是作品集核心亮点。
- [x] **LangSmith**：先**不接**，但在 `chatStream` / agent 层预留 trace 接口，以后想接随时加（作品集截图用）。
- [x] **服务端语言**：**Node + TS**（确认，复用现有 JS 协议）。已落地于 `site/server/`。
- [x] **免费额度**：**不做**。沿用现有 BYOK（自带 Key）+ 多供应商 + 代理 + 测试连接；作品集不需要真掏钱。

### 实施进度（实时）
- M0 ✅ 内容扩到 **102** 条高质量可填框架（9 行业：法律/医疗/职场/教育/电商/金融/写作/编程/生活；原 40 → 102），`gen_samples.js` 扩到 13 个跨行业示例文件。
- M1 ✅ `site/server/`（TS）落地：静态托管 + `/relay` 代理（移植自 `server.js`）+ `/agent/generate`（SSE 流式）。`src/providers.ts` 抽象 18 厂商协议（openai/claude/gemini/ernie 流式 + usage 归一化，复用前端 llm.js 逻辑）。`src/agent.ts` 的 `runAgent` 当前为单步起草（向前兼容），M2 替换为 LangGraph 状态图。已 `npm install` + 冒烟测试：静态 200、`/agent` SSE 正确派发（无 Key 时优雅返回 error 事件）。
- M2 ✅ `@langchain/langgraph` 实现 clarify→retrieve→draft→validate→finalize 状态图（MAX_ITER=2 带 critique 回流）。`runAgent` 内部已替换为该图；提供方调用统一 `chatStream` + 90s 客户端超时保护。
- M3 ✅ Agent SSE 流式（`event: node/meta/token/result/usage/error`）+ 前端 F1/F2 切到 `/agent/*`（带回退 `/relay`）。状态机步骤条（⑤步）可见光可视化；中文 UTF-8 分包解析修复（`Buffer.concat` 后再解码）。
- M4 ✅ LlamaIndex.TS 真向量检索接入 `retrieve` 节点：自包含 TF-IDF 加权 n-gram 嵌入（DIMS=8192，零网络依赖，HuggingFace 被墙时也能用）+ `VectorStoreIndex` + 行业对齐。`rag.ts` 替代 `seed.ts`，`onContext` 事件把召回范例回传给前端展示「依据」。`scripts/rag-test.ts` 实测 4/4 查询 top-1 命中相关模板。
- M5 ✅ 视觉/品牌重做：品牌「模法师 Promptly」+ 设计系统（`src/styles.css`：渐变主色、Hero、价值点卡、三步流程、行业宫格、组件类 .btn/.card/.input/.pill/.tag/.chip/.preview/.code-box 等）；`index.html` 重品牌头部；`app.js` 首页/详情/行业/我的/设置全面套用。`tsc` + 前端 `node --check` 全过。
- **M6 ✅ 设计转向：模板 = 生成器，模型代写（用户不填表）**。核心纠偏：原"用户填空 → 拼回骨架"模式违背提示词模板本质（用户本就不会写具体内容，模板价值在被浪费）。改为——模板是「可复用的专家提示词生成器」，`variables` 重新定义为"模型要动态写具体的维度"（仅信息性展示，非表单）；详情页去掉表单/智能补全/预览，改为「你的目标」输入 + 模型代写成品提示词。新增服务端 `/agent/use`（`runAgentUse`：retrieve→draft→finalize，把模板专长+骨架+维度+用户目标喂给模型，产出"无占位、可直接用"的提示词，回传 `{prompt, sources}`）；旧的 `/agent/complete` 补全流程整条删除（服务端+前端 `completeViaAgent`/`completeFields`/`fieldHtml`/`collectValues`/`fillPrompt`/`handleComplete` 等死代码清理）。首页"怎么用/为什么不一样"文案同步改为"给目标，模型替你写"。`tsc` + 前端 `node --check` 全过；伪 Key 冒烟确认 SSE 顺序 `meta→retrieve→context→draft→error(401)` 不崩溃。

- **M7 ✅ 交互式访谈澄清（F3）**。用户一句话常讲不清，但"模板让用户填空"又违背产品定位。改为——详情页点"生成提示词"后，服务端 `/agent/clarify` 先让模型站在模板专长角度，主动追问最关键缺失的维度（受众/形式/语气/约束…），每题给 2-4 个贴合领域的选项让用户**点选确认**，可多轮，直到模型判定信息足够（或最多 3 轮），再把"目标 + 已确认问答"交给 `/agent/use` 代写成品提示词。追问由模型**动态生成**（非模板固定字段），与 M6"模型在思考中动态写入"一致。`runAgentClarify` 复用 `parseJsonObject` + `chatStream`(90s 超时)；无 Key / JSON 解析失败时降级（首轮给兜底追问 `fallbackQuestions`，有历史则直接判定完成并 `buildEnriched` 合成 brief），访谈流程绝不阻断主链路。前端 `llm.js` 新增 `clarifyViaAgent`（请求/响应 JSON）；`app.js` 的 `handleUse` 重构成 `handleUse → runInterviewRound → renderClarifyQuestions → startUseGeneration`，新增选项 chip 选中态、问答历史展示、跳过按钮、UI 容器 `#use-clarify` 与样式。`tsc` + 前端 `node --check` 全过；伪 Key 冒烟：首轮返回兜底问题、带历史再调返回 `complete:true` 且 `enrichedGoal` 正确合成。

> 运行方式：旧 `node server.js`（8000，纯前端+relay 仍可用）；v2 开发用 `cd site/server && npm i && npm start`（默认 8000，可用 PORT 覆盖）。前端 F1/F2 在 M3 前仍直连 / relay；M3 后切 `/agent`。
> 热度榜（M10）：服务端 `site/server/data/metrics.json` 聚合 使用/收藏/评分；首次启动若为空则从 `templates.json` 播种确定性演示数据（使用 40-2000、收藏 8-388、评分 20-600 人、均分 3.8-4.9）。综合热度分 = 使用×1 + 收藏×2 + 均分×评分人数。已用可 `POST /metrics/reset` 重新播种。
> LangSmith（M11）：`site/server/src/langsmith.ts` 读环境变量 `LANGSMITH_API_KEY`；有 Key 时每次 agent 调用建父 run、内部模型调用建子 run；无 Key 全部静默跳过、零开销。参考 `site/server/.env.example`。

- **M8 ✅（2026-07-27）上线前健壮性修复，修复两类用户实测反馈**：
  1. **「一上来就显示 Agent 不可用 / 回退直连，实际模型在调用」**：根因是**客户端与服务端厂商 key 不一致**——前端 `llm.js` 用 `moonshot`/`qwen`，而服务端 `providers.ts` 只有 `kimi`/`tongyi`，导致 `/agent/*` 抛「未知服务商」，被前端兜底逻辑误判为「agent 不可用」而回退浏览器直连（直连能用，所以"实际在调用"）。修复：服务端 `PROVIDERS` 增补 `moonshot`/`qwen` 别名（指向同一 baseURL），`providerOf` 不再抛未知；客户端 `/agent/*` 现在能正确识别厂商、真正走服务端 Agent，无效 Key 时如实报 401（不再误报回退）。前端两处回退文案由误导性的「Agent 不可用，回退直连」改为「服务端 Agent 暂不可用，已自动改用浏览器直连生成」。
  2. **「点进生成的模板啥都没有」**：详情页原只渲染标题/摘要/标签，缺少模板正文区。修复：详情页新增「📄 模板正文」卡片渲染 `tpl.prompt`（AI 草稿缺 prompt 时给兜底说明），生成模板落地可见。
  3. **agent 服务端调用支持用户代理**：`proxyBase` 透传链路补全——`llm.js.agentPayload` 现把 `proxyBase` 一并带入 `/agent/*` 请求体；服务端 `index.ts` 读取后传入 `agent.ts` → `chatStream` → 经 `doFetch` 走用户 `/relay` 转发（避免服务端直连被墙导致 agent 失败回落）。`providers.ts` 新增 `doFetch`（有 proxyBase 则 POST `${base}/relay`，否则直连）。
  - 验证：`tsc --noEmit` 0 错误；前端 `node --check` 全过；重启服务后 Node 探针确认——`/agent/use` 用 `moonshot`/`qwen` 不再「未知服务商」（SSE 正常 `meta→retrieve→context→draft`，伪 Key 在 draft 才报 401）；`/agent/clarify` 首轮降级给 3 道兜底问题、带历史返回 `complete:true` 且 `enrichedGoal` 正确合成。

> ⚠️ **易踩坑（记下来）**：前端 `llm.js` 与服务端 `providers.ts` 的厂商 key 必须保持双向对齐。新增厂商时两边都要加；否则会出现"前端直连 OK、但服务端 Agent 报未知服务商、前端误判回退"的假阳性。
