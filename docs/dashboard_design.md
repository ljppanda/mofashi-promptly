# 系统设计：统一 run 命名 + 本地用量看板 + 扩展统计指标

> 项目：模法师·Promptly（个人本地版）
> 技术栈：Vite + TS 前端（`site/src`）· Node 22 TS 后端（`site/server`，:8000）
> 类型：**增量设计**（复用现有上报链路，最小变更、可关可开、默认零开销）
> 作者：高见远（架构师）
> 关联：`docs/system_design.md`（上报链路基础设计，本文件是其延续）

---

## 0. 需求与结论速览

用户原话：「清理掉没用的模板，然后用量看板的话可以做一下，不然还要登录 langsmith 的网站，顺便统一一下 run，顺便把时延、错误率、大模型调用次数这些常用的统计也加上吧，我记得 langsmith 能统计挺多东西的，把常用的都加上」。

| 子需求 | 结论 |
|--------|------|
| 统一 run 命名 | **命名不统一是数据正确性 bug**（同模型被拆成 5 个统计簇）。统一用 **provider id**，并做**看板侧归并映射**兼容历史 run（历史 run 名改不了）。 |
| 本地用量看板 | **不自建存储**，后端代理 LangSmith 现成的 `POST /api/v1/runs/stats` 聚合 API；前端零新依赖，SVG/CSS 手绘。 |
| 时延 / 错误率 / 调用次数 | 时延(平台 `latency_*`)、调用次数(`/runs/query` 的 `runs.length`) 取自上游；**错误率必须自算**（`pending` ≠ 失败，口径 `error/(success+error)`，来自 `/runs/query`）。 |
| 「把常用的都加上」 | 见 §3 指标表（token/cost/时延/错误率/调用次数/流式率/首 token 时延 等）。 |
| 清理没用的模板 | 归入 §4 任务（属另一条线，本设计给出边界与依赖关系）。 |

**两条硬约束（源自既有架构，不可绕过）**
1. **CSP**：`index.ts::buildCsp()` 的 `connect-src` = `'self'` + 19 家厂商域名，**LangSmith 不在白名单** → 前端**无法**直连 `api.smith.langchain.com` → **看板取数必须经后端代理**（Key 只在服务端 `.env`）。
2. **无 Key / 关闭态**：`LS_ENABLED=false` 时看板必须**优雅降级**（显示"未启用"引导，不报错、不打网络）。

**一条新的实现级硬约束（实测发现，贯穿全文）**
3. **LangSmith 限流极紧：连续 3 次 POST 即 429（响应是 HTML，非 JSON）** → **一次看板加载最多打 2 次上游请求**（1 次分组 `stats` + 1 次 `runs/query`），并带指数退避与部分成功降级（§2.9）。**这是本次修订的核心约束**。

---

## Part A：统一 run 命名规范

### §1 命名规范

#### 1.1 问题定性（为什么必须做）

实测 `runs/stats`（按 `name` 分组）暴露的真实数据：**同一个 `deepseek-chat` 模型被拆成 5 个统计簇**

| 实测 run 名 | run_count | total_tokens | 来源 |
|-------------|-----------|--------------|------|
| `deepseek·deepseek-chat·llm` | 7 | 3610 | `trace.ts::emitTraceReport`（**provider id**） |
| `DeepSeek·deepseek-chat·llm` | 1 | 2300 | `providers.ts::labelOf`（**中文 label**） |
| `DeepSeek·deepseek-chat` | 2 | null | 早期父 chain run（无 `·llm` 后缀） |
| `deepseek-chat·llm` | 1 | 1801 | 早期硬编码（无 provider 前缀） |
| `DeepSeek·deepseek-chat·tool` | 1 | — | `chatWithTools` 工具 run |

→ 看板按 `name` 分组会把同一模型的用量显示成**互不相干的碎数据**。**必须先统一命名，再做看板，否则看板本身就是错的。**

#### 1.2 中文 label vs provider id 取舍

| 维度 | provider id（如 `deepseek`） | 中文 label（如 `DeepSeek` / `通义千问（阿里）`） |
|------|------------------------------|--------------------------------------------------|
| 稳定性 | ✅ 代码常量，永不变 | ❌ label 文案一改，历史/新 run 分叉 |
| 可筛选/可解析 | ✅ 与 `extra.metadata.ls_provider` 同值，可 join | ❌ 中文 + 全角括号，前端解析易错 |
| 唯一性 | ✅ key 即 id，一对一 | ⚠️ 存在别名（`kimi` vs `moonshot` 都叫「Kimi」；`tongyi` vs `qwen` 都叫「通义千问」）→ **同一厂商两条 label 又会分叉** |
| 展示友好 | ⚠️ 需前端映射成中文 | ✅ 直接可读 |
| 与厂商 API 对齐 | ✅ `ls_provider` 即 id | ❌ |

**结论：run name 统一用 `provider id`；中文展示交给前端**（前端已有 `LLM.PROVIDERS[id].label` 映射，看板渲染时再翻译）。这也解决了「别名厂商分叉」问题（`kimi`/`moonshot` 需另行归并，见 §1.5）。

#### 1.3 命名规则表（定稿）

