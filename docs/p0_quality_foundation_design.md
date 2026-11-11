# P0 质量地基 · 增量设计与任务分解

> 项目：模法师·Promptly（个人本地版）
> 取舍判据：[ADR 0001 · 产品定位](adr/0001-product-positioning.md)（7 条可判定基线）
> 类型：**增量设计**，只做 P0-2 / P0-3 / P0-4 三项收口，最小完整改动
> 作者：高见远（架构师）
> 关联：[docs/system_design.md](system_design.md)、[docs/dashboard_design.md](dashboard_design.md)

---

## §0 结论速览与事实复核

### 0.1 三条改动的一句话方案

| 编号 | 方案 | 核心决策 |
|------|------|----------|
| **P0-2** | `/relay` 最小域名白名单 | 抽出**单一共享 origin 集合**（新文件 `relay-allowlist.ts`），同时供 CSP `connect-src` 与 relay 校验使用；按 **origin** 比较；`redirect:"manual"` 拒绝 3xx；403 + 稳定 `code`；允许 env 扩展 `RELAY_ALLOWED_ORIGINS`；**不允许** `localhost:*` 通配 |
| **P0-3** | 失败可解释 | **只改 `relayFetch()` 一个函数**：代理分支 `fetch` 抛错时包装成带上下文的 `Error`；403 白名单拒绝经 `clone()` 探测后同样包装；**所有 view 的 `e.message` 通道零改动** |
| **P0-4(a)** | failover 计数口径 | **从 `rootRunCount` / status 分布中排除 `·attempt` 与 `llm:failover`**；`llmCallCount` **保持不变**（它已经通过 `·llm` 子 run 计入了每一次真实 LLM 请求，再加 attempt 会重复计数） |
| **P0-4(b)** | 提示条上移 | 把 `renderTelemetry()` 里的 `noiseNote` 上移到 `renderReport()` 顶部，复用 `.pill-amber`；折叠区删掉重复行 |

### 0.2 对上游调研的复核与纠正（**重要，请工程师先看这一节**）

调研行号整体准确，但发现 **3 处事实需要纠正 / 补充**：

**🔴 纠正 1（会导致功能回归）：前端与后端的 `doubao` origin 不一致**

| 位置 | 值 |
|------|-----|
| 前端 `site/src/llm.ts:34` | `https://ark.cn-beijing.volcesengine.com/api/v3` |
| 后端 `site/server/src/providers.ts:26` | `https://ark.cn-beijing.volces.com/api/v3` |

**两者是不同主机**（`volcesengine.com` vs `volces.com`）。前端所有 relay 请求的 URL 都由 `site/src/llm.ts` 的 `PROVIDERS[].base` 拼出（`:201/:212/:232/:237/:247/:370/:375/:384/:389/:393/:548/:553/:562/:567/:571/:620/:623/:648`），**不是**后端 `providers.ts`。因此：

> 若白名单**只从后端 `PROVIDERS` 派生**（调研建议），**豆包在「使用代理」开启时会 100% 被 403**。这是必须避免的回归。

**本设计的处理**：共享集合 = 后端 `PROVIDERS` 的 origin ∪ `FRONTEND_ONLY_ORIGINS`（目前仅此 1 条）∪ env 扩展。这样 CSP 与 relay 同源、且不破坏豆包。

**🔴 纠正 2（顺带修一个既有缺口）**：`buildCsp()` 当前也是从**后端** `PROVIDERS` 派生，`volcesengine.com` 从未进入 `connect-src` → **豆包「直连模式」当前其实已被 CSP 拦截**。共享集合同时修好这一点（属于同源化的自然结果，不额外加代码）。

**🟡 纠正 3（厂商数的表述）**：`providers.ts:20-43` 的 `PROVIDERS` 是 **21 条** = 19 个**非别名**条目（其中 `ollama` / `openrouter` 本就在内，不是额外追加）+ 2 个别名（`moonshot` / `qwen`，与 `kimi` / `tongyi` 共用 origin）。去重后 **19 个唯一 origin**；前端 `llm.ts:8-92` 是 19 条，origin 层面与后端**仅豆包 1 处不同**。

**✅ 行号复核结果（全部吻合，未漂移）**：`index.ts:45-63`（buildCsp）、`:131-162`（handleRelay）、`:393`（路由）；`providers.ts:20-43`；`llm.ts:161-178`（relayFetch）、`:648`（openrouter 兜底）；`stats.ts:91`（NOISE_PATTERNS）、`:132`（TYPE_SUFFIXES）、`:165`（isNoise）、`:448-458`（fetchRootRuns）、`:539-541`（emptyTotals）；`views/stats.ts:395-400`（details）、`:521-545`（renderTelemetry，噪声提示在 `:528-530`）。测试共 **7 个文件 / 106 个 `test()` 用例**（已逐个核对），`tests/agent-trace-endpoint.test.ts` 走子进程真 HTTP。

### 0.3 明确决策（P0-2 的三个拍板项）

| 问题 | 决策 | 理由 |
|------|------|------|
| **是否允许 `localhost:*`** | ❌ **不允许通配**。只允许 `PROVIDERS.ollama` 精确 origin `http://localhost:11434` | `recordProviderAttempt`/`recordFailover` 已证明 `/relay` 无鉴权；放开 `localhost:*` 等于允许转发到本机任意端口（`:8000` 自身端点、调试端口等），是新的 SSRF 面。ADR 基线 5「CSP 白名单可枚举」也要求集合有限可列 |
| **是否允许 env 扩展白名单** | ✅ **允许**：`RELAY_ALLOWED_ORIGINS`（逗号分隔 origin 列表，默认空）。解析时用 `new URL(x).origin` 归一、非法项跳过并 `log.warn` | ① 覆盖「自定义服务商/企业网关」这类**真实存在**的现况（设置页允许填自定义 `proxyBase`/`customModel`，厂商 base 目前写死）；② **关键**：让 P0-2 的 HTTP 层测试能把白名单指向本机 mock 服务器，实现**离线零外网**测试（见 §6）。该 env 同时喂给 CSP，保证两处仍同源 |
| **拒绝文案** | HTTP **403**，`{ error, code: "RELAY_ORIGIN_DENIED" \| "RELAY_REDIRECT_DENIED" \| "RELAY_BAD_URL", origin? }`；中文文案给出**可操作下一步** | 与 P0-3 衔接：前端识别 `code` 后转成用户能看懂的提示 |