| run 类别 | 命名公式 | 示例 | run_type | 备注 |
|----------|----------|------|----------|------|
| **父 chain run（流程）** | `<flow>` | `agent:generate` / `llm:run` / `judge:eval` | `chain` | flow 名取自 `PUBLIC_FLOWS` / `TRACE_FLOWS` 白名单，**前缀 `agent:` = 后端 SSE，其余 = 前端直连** |
| **子 llm run（模型调用）** | `<providerId>·<model>·llm` | `deepseek·deepseek-chat·llm` | `llm` | 默认名，由 `providers.ts` 与 `trace.ts` **两处统一** |
| 子 llm run（同名多次） | `<providerId>·<model>·llm#<n>` | `deepseek·deepseek-chat·llm#2` | `llm` | 重试第 n 次（`n≥2`）；`#2/#3` 后缀避免 LangSmith 视图合并 |
| 子 llm run（自检改写） | `<providerId>·<model>·llm#selfcheck` | `deepseek·deepseek-chat·llm#selfcheck` | `llm` | F2 自检改写（`lsRunName` 覆盖） |
| 子 llm run（failover 备厂商） | `<fbProviderId>·<fbModel>·llm#<n>` | `tongyi·qwen-max·llm#2` | `llm` | 备 provider 各建一条，序号延续 |
| 工具调用 run（LLM 决策） | `<providerId>·<model>·tool` | `deepseek·deepseek-chat·tool` | `llm`※ | `chatWithTools` 的 tool 子 run（当前 run_type 传 `"llm"`，见下方注） |
| 厂商尝试遥测（进程级） | `<providerId>·<model>·attempt` | `deepseek·deepseek-chat·attempt` | `tool` | `recordProviderAttempt`，`parent=null` |
| 主备切换遥测（进程级） | `llm:failover` | `llm:failover` | `tool` | `recordFailover`，`parent=null` |

> ※ **待确认**：`providers.ts::chatWithTools` 的 tool 子 run 目前 `run_type` 传的是 `"llm"`（名字带 `·tool`）。这与"工具类应是 `tool` 类型"语义不符。**倾向**：保持 `"llm"` 不动（它确实是一次 LLM 调用，带 token 成本，归 llm 才会计入 token/cost 统计）。如需区分，靠 name 的 `·tool` 后缀即可。**本设计不改 run_type**。

**分隔符约定**：统一用**半角中点 `·`**（U+00B7），不用 `-` / `_` / 空格。原因：`·` 与模型名（含 `-` `.`）不冲突，前端 `split("·")` 可稳定解析出 `[providerId, model, suffix]`。

#### 1.4 代码改动点（统一两处，最小变更）

| 文件 | 现状 | 改为 |
|------|------|------|
| `providers.ts:399` | `labelOf(opts.provider, opts.model) + "·llm"` | **新增 `runNameOf(providerId, model)`** 返回 `${id}·${model}·llm`；此处改用它 |
| `providers.ts:430` | `labelOf(fb.provider, ...) + "·llm#n"` | 改用 `runNameOf()` |
| `agent.ts:391` | `labelOf(input.provider, input.model) + "·llm#selfcheck"` | 改用 `runNameOf()` |
| `trace.ts::emitTraceReport:188` | `${call.provider}·${call.model}·llm` | 已符合规范（**不动**），但建议抽用同一 `runNameOf` 以防未来漂移 |

**关键：`labelOf` 不能直接改**——它还用于 UI 展示（`index.ts:189/226` 的 SSE `meta` 事件、`agent.ts:639`）。故**新增独立函数 `runNameOf`**，与 `labelOf` 并存：

```ts
// providers.ts — 新增（labelOf 保持不变，继续服务 UI 展示）
export function runNameOf(providerId: string, model: string): string {
  return `${providerId}·${model}·llm`;
}
```

#### 1.5 历史数据兼容策略（推荐方案）

历史 run 名**已写入 LangSmith，无法修改**（且 LangSmith 无删除 API，实测 DELETE 返 405）。因此看板**必须做归并映射**：

**方案：看板侧「规范化归并」纯函数**（`site/server/src/stats.ts`，可单测）
1. 拉 `runs/stats?group_by=name` 得到 `{runName: RunStats}`。
2. 对每个 `runName` 求**规范化键** `canonicalName(runName)`：
   - 去掉尾部序号后缀 `#\d+` / `#selfcheck`。
   - 去掉尾部 `·llm` / `·tool` / `·attempt`（保留类型信息另存）。
   - 把**首段**（疑似 provider 段）映射到 provider id：先查 `PROVIDERS`（label→id），再查别名表（`Kimi`→`kimi`、`通义千问（阿里）`→`qwen`…）；无法识别则保留原样。
   - 补齐缺失的 `·llm` 后缀（早期 `DeepSeek·deepseek-chat`）。
3. 按 `canonicalName` 聚合（`run_count` / `total_tokens` / `total_cost` 相加；时延/错误率需加权或重算，见 §2.5）。
4. 前端展示时把 `providerId` 段翻译成中文 label。

> **取舍说明**：归并是**看板侧只读映射**，不改写平台数据、不引入本地存储。代价是"时延/错误率"这类比率指标**不能简单相加**（需按 `run_count` 加权或改用 `run_type`+`ls_provider` 分组重算）。**推荐主力用 `ls_provider` metadata 分组**（§2.4），把 `name` 归并作为兜底/明细视图。**待确认**：是否值得为历史碎数据做精细加权，还是只做"新数据已统一 + 历史归并展示"的粗粒度归并——**倾向后者**（个人工具，历史量小）。

---

## Part B：看板数据获取设计