> **`proxyBase` 与 `customModel` 不在白名单校验范围内**（必须写清，避免实现时误加）：`proxyBase` 是前端 `fetch(base + "/relay")` 的**目标地址**（`:165`），不是传给 relay 的 `url` 参数；`customModel` 只是模型名，进入 JSON body 或经 `encodeURIComponent` 进路径，**无法注入 origin**。白名单只校验 `payload.url`。

---

## §1 P0-2 · `/relay` 最小域名白名单

**对应 ADR 基线**：#5 隐私边界清晰（「`/relay` 作为开放代理的风险边界必须收紧」）、#4 失败可解释（拒绝文案可操作）、#7 决策可追溯（离线回归测试）。
**边界**：只加最小白名单，**不引入**完整 SSRF 防护层 / 限流 / Sentry（ADR `:22-24` 已裁剪，不回补）。

### 1.1 新增文件：`site/server/src/relay-allowlist.ts`（纯函数、零副作用）

> **为什么必须新建文件**：`index.ts` 有顶层副作用（`server.listen` + `warmupRag`），**无法安全 import**（现有端点测试已用子进程绕过）。白名单是信任边界，必须有**白盒离线单测**（白名单命中/拒绝、协议混淆、重定向、CSP 同源），这些纯函数只能放在可安全 import 的独立模块里。这是「最小改动」与「可判定验收」的交集，不是为将来加抽象。

导出 4 个成员：

```ts
// 1) 集合：后端 PROVIDERS 的 origin ∪ 前端独有 origin ∪ env 扩展
export const ALLOWED_ORIGINS: ReadonlySet<string>;

// 2) 校验单个 URL（返回归一后的 URL 或拒绝原因）
export function isAllowedRelayUrl(raw: unknown):
  | { ok: true; url: URL }
  | { ok: false; code: "RELAY_BAD_URL" | "RELAY_ORIGIN_DENIED"; origin?: string; reason: string };

// 3) 重定向策略（纯函数，便于离线测 3xx）
export function checkRedirect(status: number, location: string | null):
  | { ok: true }
  | { ok: false; code: "RELAY_REDIRECT_DENIED"; reason: string };

// 4) CSP（从 ALLOWED_ORIGINS 派生，保证与 relay 同源）
export function buildCsp(): string;
```

**`ALLOWED_ORIGINS` 构造（约 12 行）**
```
const FRONTEND_ONLY_ORIGINS = [
  "https://ark.cn-beijing.volcesengine.com", // 前端 llm.ts:34 豆包 base 与后端 providers.ts:26 漂移；两者都放行
];
// 遍历 Object.values(PROVIDERS) → new URL(p.baseURL).origin（沿用 index.ts:48 现有写法）
// 叠加上面的常量
// 叠加 process.env.RELAY_ALLOWED_ORIGINS?.split(",") → 逐项 new URL(trim).origin，非法项 log.warn 后跳过
// 返回冻结的 Set（去重靠 Set，顺序无关）
```

**`isAllowedRelayUrl` 逐条校验（约 18 行，顺序即优先级）**
1. `typeof raw !== "string"` 或空串 → `RELAY_BAD_URL`（"缺少 url"）。
2. `new URL(raw)` 失败 → `RELAY_BAD_URL`（"目标地址无法解析"）。**不传 base**，故无 protocol 的 `//evil.com`、`api.openai.com/v1` 都会解析失败并被拒。
3. `u.protocol !== "http:" && !== "https:"` → `RELAY_BAD_URL`（挡 `javascript:` / `file:` / `data:` / `ftp:`）。
4. `u.username || u.password` → `RELAY_BAD_URL`（挡 `https://user:pw@api.openai.com/…`；**注意 `https://api.openai.com@evil.com/` 的 origin 实为 `evil.com`，会被第 6 步拒绝，但显式拒绝凭证可读性更好**）。
5. 取 `u.origin` —— `new URL()` 已自动完成**大小写归一**、**默认端口归一**（`:443`/`:80` 被移除）、**IDN punycode**；**尾点域名**（`api.openai.com.`）归一后仍是带点的 origin → 不匹配 → 拒绝（fail-closed，符合预期）。
6. `ALLOWED_ORIGINS.has(u.origin)` 为 false → `RELAY_ORIGIN_DENIED`，带 `origin` 字段。
7. 否则返回 `{ ok:true, url:u }`。

> **按 origin 而非 URL/路径前缀**：19 家路径各不相同（`/v1/chat/completions`、`/api/paas/v4/...`、`/v1beta/models/...`、`/oauth/2.0/token`、`/rpc/2.0/...`），路径前缀无法统一；origin 比较天然放行文心 token 换取、各家 `/models` 拉取、openrouter 二级兜底（`:648`）等全部既有链路。

**`checkRedirect`（约 6 行）**：`status` ∈ {301,302,303,307,308} → 一律返回 `RELAY_REDIRECT_DENIED`（**fail-closed，不自动跟随、不白名单化 Location**）；其余返回 ok。

> **重定向决策**：`fetch` 默认 `redirect:"follow"` 会先打到白名单域名、再被 302 引到内网——**SSRF 在校验之后仍会发生**，所以「校验重定向后的 origin」不足够。改为在 `handleRelay` 传 `redirect:"manual"`，凡 3xx 用 `checkRedirect` 判拒。代价：若某厂商真的对 API 路径返回 3xx，该调用会失败（返回清晰 403）；个人工具、19 家主流 chat/completions 与 /models 均非常规重定向场景，**取舍偏向安全**。§7 列为风险并给出观测方法。

**`buildCsp()`（约 18 行）**：原样搬 `index.ts:45-63` 的指令数组，仅把 `hosts` 的构造替换为 `["'self'", ...ALLOWED_ORIGINS]`。**其余指令逐字不动**（`script-src 'self' 'unsafe-inline'` 等），避免改动 XSS 面。

### 1.2 修改 `site/server/src/index.ts`

| 位置 | 改法 |
|------|------|
| `:14` 附近 | 新增 `import { ALLOWED_ORIGINS, isAllowedRelayUrl, checkRedirect, buildCsp } from "./relay-allowlist.js";` |
| `:45-63` | **删除**整个本地 `buildCsp()` 函数体（19 行） |
| `:64` | 保留 `const CSP = buildCsp();`（改为调用导入的函数） |
| `:130` 注释 | 把「不做 SSRF 白名单闸门」改为「仅转发已知模型厂商 origin（与 CSP 同源）」 |
| `:135-136` 之后 | 插入校验（约 8 行）：<br>`const chk = isAllowedRelayUrl(url);`<br>`if (!chk.ok) return sendJSON(res, 403, { error: chk.reason + "。" + <可操作后缀>, code: chk.code, ...(chk.origin ? {origin: chk.origin} : {}) });` |
| `:145-150` | `fetch(url, {...})` 改为 `fetch(chk.url.toString(), { ..., redirect: "manual" })`（用归一后的 URL；**保留** method/headers/body/signal/AbortController 全部原样） |
| `:151` 之前 | 插入 3xx 判定（约 5 行）：<br>`const red = checkRedirect(upstream.status, upstream.headers.get("location"));`<br>`if (!red.ok) return sendJSON(res, 403, { error: red.reason, code: red.code });` |

**拒绝文案（中文、可操作）**
| code | `error` 文案 |
|------|-------------|
| `RELAY_BAD_URL` | `目标地址无效（仅支持 http/https 的已知模型厂商域名）：<原因>` |
| `RELAY_ORIGIN_DENIED` | `目标域名不在允许列表：<origin>。/relay 仅转发已知模型厂商域名；若使用自定义服务商，请在服务端 .env 配置 RELAY_ALLOWED_ORIGINS 并重启，或到「设置」关闭『通过代理服务器调用』。` |
| `RELAY_REDIRECT_DENIED` | `目标返回重定向，已拒绝转发（防止跳转到非白名单地址）：<location>。请检查该服务商的接口地址。` |

> **不改变**：`sendJSON` 签名、`SEC_HEADERS`、`corsOrigin`、透传头清洗（`:138-140`）、SSE 流式回传（`:151-158`）、502 兜底（`:159-160`）、路由注册（`:393`）。**恒不改** `handleRelay` 的成功路径数据结构，前端解析不变。

### 1.3 验收方式（可判定）

| # | 判定 |
|---|------|
| A1 | 19 个内置 origin + 豆包前端 origin 的任意路径 URL 全部通过；`http://169.254.169.254/latest/meta-data/`、`http://127.0.0.1:8000/healthz`、`http://localhost:9222/json` 全部 403 |
| A2 | `buildCsp()` 输出的 `connect-src` 与 `ALLOWED_ORIGINS` **逐项相等 + `'self'`**（同源性断言） |
| A3 | 打开「使用代理」+ 豆包，能正常 chat（证明纠正 1 未回归）；直连模式豆包不再被 CSP 拦（纠正 2） |
| A4 | 文心 token 换取、各家 `/models`、OpenRouter 二级兜底（`:648`）在代理模式下全部照常工作 |
| A5 | 协议/凭证/大小写/默认端口/尾点/重定向 6 类混淆用例全绿（§6） |
| A6 | `cd site/server && npx tsc --noEmit` + `cd site && npx tsc --noEmit` 通过；106 个既有用例全绿 |

---

## §2 P0-3 · 失败可解释

**对应 ADR 基线**：#4 失败可解释（关键反例即本项）、#1 链路闭环（「结果 → 可查看 → 可回退/重试」）。

### 2.1 错误最终在哪里呈现（已定位，**全部复用 `e.message`，零 view 改动**）

> ✅ **团队补充事实已核实并采纳**：错误确实通过 `(e as any).message` **原样展示**；`views/generate.ts:92-93` 是
> `live.textContent += "\n\n✗ 生成失败：" + (e as any).message` 与 `msg.textContent = "生成失败：" + (e as any).message`，
> 对应 catch 在 `:58-59`（内层兜底）与 `:87`（外层）。项目虽有统一轻提示 `core/ui.ts:47` 的 `toast(msg, duration)`，
> 但 **generate 流程直接写 DOM 文案、不走 toast** —— 这不影响本方案（两者都读 `message`）。

| 呈现点 | 代码 |
|--------|------|
| 设置页「测试连接」 | `llm.ts:597-598` `testConnection` 捕获后返回 `{ok:false, error: e.message}` → `views/settings.ts:118 / :122` 显示 |
| 生成页（外层 catch） | `views/generate.ts:87` → `:92-93` `✗ 生成失败：` + `(e as any).message`（**直接写 DOM，非 toast**） |
| 详情页（试跑/增强） | `views/detail.ts:545-551`、`:646-652` |
| 改写页 | `views/refine.ts:77-82` |
| 示例预览 | `views/preview.ts:116-124`（`toast("示例预览失败：" + msg)`，`e.message` 回退 `String(e)`） |
| 优化页 | `views/optimize.ts:386-389` `toast("优化中断：" + e.message)` |
| toast 通道 | `core/ui.ts:47-54` `toast(msg)` |

> **结论（确认团队推论）**：所有通道都读 `Error.message`。因此**只要在统一入口 `relayFetch()` 把网络层异常包装成信息量充足的 `Error`，全站提示自动变好**，无需新增 UI 结构、无需重构错误处理、无需改任何 view。**最小改动点确为 `site/src/llm.ts:161-178` 的 `relayFetch()`**。

#### 2.1.1 核查中补出的两个细节（会影响实现正确性，务必带上）

**① 内层「服务端不可用 → 浏览器直连兜底」catch 带关键字正则**
- `views/generate.ts:58-66`、`views/refine.ts:66-71`：先 `try` 服务端 Agent（`/agent/*`，**不走 relayFetch**），失败后内层 catch 用
  `/API 错误|401|Authentication|api ?key|invalid|key/i.test(m)` 判断——命中则 `throw e`，否则打印「服务端 Agent 暂不可用…已自动改用浏览器直连生成」并回退到 `generateTemplate` / `refinePromptDirect`（**这两个走 relayFetch**）。