### §2 后端聚合端点

#### 2.1 端点定稿

| 项 | 值 |
|----|-----|
| 方法/路径 | `GET /agent/stats` |
| 查询参数 | `range`（`today`\|`7d`\|`30d`\|`all`，默认 `7d`）、`groupBy`（`flow`\|`model`\|`run_type`\|`name`，默认 `flow`） |
| 响应 | `{ ok: true, enabled: true, range, groupBy, generatedAt, groups: StatsGroup[], totals?: RunStats, partial?: boolean, warnings?: string[] }`（`partial:true` = 两次上游请求只成功其一，对应字段缺失；`warnings` 说明哪部分降级） |
| 关闭态 | `{ ok: true, enabled: false }`（HTTP 200，前端显示引导，不报错） |
| 失败 | `{ ok: false, enabled: true, error: "..." }`（HTTP 200，前端显示错误条，**不 5xx**） |

设计原则：**恒 200**（看板是只读展示，失败不应打断页面）；`enabled` 字段让前端区分"没开" vs "开了但拉取失败"。

#### 2.2 如何映射到 LangSmith `runs/stats`

```ts
// site/server/src/stats.ts（新增，纯函数 + 薄 fetch 封装）
const STATS_SELECT = [
  // 计数
  "run_count",
  // token
  "total_tokens", "prompt_tokens", "completion_tokens",
  "median_tokens", "tokens_p99",
  // 成本
  "total_cost", "prompt_cost", "completion_cost", "cost_p50", "cost_p99",
  // 时延
  "latency_p50", "latency_p99", "latency_avg",
  "first_token_p50", "first_token_p99",
  // 质量
  "error_rate", "streaming_rate",
  // 时间
  "last_run_start_time",
];
```

请求体（`POST {ENDPOINT}/api/v1/runs/stats`，header `x-api-key`）：

```json
{
  "session": ["<project_id>"],          // 由 ensureProject() 复用（langsmith.ts 已有）
  "select": [ ...STATS_SELECT ],
  "group_by": { "attribute": "name", "max_groups": 20 },
  "start_time": "<ISO>",                 // range 换算；all 时省略
  "run_type": "llm"                      // 可选
}
```

**⚠️ 硬约束（团队已实测踩坑）**：`max_groups` **必须在 1~20**，传 30 会 422 `max_groups must be between 1 and 20`。
**⚠️ select 组合需保守**：实测同时传 `["run_count","error_rate","run_facets"]` 时 **`run_facets` 挤掉了其它字段**（全 null）。故：**不要混入 `run_facets` 等分面类字段**；`select` 数组按 §2.2 的保守清单（纯标量聚合）传。若实测仍有字段互斥，**分批请求前先确认**——但受 §2.9 限流预算约束，**默认假设一次分组请求能拿到全部所需标量**。
**响应形态**：不分组返回单个 `RunStats`；用了 `group_by` 返回**扁平 map（非数组）** `{<分组键>: RunStats}`。**同一组内字段独立可空**（实测：某组 `error_rate`=0、`total_tokens` 却为 null），**消费端必须逐字段判空**。

#### 2.3 三种 `groupBy` 的取数组合

| `groupBy` | LangSmith `attribute` | 用途 |
|-----------|----------------------|------|
| `flow` | `metadata` + **`path:"flow"`（字符串！）** | 按流程聚合（最贴合用户诉求：每个流程多少 token/时延/次数）。**依赖 §3.4 补写的 `metadata.flow`（U3 已拍板补）** |
| `model` | `name`（或 `metadata` + **`path:"ls_provider"`（字符串！）**） | 按厂商/模型聚合 |
| `run_type` | `run_type` | chain vs llm 分布 |
| `name` | `name` | 原始明细（配合 §1.5 归并） |

**`metadata` 分组的确切请求体（U3 已拍板，**已实测**，写死如下）**：
```json
"group_by": { "attribute": "metadata", "path": "flow", "max_groups": 20 }
```
> **✅ `path` 必须用字符串（已实测）**：
> ```
> [A] path:["flow"] → HTTP 422  body.group_by.path: Input should be a valid string
> [B] path:"flow"   → HTTP 200  → 返回 {}（空对象）
> ```
> **❌ 严禁写数组形态**（`["flow"]` / `["ls_provider"]` 一律 422）。`model` 分组的 metadata 变体同理用 `"path":"ls_provider"`。

> 🔴 **空分组 ≠ 失败，必须回退（实现级要点，务必落实）**：
> 实测 [B] 在 `metadata.flow` 尚未被任何 run 写入时返回 **HTTP 200 + 空对象 `{}`**，**不是错误**。因此 `stats.ts` 必须：
> - 把「返回 `{}`」判为 **"该维度暂无数据"**，并**自动回退到 `name` 分组 + `canonicalName` 归并**（§1.5）渲染；
> - **绝不**把 `{}` 当成"零用量"渲染成一片 0 —— 否则 **T-01 上线前**（`metadata.flow` 还没写入）看板会显示全 0，误导用户以为链路坏了。
> - 可加一个轻量探测：本次 `metadata.flow` 分组为空 → 同一响应周期内改用 `name` 分组（受 §2.9 的 2 次请求预算约束，**回退发生在已有的 ① stats 请求内换参数重发，不新增第 3 次**；若判断预算紧张，则直接以 `name` 为主口径、`metadata.flow` 仅作可选优化）。
>
> 这条**同时加强了 U3 补 `metadata.flow` 的必要性**：两条路（`metadata.flow` / `name` 归并）互为兜底，任一为空都能切换到另一条，看板不会因缺字段而误报 0。

> **✅ U3 已拍板：补 `metadata.flow`**。理由：`group_by=metadata&path=flow` 让 flow 聚合**不依赖 name 归并**，与"按 name 归并"互为兜底，更稳。
> **改法（T-01 顺手做）**：`langsmith.ts::withTrace` 已将 `metadata` 同传到 inputs 与 `extra.metadata`（实测：`extra.metadata` 落槽已修好），只需在 `agent.ts` 四处的 `withTrace(name, metadata, ...)` **metadata 里加 `flow: name`**；`trace.ts::emitTraceReport` 建父 chain run 时同样加 `flow: rep.flow`。

#### 2.4 时间范围换算

| range | start_time | end_time |
|-------|-----------|----------|
| `today` | 今日 00:00（**本地时区**） | now |
| `7d` | now − 7d | now |
| `30d` | now − 30d | now |
| `all` | **省略该字段** | 省略 |

用**本地时区**算 `today`（个人工具，用户看的是本地日），转 ISO 8601 UTC 传参。

#### 2.5 错误率正确口径（关键坑）

**问题**：LangSmith 的 `error_rate` 把 `status:"pending"`（无 `end_time`、无 error，来自**被 kill 的进程**）也算进分母。实测导致假错误：`agent:generate` 显示 30%、`通义千问·qwen3.8-max` 显示 77%，但 `/runs/query` 明细显示**真实业务 run 全是 `success`，零失败**。

**看板口径（定稿）**：

```
错误率 = error 数 / (success 数 + error 数)      ← 分母排除 pending
未完成率 = pending 数 / 全部数                    ← 单独展示为「中断/未完成」，与错误区分
```

**如何拿到 status 分布 —— 定稿走 B 方案（`/runs/query` 明细）**

> 🔴 **A 方案（`run_facets`）已实测证伪，作废**。团队实测：传 `select:["run_count","run_facets"]` 时，`run_facets` 返回的是 **`input_key` 分面**（内容是 `model`/`provider`/`goal`/`template`/`historyLen`/`industry`/`sentence`/`label`/`metadata.from` 这类**字段名列表**），**与 status 分布完全无关**。故不能用它取 status。

**B 方案（转正）**：`POST /api/v1/runs/query`

请求体（只取根 run，**不额外发请求给 stats**）：
```json
{ "session": ["<project_id>"], "limit": 100, "is_root": true }
```
- `is_root:true` 只取**根 run**（我们的父 chain run 即 root；llm 子 run 不是）。**15 条 root 就覆盖了全部流程调用**，`limit:100` 完全够，**不存在分页问题**（实测 15 条 root runs）。
- 响应是**对象不是数组**，顶层 key：`{ runs: [...], cursors, search_cursors, parsed_query }`。解析路径：`body.runs[]`。
- 每条 run 的 `status` 字段取值：`success` | `error` | `pending`。

**status 分布与总数在同一次 query 里一起拿到**：`runs[]` 的**长度 = 根 run 总数**（可作为"根 run 总量"校验），逐条数 `status` 即得 `{success, error, pending}` 分布。**不额外发请求**。

**错误率计算（基于该 query 结果）**：
```
errorCount   = runs.filter(r => r.status === "error").length
successCount = runs.filter(r => r.status === "success").length
pendingCount = runs.filter(r => r.status === "pending").length
错误率   = errorCount / (successCount + errorCount)     // 分母排除 pending；分母为 0 时显示 "—"
未完成率 = pendingCount / runs.length
```

> **注**：`/runs/stats` 返回的平台 `error_rate` 字段**仅作参考、不直接展示**（它把 pending 计入分母，会虚高：实测 `agent:generate` 30%、`通义千问·qwen3.8-max` 77%，而真实业务 run 零失败）。
> **按分组细化错误率**：如需"每个 flow 各自的错误率"，可在 `runs[]` 上按 `name` 分组后同样计算（一次 query 内完成，无需额外请求）。
> **与 §2.3 的联动**：`/runs/stats` 的分组请求若因 `metadata.flow` 未写入而返回空 `{}`，**必须回退到 `name` 分组**（不是渲染 0）；错误率不受影响——它只依赖本节的 `/runs/query`（不依赖 stats 分组），故**即便 stats 分组为空，错误率/调用次数/未完成率仍可用**。

#### 2.6 探针噪声的具体过滤规则（白名单 + 黑名单）

**背景**：调研探针跑了若干 run（含 4 条 `pending`，来自被 kill 的进程），**LangSmith 无删除 API**（DELETE 实测返 405），噪声**只能过滤不能删**。实测：15 条 root runs 中非 success 的全部来自探针（`name = t01-probe:withTrace-metadata` ×3、`withtrace-probe` ×1）。

**过滤规则（三层，按优先级）**：

1. **白名单 flow 名（主过滤，硬编码 13 个）** —— 看板主视图**只保留 `name ∈ 白名单` 的组**：

   ```
   // 前端直连 9 个（trace.ts::PUBLIC_FLOWS）
   llm:generate-template, llm:prod-selfcheck, llm:instantiate, llm:preview,
   llm:chat, llm:refine-direct, llm:optimize, llm:run, judge:eval
   // 后端 SSE 4 个
   agent:generate, agent:use, agent:clarify, agent:refine
   ```
   → **共 13 个**，即 `trace.ts::TRACE_FLOWS`。实现上直接 `import` 该常量，**不重复硬编码**。