- **对 P0-3 的影响**：
  - 代理开启但后端未启动时，`generateViaAgent` 先失败 → 内层回退 → `generateTemplate` 经 `relayFetch` 再失败 → 我们包装的友好 Error 落到**外层 catch `:87`**，最终 `:92-93` 显示可操作提示。**链路成立**。
  - ⚠️ **包装文案不得包含上述正则的任一关键字**（尤其 `key` / `invalid` / `401`），否则内层 catch 会在第一轮就 `throw e`、跳过兜底，改变既有行为。§2.2 定稿文案「无法连接本地后端代理 …请确认后端已启动…关闭『通过代理服务器调用』」**不含**这些关键字（已核对）。
  - ⚠️ 拼接原始 `e.message` 时也要注意：网络层异常通常是 `Failed to fetch` / `fetch failed`，不含关键字；但为稳妥，验收 B1 需覆盖「代理开启 + 后端未启动 + 从生成页进入」这条完整链路。

**② 部分 view 有 `signal.aborted` 守卫、部分没有 → `AbortError` 排除仍不可省**
- 有守卫：`generate.ts:88-90`、`detail.ts:546-548`、`refine.ts:78-79`、`preview.ts:117-119` → 用户中断时显示「■ 已停止…」，**不读 message**。
- **无守卫**：`optimize.ts:386-389`（一律 `⚠️ 已中断：` + `e.message` + toast）、`settings.ts:120-122`。若把 `AbortError` 误包装成「后端未启动」，优化页与设置页会给出误导提示。
- ⇒ §2.2 的 `if (signal?.aborted || e.name === "AbortError") throw e;` **是必需项，不是可选优化**。

### 2.2 修改 `site/src/llm.ts:161-178` 的 `relayFetch()`（**唯一改动文件**）

在代理分支 `if (s.useProxy && base) { ... }` 内做 3 处加行：

**(1) 网络层异常包装（约 7 行）** —— 把 `:165-170` 的 `return fetch(...)` 包进 `try/catch`：
```
let r: Response;
try {
  r = await fetch(base + "/relay", { ...原样参数... });
} catch (e) {
  // 用户主动「停止生成」不包装，保持 AbortError 原语义
  if (signal?.aborted || (e as any)?.name === "AbortError") throw e;
  throw new Error(
    "无法连接本地后端代理 " + base + "/relay：" + ((e as any)?.message || "网络不可达") +
    "。请确认后端已启动（cd site/server && npm start），或到「设置」关闭『通过代理服务器调用』改为直连厂商。"
  );
}
```
> ⚠️ **必须排除 `AbortError`**：`signal` 用于流式中断（`:160` 注释、各 `callChatStream` 传 signal）。用户点「停止生成」时 `fetch` 也抛异常，若一律包装成「后端未启动」会误导。

**(2) 白名单 403 的可操作提示（约 6 行）** —— 紧接 try/catch 之后、`return r` 之前：
```
if (r.status === 403) {
  const probe = r.clone();                       // clone 避免消费原 body
  const j = await probe.json().catch(() => null);
  if (j && j.code && /^RELAY_/.test(j.code)) {
    throw new Error(j.error || "代理拒绝转发该请求");
  }
}
return r;
```
> ⚠️ **必须区分「后端自己拒绝」与「厂商返回 403」**：上游厂商（如 Key 无效）也会返回 403 且被 relay 原样转发。用 `r.clone()` + 检查稳定的 `code: RELAY_*` 前缀来区分；不匹配就**原样 return r**，不读原 body、不改既有 `API 错误 403：…` 提示。

**(3) 直连分支 `:172-177` 完全不动** —— 直连厂商的失败不是「代理不通」，保持原样。

### 2.3 「代理不通」vs「厂商返回错误」的区分（明确口径）

| 场景 | 表现 | 处理 |
|------|------|------|
| 后端未启动 / `proxyBase` 填错 / 网络不可达 | `fetch(base+"/relay")` **抛 TypeError** | 包装成「无法连接本地后端代理 …请确认后端已启动，或关闭使用代理」 |
| 后端在跑但拒绝非白名单域名 | relay 返回 **403 + `code: RELAY_*`** | 转成后端给的中文可操作文案 |
| 后端在跑、白名单通过、厂商报错（401/429/500/甚至 403） | relay **原样转发** Response，`r.ok === false` | **不包装**，由各 callsite 现有 `API 错误 <status>：<body>` 呈现 |
| 用户主动中断 | `AbortError` / `signal.aborted` | 原样抛出，不包装 |

> ✅ **团队要求的两点，逐条确认（无需纠正推论）**：
> 1. **直连厂商分支不得误包**：`relayFetch` 的 `if (s.useProxy && base)` 之外的 `:172-177` 分支**完全不动**，其 `fetch(url, …)` 抛错仍是原始 `TypeError`（如 CORS / 厂商不可达），**不会**被写成「后端未启动」。try/catch 的作用域严格限制在代理分支内部。
> 2. **厂商 HTTP 错误不得被吞掉或改写**：HTTP 错误是 `fetch` **成功返回** `Response`（`r.ok === false`），**不进 catch**；`relayFetch` 原样 `return r`，由既有 callsite（如 `llm.ts:168` `if (!r.ok) { const t = await r.text(); throw new Error("API 错误 " + r.status + "：" + t.slice(0,200)); }`）产生原有提示。唯一的例外是 **403 且响应体带 `code: RELAY_*`**（后端自己拒绝），此时才转成可操作文案；其余 403（含厂商 403）一律原样返回。

### 2.4 验收方式（可判定）