2. **黑名单前缀/模式（兜底，排除未在白名单的探针名）**：`^-` 之外，排除：
   - 含 `probe` / `t01-probe` / `withtrace-probe`（探针自报名）
   - 探针 metadata 特征名（实测 `hello-metadata`、`wt-*`、`withTrace-metadata`）
   - 规律：**不在白名单里的 root run 一律不进主视图**（黑名单只是给"遥测折叠区"做二次归类）

3. **`run_type` 维度天然隔离**：`recordProviderAttempt` / `recordFailover` 是 `tool` 类型且 `parent=null`；按 `run_type=llm` 取数时自动排除它们。

**归类去向**：
- 白名单 flow → **主视图**（总览卡 + 流程明细表）。
- `*·attempt` / `llm:failover` → **"运维遥测"折叠区**（默认收起，数据不丢）。
- 其余探针噪声 → **完全隐藏**（不渲染、不计数）。

> **⚠️ 注意**：根 run 的 `name` 是 flow 名（如 `agent:generate`），**但子 llm run 的 `name` 是 `providerId·model·llm`**。故 `/runs/query` 取 `is_root:true` 时，`name` 天然是 flow 名，白名单比对直接命中；而 `runs/stats?group_by=name` 会同时返回两类 name，**两者都要按同一白名单过滤**（llm 名不在白名单 → 归入"模型明细"区，见 §3.2 区块 3）。

#### 2.7 缓存策略

- **后端进程内 TTL 缓存**（无 Redis！）：`Map<string, {ts, data}>`，key = `range|groupBy`，**TTL = 30s**（个人工具，刷页不重复打 LangSmith，又不至于看过期数据太久）。
- **请求合并（in-flight memo）**：同 key 并发请求共享一个 in-flight Promise（复用 `langsmith.ts::ensureProject` 的既有模式）。
- 前端再加一层**轻量防抖**（切换 range 时若数据 < 30s 内已取过则不重发）。
- **不落盘**：本地不持久化统计（LangSmith 即数据源，符合"本地不持久化优先"）。
- **缓存对限流的缓解（关键）**：见 §2.9——30s TTL 让"连续刷页/切页"只打 1 次 LangSmith，是限流预算的第一道闸。

#### 2.8 关闭态行为

| 状态 | 后端 | 前端 |
|------|------|------|
| `!LS_ENABLED`（无 Key / 显式关闭） | `{ok:true, enabled:false}`，**零网络** | 显示引导卡片：「LangSmith 未启用。在 `site/server/.env` 配置 `LANGSMITH_API_KEY` 并重启服务即可查看用量。」+ 一句"本地运行期间仍会照常上报，只是此处无法展示" |
| 启用但拉取失败（含 429） | `{ok:false, enabled:true, error}` | 顶部错误条 + "重试"按钮，页面其余部分保持骨架 |
| 正常 | `{ok:true, enabled:true, groups, totals}` | 渲染看板 |

**绝不**：无 Key 时报错、弹窗、白屏。

#### 2.9 LangSmith API 取数与限流预算（新增）

**🔴 实测硬约束：LangSmith 限流很紧 —— 连续 3 次 POST 即 HTTP 429**，且 **429 响应体是 HTML 不是 JSON**（直接 `res.json()` 会抛 `Unexpected token '<'`）。因此**一次看板加载打 LangSmith 的请求数必须压到最少**。

**预算（定稿）：一次看板加载 = 最多 2 次 LangSmith 请求**

| 顺序 | 请求 | 目的 | 备注 |
|------|------|------|------|
| ① | `POST /api/v1/runs/stats`（1 次分组） | 流程/模型明细：run_count / token / cost / latency / streaming_rate | `group_by` 按当前视图选；`select` 用保守清单 |
| ② | `POST /api/v1/runs/query`（1 次，`is_root:true`, `limit:100`） | status 分布（self-computed 错误率）+ 根 run 总数 | 与 ① 并行发出，不串行等待 |

**不再有第 3 次请求**：❌ 不分组总量请求（假值，§3.4）；❌ 按天趋势分桶请求（会 7~30 次，必被限流打死，§6 U6）。

**429 重试 / 退避策略**：
- **判定**：`res.status === 429` **或** 响应 `content-type` 非 `application/json`（防 HTML 解析崩）→ 视为限流。
- **退避**：**指数退避，最多 2 次重试**：`300ms → 900ms`（加 ±20% 抖动），仍失败则**放弃并把该请求标记为失败**（不阻塞另一次请求的结果）。
- **降级**：① 失败但 ② 成功 → 仍渲染 status 相关指标（错误率/未完成率/总数），token/cost/时延显示"—"；反之亦然。**部分成功也算成功**（返回 `{ok:true, partial:true, ...}`）。
- **绝不**：在 429 时继续高频重试（会雪上加霜）。

**缓存对限流的缓解**：
- 30s TTL 缓存（§2.7）→ 30s 内刷页/切 range 回退 → **0 次** LangSmith 请求。
- in-flight memo → 前端并发/双击"刷新" → 只发 **1 组** 请求（2 次）。
- **结论**：正常使用下，看板的 LangSmith 请求频率 ≈ 每 30s 一组（2 次），远低于限流阈值。