| # | 判定 |
|---|------|
| B1 | 设置页勾选「使用代理」且**不启动后端** → 点「测试连接」，提示含「无法连接本地后端代理」+「请确认后端已启动」+「关闭…使用代理」，**不再出现裸 `network error` / `Failed to fetch`** |
| B2 | 后端启动 + 通过 `/relay` 请求非白名单 URL → 提示含「目标域名不在允许列表」与 `RELAY_ALLOWED_ORIGINS` 指引（**不**误报「后端未启动」） |
| B3 | 后端启动 + 填错 Key 直连/代理 → 仍显示 `API 错误 401：…`，**不**被误判为代理故障 |
| B4 | 生成中点「停止生成」→ 不再弹出「无法连接后端」类误导提示（重点验 `optimize.ts:388-389` 与 `settings.ts:120-122` 这两个**无 abort 守卫**的入口） |
| B5 | `cd site && npx tsc --noEmit` 通过；106 个既有用例全绿 |
| B6 | **完整兜底链路**：代理开启 + 后端未启动 + 从生成页点「生成」→ 内层 `generate.ts:58-66` 先回退到 `generateTemplate`，外层 `:87/:92-93` 最终显示「无法连接本地后端代理…请确认后端已启动…关闭使用代理」；且内层正则**未**因包装文案提前 `throw`（仍能走到回退分支） |
| B7 | **直连分支不误包**：关闭「使用代理」、厂商域名不可达 → 提示仍为原始网络错误文案，**不含**「后端 /relay / 使用代理」等字样 |

---

## §3 P0-4(a) · failover 重试记录的计数口径

**对应 ADR 基线**：#2 数据可信（口径自洽、分母明确、噪声可见）、#1 链路闭环。

### 3.1 代码事实（先厘清，与上游倾向有出入）

| 事实 | 证据 |
|------|------|
| `·attempt` 与 `llm:failover` **是根 run** | `langsmith.ts:174-177`（`recordProviderAttempt` 的 `lsStart(..., null, ...)`）、`:192`（`recordFailover` 同）；`:163`/`:187` 注释明写「parent=null，不归属任何具体流程 run（进程级遥测）」 |
| 它们是**同一次模型调用的重复记录**，不是额外一次调用 | 每次 `chatPrimary` 成功/失败都会 `recordProviderAttempt`；**同一次调用同时**已由 `providers.ts:359-361` 建了一条 `…·llm` 子 run（重试为 `…·llm#2/#3`，见 `:399-406`） |
| `llmCallCount` **已经**计入了每一次真实 LLM 请求 | `stats.ts:509-511` = 各 `kind==="llm"` 组的 `run_count` 之和；`buildGroups` 用 `isLlmRunName` (`stats.ts:176-178`) 匹配 `·llm(#…)?` 并 `canonicalName` 归并求和 → **重试的 `#2/#3` 也被计入** |
| `·attempt` **当前已被分组层丢弃** | `stats.ts:382-390`：`·attempt` 既不白名单 flow 名、也不匹配 `·llm` 后缀 → `continue`。`tests/stats.test.ts:421/:439/:464/:489` 已有断言 |
| **但 `rootRunCount` 仍包含它们** | `stats.ts:456` 的 `fetchRootRuns` 只过滤 `isNoise()`（`:91` 的 5 个探针前缀），`·attempt` 不在其中 → `stats.ts:516` `rootRunCount = queryOut.runs.length` 把它们算进「调用次数」 |

### 3.2 口径建议（**对上游倾向的一处修正**）

> 上游倾向：「重试应从『调用次数』排除，但**保留在 `llmCallCount` 中**，因为它确实是一次真实 LLM 请求」。
> **我的结论：前半句正确且必须做；后半句不需要做、做了反而错。**

**理由**：`llmCallCount` 统计的是 `·llm` 子 run，而每一次真实模型调用（含重试）**都已有一条 `·llm` 子 run**。`·attempt` 是 `recordProviderAttempt` 为**同一次调用**额外写的第二条进程级遥测记录，把它加进 `llmCallCount` 会造成**同一请求被计两次**。因此：

**定稿口径**
| 指标 | 口径 |
|------|------|
| **调用次数 `rootRunCount`** | 只数**业务流程根 run**（13 个白名单 flow 名）；**排除** `·attempt` 与 `llm:failover` |
| **模型请求 `llmCallCount`** | **保持不变**（= 所有 `·llm` 子 run，已含重试），**不加** `·attempt` |
| `runCount`（遥测区「含子调用」） | 不变（分组求和） |
| 成功/失败/未完成、`errorRate`、`pendingRate` | 与 `rootRunCount` **共用同一份过滤后的 `runs` 数组** |

**对 `errorRate` 的影响（正向，且是必须做的理由）**
- `langsmith.ts:179` 在**失败**的 provider 尝试上写 `error: ...`（`lsEnd` 的 `opts.error`）→ 该 `·attempt` 根 run 在 LangSmith 侧很可能是 `status:"error"`。**即使该流程随后重试/failover 成功**，这条 error 仍计入分子 → **错误率虚高**。
- `recordFailover(true)`（`:192-194`）写 `outputs:{ok}` 无 error → 一条虚假 `success` 抬高分母 → 错误率被稀释。
- 排除二者后，`errorRate` 才真正反映**业务链路成败**，符合 ADR #2。

**对 `rootRunCount === successCount + errorCount + pendingCount` 自洽性的影响**
- **不受破坏**：`stats.ts:512` 的 `statusDistribution(queryOut.runs)` 与 `:516` 的 `queryOut.runs.length` 用的是**同一个数组**；在 `fetchRootRuns` 内统一过滤，两者同增同减，恒等式保持（`tests/stats-view.test.ts:36` 与 `stats.test.ts:575-580` 已有此断言）。
- ⚠️ **发现一个既有潜在破口**（顺带说明，不强求本轮修）：`statusDistribution`（`:202-211`）的 `total = runs.length`，但只累加 `success/error/pending` 三种已知 status；若出现未知 status，等式会破。**建议顺手加 1 行**：未知 status 归入 `pending`（fail-safe，语义「未完成/未知」）。若不改，需在验收里明确「实测样本未见未知 status」。

### 3.3 最小改法（**只改 `site/server/src/stats.ts` 一个文件，约 12 行**）