---

## Part C：指标清单与展示设计

### §3 指标与页面

#### 3.1 指标表（`select` 字段 → 展示）

| 指标 | LangSmith 字段 | 口径 | 展示形式 |
|------|----------------|------|----------|
| 调用次数 | `run_count` | 该组 run 数 | **数字卡** |
| 总 token | `total_tokens` | 平台汇总 | 数字卡（千分位） |
| 输入 token | `prompt_tokens` | 平台汇总 | 卡内副行 |
| 输出 token | `completion_tokens` | 平台汇总 | 卡内副行 |
| 总成本 | `total_cost` | 平台按 `price_model_id` 估算（**缺 `ls_model_name` 不计**） | 数字卡（$，4 位小数） |
| 时延 P50 | `latency_p50` | 秒（LangSmith 单位=秒） | 数字卡 + 明细表 |
| 时延 P99 | `latency_p99` | 秒 | 明细表 |
| 平均时延 | `latency_avg` | 秒 | 明细表 |
| 首 token P50/P99 | `first_token_p50/p99` | 秒（流式） | 明细表 |
| **错误率** | `/runs/query` status 分布（**不用平台 `error_rate`**） | **自算**：`error/(success+error)`，排除 pending（§2.5） | 数字卡（%）+ 颜色分级 |
| 未完成率 | `/runs/query` status 分布 | `pending/全部`（§2.5） | 明细表脚注 |
| 流式率 | `streaming_rate` | 平台 | 明细表 |
| 中位 token | `median_tokens` / `tokens_p99` | 平台 | 明细表 |
| 最后调用时间 | `last_run_start_time` | 平台 | 明细表 |

**展示取舍**：主卡片放「调用次数 / 总 token / 总成本 / 错误率 / P50 时延」5 个用户点名指标；其余进明细表。**不追求一次展示全部 select 字段**（避免信息过载）。

#### 3.2 页面区块划分（`#/stats`）

```
┌─ 顶部：标题「用量看板」+ 范围切换〔今天｜7天｜30天｜全部〕+ 刷新 + 生成时间 ─┐
├─ 区块 1  总览卡片（5 张）：调用次数 · 总token · 总成本 · 错误率 · P50时延   │  ← 总数取自 /runs/query，明细取自 stats
├─ 区块 2  按流程明细表：flow | 次数 | token | 成本 | P50 | P99 | 错误率     │  ← 主视图，白名单过滤
├─ 区块 3  按厂商/模型分组：provider label | 模型 | 次数 | token | 成本 | P50 │
├─ 区块 4  「流程 / 模型占比条」（横向 CSS 占比条，**非时间趋势**）           │  ← 零额外请求，见 §3.4
└─ 区块 5  运维遥测（折叠，默认收起）：attempt / failover                    │
```

> **区块 4 变更说明**：原设计为"近 7/30 天每日 token 柱状（时间趋势）"，**已砍**（服务端按天分桶会 7~30 次请求 → 必被限流，§2.9）。改为**横向占比条**：用同一次分组返回的 `run_count`/`total_tokens` 画各 flow / 各模型的占比（纯 CSS `width%`），零额外请求。

#### 3.3 视觉方案（遵循「东方墨韵」设计系统）

- 色板：主色 `--brand`(#b5362a 朱砂)、次色 `--amber`(#b8893f 描金)、文字 `--ink`、次级 `--slate`、底 `--bg`(#f5f0e3 宣纸)、卡 `--surface`(#fffdf6)。
- **禁止**：紫蓝渐变、冷灰、Inter。标题用 `--font-display`（系统宋体栈）。
- 复用组件类：`.card` / `.card-pad` / `.btn` / `.btn-primary` / `.btn-ghost` / `.pill` / `.section-title`（`::before` 装饰）/ `.muted` / `.divider`。
- **错误率颜色分级**（消耗类指标，**不用红绿涨跌**）：`0%` 用 `--amber`；`<5%` 用 `--slate`；`≥5%` 用 `--brand`（朱砂警示）。**绝不**引入绿涨红跌那套股市色。

#### 3.4 图表方案（零新依赖）

**不引图表库**（项目是零运行时框架 + Tailwind 构建期编译，保持极简）。方案：
- **数字卡 / 明细表**：纯 HTML + 现有 CSS 类。
- **柱状图 / 迷你趋势线**：**内联手写 SVG**（`viewBox` + `<rect>`/`<path>`），用 CSS 变量上色。复用已有 `core/ui.ts` 的 `esc()` 做转义防 XSS。
- **进度条/占比条**：CSS `width%` + `--brand`。

> 理由：需求是"常用统计"，SVG 手绘足够；引 Recharts/Chart.js 会显著增加体积与构建风险，违背"最小变更"。

**⚠️ 总计取数（已修正，原方案作废）**：
- **总量 = 分组结果的 `run_count` 求和**（已在近 7 天场景验证吻合：各组之和 = 16）。
- **❌ 不可用「另发一条不分组 `/runs/stats` 作为总计」**：实测不分组 `select:["run_count"]` 返回**恰好 100**（= 默认 limit），而同参数分组后各组之和仅 16、单组就有 17/10/10（全量）→ **不分组总量被 limit 截断，是假值**。
- 若分组数可能超过 `max_groups=20`导致截断：以 **`/runs/query` 的 `runs[].length`（根 run 总数）** 作为"流程调用次数总量"的权威值（同一次 query 已取，零额外请求，§2.5）。

**📌 趋势图最终结论：砍掉"按天趋势"，降级为「横向占比条」**（详见 §6 U6 已拍板）。

---

## Part D：任务分解

### §4 任务列表（按依赖顺序）

> 依赖顺序：**命名统一（T-01）→ 指标扩展（T-02）→ 看板端点（T-03）→ 看板页面（T-04）→ 验收（T-05）**。命名不统一则看板数据错误，故 T-01 最先。

#### **T-01 · 统一 run 命名 + 补 `metadata.flow`** — P0
- **目标**：run name 统一用 provider id；补 `metadata.flow` 供按流程聚合；不影响 UI 展示。
- **涉及文件**：`site/server/src/providers.ts`（新增 `runNameOf`，改 3 处调用）、`site/server/src/agent.ts`（1 处 run name + 4 处 `withTrace` metadata 加 `flow`）、`site/server/src/trace.ts`（`emitTraceReport` 父 run metadata 加 `flow: rep.flow`）、`site/server/tests/`（新增命名单测）
- **完成标准**：新产出 llm run 名 100% 形如 `providerId·model·llm[#n|#selfcheck]`；父 chain run 的 `extra.metadata.flow` == 其 `name`；`labelOf` 未受影响（UI 照常中文）；单测绿。
- **依据**：§1.3 / §1.4 / §2.3（U3 已拍板）

#### **T-02 · 扩展统计指标采集（时延/错误率/调用次数）** — P0
- **目标**：确认 `outputs`/`metadata` 已带足够信息（usage/ls_model_* 已在），**补 latency 可用性**（`chatPrimary` 已算 `elapsedMs`，验证其进入 run 的 `outputs.elapsedMs`），并确认 status 由平台自动记录（供看板自算错误率）。
- **涉及文件**：`site/server/src/providers.ts`（核对 elapsedMs 落点）、`site/server/src/agent.ts`（确认 `lsEnd` outputs 携带耗时）、`site/server/tests/trace.test.ts`（补断言）
- **完成标准**：真实上报后，`runs/stats` 的 `latency_p50` 非 null；`outputs.elapsedMs` 可在 `/runs/query` 明细查到；`/runs/query` 能看到 `status` 字段。
- **依据**：§3.1
- **⚠️ 依赖**：T-01（命名统一后才能按 name 正确聚合验证）

#### **T-03 · 后端聚合端点 `GET /agent/stats`** — P0
- **目标**：代理 LangSmith **2 次请求**（1 stats + 1 query）；range 换算、白名单过滤、错误率自算（基于 query status）、**空分组回退**、429 退避、TTL 缓存、关闭态、部分成功降级。
- **涉及文件**：`site/server/src/stats.ts`（**新增**：保守 `select` 常量、`metadata` 分组用**字符串** `path:"flow"`、**空 `{}` → 回退 `name` 分组 + `canonicalName` 归并**、`fetchStats` + `fetchRootRuns`、429 判定/退避、TTL+in-flight 缓存、按 query 结果算错误率）、`site/server/src/index.ts`（挂 `GET /agent/stats` 路由）、`site/server/src/langsmith.ts`（**导出 `ensureProject`+`PROJECT`+`ENDPOINT`+`KEY` 供 stats 复用**，当前均模块私有）、`site/server/tests/stats.test.ts`（**新增**：离线单测，注入 fetch 替身，覆盖 **422 数组 path 反例**、**空 `{}` 回退**、429/HTML 响应、判空、归并、range）
- **完成标准**：契约见 §2.1；关闭态零网络；**一次加载 ≤2 次 LangSmith 请求**（§2.9）；白名单过滤生效；错误率 = `error/(success+error)`（来自 `/runs/query`）；**stats 分组返回空 `{}` 时自动回退 `name` 分组，绝不渲染全 0**；429/非 JSON 响应不崩、可降级；单测绿。
- **依据**：§2 全部（尤其 §2.5 / §2.6 / §2.9）
- **⚠️ 依赖**：T-01（归并+flow metadata）、T-02（指标字段就绪）

#### **T-04 · 前端用量看板页 `#/stats`** — P0
- **目标**：总览卡 + 流程明细表 + 厂商分组 + **横向占比条（非时间趋势）** + 关闭态引导；遵循东方墨韵设计系统。
- **涉及文件**：`site/src/views/stats.ts`（**新增**）、`site/src/app.ts`（注册 `stats` 路由）、`site/index.html`（导航加「用量看板」链接）、`site/src/core/ui.ts`（如需补 `fmtTokens`/`fmtCost`/`fmtDuration` 格式化）、`site/src/styles.css`（如需补看板专属类，**复用现有令牌**）
- **完成标准**：`#/stats` 可访问；范围切换生效；**占比条为 CSS `width%`（无时间趋势图、无图表库）**；部分失败时对应指标显示"—"；无 Key 时显示引导不报错；视觉符合设计系统（无紫蓝/冷灰/Inter）。
- **依据**：§3
- **⚠️ 依赖**：T-03

#### **T-05 · 端到端验收 + 清理无用模板** — P1
- **目标**：真机验证看板数据正确；执行用户"清理没用的模板"诉求（独立子任务，边界：只删模板数据，不动上报链路）。
- **涉及文件**：`docs/`（回填）、模板数据文件（**待确认具体路径**）、验收记录
- **完成标准**：§5 全部通过；清理后模板库无死链。
- **⚠️ 依赖**：T-04。**待确认**：「没用的模板」的判定标准（零调用？内置示例？）——**倾向**保留内置示例与用户自建，仅清 `import` 失败或明确废弃的。

---

## §5 验收要点

| # | 验收项 | 命令 / 预期观察 |
|---|--------|-----------------|
| V1 | 命名统一 | 上报几条后，`POST /api/v1/runs/stats`（`group_by=name`）返回的组名**全部**形如 `providerId·model·llm[#n]`；**不再出现**中文 label 或裸 `deepseek-chat·llm` |
| V2 | provider id 一致 | run name 首段 == 该 run 的 `extra.metadata.ls_provider` |
| V3 | 指标非空 | `select` 含 `latency_p50`/`error_rate`/`run_count` 时，活跃 flow 的返回**非 null** |
| V4 | 错误率口径 | 制造 1 条 pending（kill 进程）后，看板错误率**不含**该条（来自 `/runs/query` status 统计）；"未完成率"单独显示 |
| V5 | 白名单过滤 | 探针 run（`t01-probe:*` / `hello-metadata`）**不出现在**主视图；`attempt`/`failover` 仅出现在折叠遥测区 |
| V6 | 关闭态 | 移除 `LANGSMITH_API_KEY` 重启，`GET /agent/stats` 返 `{ok:true,enabled:false}` 且**无外网请求**；前端显示引导 |
| V7 | 缓存 | 30s 内连续刷页，LangSmith 侧请求数**不增加**（后端日志验证） |
| V8 | max_groups 边界 | 传 `max_groups>20` 时后端**自行钳制**为 20（不产生 422） |
| V8b | **请求预算** | 一次看板加载对 LangSmith 的请求数 **≤2**（1 次 `/runs/stats` + 1 次 `/runs/query`），后端日志可数 |
| V8c | **429 韧性** | 人为触发限流（连打）时，后端**不崩**：429/HTML 响应被识别为限流，退避重试≤2 次，仍失败则降级返回（部分成功 `partial:true`），前端对应指标显示"—" |
| V8d | 总计正确 | 总览"调用次数"= `/runs/query` 的 `runs[].length`，**不等于**任何不分组 stats 的截断值（对比：不得出现恒为 100） |
| V9 | 前端类型 | `cd site && npx tsc --noEmit` 通过 |
| V10 | 后端类型/单测 | `cd site/server && npx tsc --noEmit` 且 `npx tsx --test tests/*.test.ts` 全绿（含既有 45 用例） |
| V11 | 视觉合规 | 看板无紫蓝渐变/冷灰/Inter；用了 `--brand`/`--amber`/`--ink`/`--surface`；标题衬线 |
| V12 | 路由 | `#/stats` 直达可访问，导航新增链接可点 |

---

## §6 决策事项（U1~U7 均已拍板）

| # | 事项 | 结论 |
|---|------|------|
| U1 | 历史 run 归并粒度 | ✅ **已拍板：粗粒度归并**（个人工具、历史量小）；比率指标优先用 `ls_provider` 分组重算，不做精细加权 |
| U2 | `run_facets` 取 status 分布 | ✅ **已拍板：A 方案作废**（实测 `run_facets` 是 `input_key` 分面，与 status 无关）；**走 B 方案 `/runs/query`（`is_root:true`）本地统计 status**（§2.5） |
| U3 | 是否补 `metadata.flow` | ✅ **已拍板：补**。`group_by=metadata&path=flow` 让 flow 聚合不依赖 name 归并，两条路互兜底（§2.3）。T-01 顺手做 |
| U4 | tool 子 run 的 `run_type` 是否改 `tool` | ✅ **已拍板：不改**（保持 `llm`，确保 token/cost 计入统计） |
| U5 | 「没用的模板」判定标准 | ✅ **已拍板：只清明确废弃/导入失败**，保留内置示例与用户自建 |
| U6 | 趋势图数据来源 | ✅ **已拍板：砍掉"按天趋势"**。服务端按天分桶 = 7~30 次请求 → 必被限流（§2.9）。改为**「流程/模型横向占比条」**（复用一次分组返回，零额外请求） |
| U7 | 是否需要"导出 CSV" | ✅ **已拍板：不做**（属过度设计，用户未要求） |

> 原 U6「7d/30d 各日发一条 stats」方案**明确废弃**：一加载即 7~30 次 POST，而实测连续 3 次即 429。

---

## 附录：命名→聚合 数据流（含 2 次请求预算）

```mermaid
flowchart LR
  A[上报: runNameOf(providerId,model)] --> B[LangSmith run name<br/>deepseek·deepseek-chat·llm#2]
  B --> C["① POST /api/v1/runs/stats<br/>group_by(metadata.path=flow|name), max_groups≤20"]
  B --> D["② POST /api/v1/runs/query<br/>is_root:true, limit:100"]
  C --> E[stats.ts::canonicalName 归并]
  E --> F[白名单过滤 TRACE_FLOWS 13 个]
  D --> G["status 分布 → 错误率=error/(success+error)"]
  D --> H[runs.length = 调用次数总量]
  F --> G
  G --> I[GET /agent/stats<br/>最多 2 次上游请求]
  H --> I
  I --> J[前端 #/stats<br/>总览卡 / 明细表 / 占比条 / 东方墨韵]
  I -.429 退避≤2次, 部分成功降级.-> I
```