| 位置 | 改法 |
|------|------|
| `:168` 后（`isNoise` 之后） | **新增纯函数并导出**（约 4 行）：<br>`export function isTelemetryRoot(name: string): boolean {`<br>`  const n = String(name ?? "");`<br>`  return /·attempt$/i.test(n) \|\| n === "llm:failover";`<br>`}`<br>**只匹配这两个**，精确对应 `langsmith.ts` 中两个 `parent=null` 的 fire-and-forget 埋点；**不要**纳入 `·tool`（`chatWithTools` 的 tool run 有 `lsParentRunId`，非根 run，且是一次真实 LLM 调用） |
| `:454-458` | 把 `fetchRootRuns` 的一次 filter 拆成两次（约 3 行）：<br>`const withoutNoise = allRuns.filter(r => !isNoise(r?.name ?? ""));`<br>`const filteredNoiseCount = allRuns.length - withoutNoise.length;`<br>`const runs = withoutNoise.filter(r => !isTelemetryRoot(r?.name ?? ""));`<br>**`filteredNoiseCount` 仍只数探针**（P0-4(b) 的顶部提示条语义不变、数字不变） |
| `:451`（失败早退分支） | 不动（已返回 `filteredNoiseCount:0`） |
| `:456` 上方注释 | 补一句「`·attempt`/`llm:failover` 为进程级遥测，不计入业务调用次数」 |

**不改**：`StatsTotals` 接口、`QueryOutcome`、`emptyTotals`、`getStats` 的 totals 组装（`rootRunCount` 自动变小）、前端契约、任何 API 字段。→ **零前端改动、零破坏性变更**。

**口径可见性**：在 P0-4(b) 上移后的顶部提示条里加一句静态说明「调用次数不含重试与运维遥测记录」（见 §4），无需新增字段即可做到「分母明确」。

### 3.4 验收方式（可判定）

| # | 判定 |
|---|------|
| C1 | 新增离线用例：`queryResponse.runs` = 12 条业务 + 1 条 `deepseek·deepseek-chat·attempt`(status:error) + 1 条 `llm:failover`(status:success) + 5 条探针 → `rootRunCount === 12`、`filteredNoiseCount === 5`、`errorRate === 0`（**attempt 的 error 不得抬升错误率**） |
| C2 | `llmCallCount` 在改动前后**数值不变**（同一份 `REAL_MACHINE_GROUPS`），证明未重复计数 |
| C3 | `rootRunCount === successCount + errorCount + pendingCount` 恒等（复用 `stats.test.ts:607-621` 的自洽断言，加 telemetry 样本再跑一遍） |
| C4 | **106 个既有用例全绿**：现有 fixtures（`stats.test.ts:541-548` 等）的根 run 名均为 `agent:refine` / 探针，**不含 `·attempt`/`llm:failover`**，故不受影响（已核对） |
| C5 | 真机反查一条 `·attempt` run 的 `status`（`/runs/query`）确认是否确为 `error`，验证 §3.2 的推断；若为 `success`，C1 仍应通过（口径结论不变） |

---

## §4 P0-4(b) · 「已过滤 N 条探针」提示条上移

**对应 ADR 基线**：#2 数据可信（「噪声可见」，用户看不到的告知等于没有）、#7 决策可追溯。

### 4.1 现状

- `views/stats.ts:528-530` 的 `noiseNote` 只出现在 `renderTelemetry()`（`:521-545`）里，而该函数被塞在 `:395-400` 的 `<details>运维遥测（点击展开）</details>` 内 → **默认折叠，用户基本看不到**。
- `t.filteredNoiseCount` 已由 `normalizeTotals`（`:225-262`，`:235` 缺省 0）透传到 `StatTotals`（`:127`），**无需新增任何数据字段**。

### 4.2 最小改法（**只改 `site/src/views/stats.ts`，约 8 行；不动设计系统**）

| 位置 | 改法 |
|------|------|
| `:374-376`（`warnBar` 定义处）之后 | **新增 `noiseBar`**（约 4 行），复用现有 `.pill-amber` 与 `warnBar` 完全相同的内联样式：<br>`const noiseBar = (t.filteredNoiseCount != null && t.filteredNoiseCount > 0)`<br>`  ? \`<div class="pill-amber" style="display:inline-block;padding:6px 12px;border-radius:10px;font-size:.8rem;margin-bottom:12px;">已过滤 \${esc(fmtInt(t.filteredNoiseCount))} 条探针噪声，不计入上方统计；调用次数不含重试与运维遥测记录</div>\``<br>`  : "";` |
| `:381-382`（`return \`` 之后第一行 `${warnBar}`） | 紧跟插入 `${noiseBar}`（两个块级 div 各带 `margin-bottom:12px`，自然竖排；**不新增容器、不新增组件、不改 `styles.css`**） |
| `:527-530` | **删除** `noiseNote` 常量 |
| `:537` | **删除** `["噪声过滤", noiseNote \|\| …]` 这一行（信息已在顶部，避免重复） |

**视觉合规**：`.pill-amber`（`styles.css:210`，描金底 `#f7efdd` / 字 `#8a6320`）是现有类；不改 `:root` 令牌、无紫蓝渐变、无红绿涨跌、无 Inter。

**可选（推荐，1 个纯函数 + 1 个单测）**：把 `noiseBar` 的模板抽成导出的纯函数 `renderNoiseBar(count: number | null): string`，供 `tests/stats-view.test.ts` 离线断言「count>0 时含『已过滤 N 条探针噪声』、count=0 时返回空串」。这**不是新增 UI 组件**，只是把现有字符串提取为可测纯函数，符合 ADR #7 的离线回归要求。

### 4.3 验收方式（可判定）

| # | 判定 |
|---|------|
| D1 | 打开 `#/stats`（有探针数据时），**无需展开任何折叠区**，首屏顶部即可见「已过滤 N 条探针噪声」；N 与 `totals.filteredNoiseCount` 一致 |
| D2 | N=0 时不渲染任何提示条（不出现「已过滤 0 条」） |
| D3 | 折叠区展开后不再重复出现同一条噪声说明 |
| D4 | `cd site && npx tsc --noEmit` 通过；`tests/stats-view.test.ts` 既有用例全绿 + 新增 `renderNoiseBar` 用例通过 |

---

## §5 任务分解（有序、可直接派工）

### 5.1 依赖与并行关系

```
T01 (P0-2 后端白名单：新增 relay-allowlist.ts + 改 index.ts)  ──┐
T02 (P0-2 离线测试：新增 tests/relay-allowlist.test.ts)      ←──┘ 依赖 T01
T03 (P0-3 前端 relayFetch 包装：改 llm.ts)                     ←── 依赖 T01（需 T01 的 403 code 契约定稿）
T04 (P0-4a 口径：改 stats.ts + tests/stats.test.ts)             独立，可与 T01/T02/T03 全并行
T05 (P0-4b 提示条：改 views/stats.ts + tests/stats-view.test.ts) 独立，可与 T01~T04 全并行
T06 (README 同步 + 全量验收)                                    ← 依赖 T01~T05 全部完成
```

**文件不重叠，可并行**：T04（`stats.ts` + `tests/stats.test.ts`）、T05（`views/stats.ts` + `tests/stats-view.test.ts`）与 T01（`relay-allowlist.ts` + `index.ts`）/T02（新测试文件）/T03（`llm.ts`）**零文件重叠** → **T01、T04、T05 可同时开工**。

**必须串行**：
- T02 依赖 T01（纯函数先存在才能测）。
- T03 依赖 T01（前端要识别的 `code: RELAY_*` 由 T01 定稿；建议 T01 先落地 403 body 再写 T03，但仅契约依赖，可先按本文档约定编码）。
- T06 依赖全部（README 要写最终结果 + 全量回归）。

### 5.2 任务卡

#### **T01 · P0-2 后端 `/relay` 最小白名单** — P0
- **基线**：ADR #5、#4、#7
- **文件**：新增 `site/server/src/relay-allowlist.ts`；改 `site/server/src/index.ts`（`:14 / :45-64 / :130 / :135-150 / :393 不动`）
- **改哪个函数 / 加哪几行**：见 §1.1（新文件 4 个导出，约 54 行）、§1.2（index.ts 删 19 行 + 加约 15 行）
- **完成标准**：§1.3 A1–A4、A6
- **风险**：`redirect:"manual"` 可能拒绝个别厂商 3xx（§7 R1）；豆包 origin 漂移（§0.2 纠正 1）必须覆盖

#### **T02 · P0-2 离线回归测试** — P0（信任边界改动，必做）
- **基线**：ADR #7
- **文件**：新增 `site/server/tests/relay-allowlist.test.ts`（纯函数，零网络）；新增 `site/server/tests/relay-endpoint.test.ts`（子进程真 HTTP，仿 `agent-trace-endpoint.test.ts`）
- **用例**：§6.1 全部 11 类 + §6.2 的 4 个 HTTP 用例
- **完成标准**：§1.3 A1/A2/A5；`npx tsx --test tests/*.test.ts` 全绿（106 + 新增）
- **依赖**：T01

#### **T03 · P0-3 `relayFetch` 错误包装** — P0
- **基线**：ADR #4、#1
- **文件**：**仅** `site/src/llm.ts:161-178`
- **改哪个函数 / 加哪几行**：见 §2.2（约 13 行；`try/catch` + `AbortError` 排除 + `clone()` 403 探测；直连分支不动）。**实现约束**：包装文案不得含 `generate.ts:61` / `refine.ts:68` 内层正则的关键字（`key`/`invalid`/`401` 等），否则会跳过既有兜底分支（§2.1.1 ①）；`AbortError` 排除为必需项（§2.1.1 ②）
- **完成标准**：§2.4 B1–B7（含 B6 完整兜底链路、B7 直连不误包）
- **依赖**：T01（403 code 契约）

#### **T04 · P0-4(a) failover 计数口径** — P0
- **基线**：ADR #2、#1
- **文件**：`site/server/src/stats.ts`（`:168 后 / :454-458 / :456 注释`）、`site/server/tests/stats.test.ts`（新增 2 个用例）
- **改哪个函数 / 加哪几行**：见 §3.3（约 12 行）
- **完成标准**：§3.4 C1–C5
- **依赖**：无（可并行）

#### **T05 · P0-4(b) 提示条上移** — P0
- **基线**：ADR #2、#7
- **文件**：`site/src/views/stats.ts`（`:374-382 / :527-530 / :537`）、`site/server/tests/stats-view.test.ts`（新增 1~2 用例）
- **改哪个函数 / 加哪几行**：见 §4.2（约 8 行 + 可选纯函数）
- **完成标准**：§4.3 D1–D4
- **依赖**：无（可并行）

#### **T06 · README 同步 + 全量验收** — P0
- **基线**：ADR #7（「每次实质改动同步 README」）
- **文件**：`README.md`
- **改法（3 处）**：
  1. `:87` 「代理 `/relay` 为本地转发用途，请勿将服务端口直接暴露到公网」→ 改为「`/relay` 仅转发已知模型厂商 origin（与 CSP 同源），自定义服务商可用 `RELAY_ALLOWED_ORIGINS` 扩展；仍不建议公网暴露」。
  2. `:64` 错误率口径段后补一句：「调用次数只统计业务流程，重试与运维遥测记录单列、不重复计数」。
  3. `:77` 技术栈后端描述补 `/relay` 白名单一句。
- **完成标准**：§7 全量验收清单通过；README 与实际行为一致
- **依赖**：T01~T05

---

## §6 测试策略

### 6.1 P0-2 必须新增的离线用例（信任边界）

**A. 纯函数层 `tests/relay-allowlist.test.ts`（零网络、可安全 import 新模块）**

| 类别 | 用例 |
|------|------|
| 白名单命中 | 遍历 `ALLOWED_ORIGINS` 全成员，`origin + "/any/deep/path?x=1"` 全部 `{ok:true}`；含文心 token 路径、各家 `/models`、openrouter 兜底路径 |
| 白名单拒绝 | `http://169.254.169.254/latest/meta-data/`（云元数据）、`http://127.0.0.1:8000/healthz`、`http://localhost:9222/json`、`https://evil.com` → `RELAY_ORIGIN_DENIED` 且 `origin` 字段正确 |
| 协议混淆 | `javascript:alert(1)`、`file:///etc/passwd`、`data:text/plain,x`、`ftp://x` → `RELAY_BAD_URL` |
| 无 protocol | `//evil.com/v1`、`api.openai.com/v1/chat/completions` → 解析失败 → `RELAY_BAD_URL` |
| 大小写 | `HTTPS://API.OPENAI.COM/v1/...` → 命中 |
| 默认端口归一 | `https://api.openai.com:443/v1` → 命中；`https://api.openai.com:8443/v1` → 拒绝 |
| 凭证混淆 | `https://api.openai.com@evil.com/v1` → 拒绝；`https://user:pw@api.openai.com/v1` → 拒绝 |
| 尾点 / IDN | `https://api.openai.com./v1` → 拒绝（fail-closed） |
| **重定向** | `checkRedirect(302, "http://169.254.169.254/")` → `RELAY_REDIRECT_DENIED`；`checkRedirect(302, "https://api.openai.com/v2")` → **仍拒绝**（不自动跟随）；`checkRedirect(200, null)` → ok |
| **CSP 同源性** | 从 `buildCsp()` 解析 `connect-src`，断言 = `{'self'} ∪ ALLOWED_ORIGINS`（逐项相等，无多余项）；断言**不含** `169.254.169.254` / 任意 localhost 通配 |
| env 扩展 | 起测试前设 `RELAY_ALLOWED_ORIGINS="http://127.0.0.1:19999,not-a-url"`（模块需重新 import 或用 `import(cache-bust)`）→ 命中前者、后者被跳过且 CSP 同步含该 origin |

**B. HTTP 层 `tests/relay-endpoint.test.ts`（子进程真起服务器 + 真 HTTP，仿 `agent-trace-endpoint.test.ts`）**
- 用 `RELAY_ALLOWED_ORIGINS` 把白名单指向**本机 mock HTTP server**（`http://127.0.0.1:<freeport>`）→ **全程离线零外网**。
- 用例：① POST `/relay` 到 mock origin → 200 且 body 原样透传（命中）；② POST `/relay` 到 `http://127.0.0.1:<另一个端口>` → **403 + `code: RELAY_ORIGIN_DENIED`**，且 mock 服务器**未收到任何请求**（证明在 fetch 前拦截）；③ mock 返回 302 → 403 + `code: RELAY_REDIRECT_DENIED`；④ 非法 JSON / 缺 url → 保持现有 400 行为不变。
- 额外断言：响应仍带 `SEC_HEADERS`（`content-security-policy` 存在）。

### 6.2 是否会破坏现有 106 用例（结论：**不会**，已核对）

| 改动 | 影响面 | 结论 |
|------|--------|------|
| T01 移走 `buildCsp` | 现有测试中 **无一处** 引用 `/relay` / `buildCsp` / `connect-src`（已 grep 全 `tests/` 确认无匹配）；端点测试走子进程，只打 `/healthz` 与 `/agent/trace` | 无破坏 |
| T01 改 `handleRelay` | 同上，无测试打 `/relay` | 无破坏 |
| T03 改 `relayFetch` | 前端 `llm.ts` 未被任何 server 测试 import；`stats-view.test.ts` 只 import `views/stats.ts` | 无破坏 |
| T04 改 `fetchRootRuns` | `stats.test.ts` 所有 fixture 的根 run 名是 `agent:refine` / 5 种探针 / 无 name 的 `{status}`，**不含 `·attempt`/`llm:failover`**（已逐个核对 `:541-548`、`:596-598`、`:610-619`） | 无破坏；`stats.test.ts:557`（rootRunCount=12）、`:607`（自洽断言）保持通过 |
| T05 改 `renderReport` | `stats-view.test.ts` 只测 `normalizeTotals`/`normalizeGroup` 纯函数，**未测渲染字符串** | 无破坏 |

**回归命令（T06 必跑）**
```bash
cd site/server && npx tsx --test tests/*.test.ts     # 期望 106 + 新增 全绿
cd site/server && npx tsc --noEmit
cd site && npx tsc --noEmit
```

---

## §7 风险与全量验收

| # | 风险 | 缓解 / 观测 |
|---|------|-------------|
| R1 | `redirect:"manual"` 拒绝 3xx，个别厂商若重定向会失败 | 文案明确告知；真机跑一遍 19 家主要 chat 路径 + `/models` 列表 + 文心 token；若确需跟随，**另开 ADR**，不在本轮加「逐跳校验循环」（过度工程） |
| R2 | 前端/后端 `doubao` origin 漂移（§0.2） | `FRONTEND_ONLY_ORIGINS` 同时放行两个 origin；**不修改** `llm.ts:34` 或 `providers.ts:26`（改任一侧都可能破坏直连或 `/agent/*` 服务端调用，本轮不动）。长期对齐另议 |
| R3 | env 扩展削弱「白名单可枚举」 | env 默认空；合法项须能被 `new URL` 解析为 http/https origin；非法项跳过并告警；同源喂给 CSP，集合仍可枚举 |
| R4 | P0-3 把厂商 403 误判成白名单拒绝 | `clone()` + `code: RELAY_*` 前缀双重判定；不匹配原样返回 |
| R5 | P0-4(a) 排除后 `errorRate` 变化被误读为「修复了故障」 | README `:64` 与顶部提示条写明口径；QA 记录改动前后数值 |
| R6 | `statusDistribution` 对未知 status 破坏恒等式（既有） | 建议 T04 顺手加 1 行「未知 → pending」；不加则 C5 实测确认无未知 status |

**全量验收清单（T06）**：A1–A6、B1–B5、C1–C5、D1–D4 全部可判定通过 + 三条命令全绿 + README 已同步。**不以「代码写完」为完成。**

---

## 附录：改动文件一览（共 10 个，其中 3 个新增）

| 文件 | 任务 | 动作 |
|------|------|------|
| `site/server/src/relay-allowlist.ts` | T01 | **新增** |
| `site/server/src/index.ts` | T01 | 改 |
| `site/server/tests/relay-allowlist.test.ts` | T02 | **新增** |
| `site/server/tests/relay-endpoint.test.ts` | T02 | **新增** |
| `site/src/llm.ts` | T03 | 改（仅 `relayFetch`） |
| `site/server/src/stats.ts` | T04 | 改 |
| `site/server/tests/stats.test.ts` | T04 | 改（加 2 用例） |
| `site/src/views/stats.ts` | T05 | 改 |
| `site/server/tests/stats-view.test.ts` | T05 | 改（加 1 用例） |
| `README.md` | T06 | 改 |
