// providers.ts
// 服务端 provider 抽象层，复用前端 llm.js 的 18 厂商协议（2026-07 在役模型）。
// 仅实现流式 chat（Agent 只需要生成），并统一归一化 usage。
// 设计：绝大多数为 OpenAI 兼容；Claude / Gemini / 文心 走各自原生协议。

import { recordProviderAttempt, recordFailover, LS_ENABLED, lsStart, lsEnd } from "./langsmith.js";

export type Style = "openai" | "claude" | "gemini" | "ernie";

export interface ProviderDef {
  id: string;
  label: string;
  style: Style;
  baseURL: string; // openai/claude: 接口前缀；gemini: v1beta 根；ernie: chat 前缀
  auth: "bearer" | "x-api-key" | "gemini-key" | "ernie-token";
}

// 精简版厂商表（前端已知模型名，服务端只负责转发 model 字符串）。
export const PROVIDERS: Record<string, ProviderDef> = {
  openai: { id: "openai", label: "OpenAI", style: "openai", baseURL: "https://api.openai.com/v1", auth: "bearer" },
  deepseek: { id: "deepseek", label: "DeepSeek", style: "openai", baseURL: "https://api.deepseek.com", auth: "bearer" },
  kimi: { id: "kimi", label: "Kimi", style: "openai", baseURL: "https://api.moonshot.cn/v1", auth: "bearer" },
  zhipu: { id: "zhipu", label: "智谱 GLM", style: "openai", baseURL: "https://open.bigmodel.cn/api/paas/v4", auth: "bearer" },
  tongyi: { id: "tongyi", label: "通义千问", style: "openai", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", auth: "bearer" },
  doubao: { id: "doubao", label: "豆包", style: "openai", baseURL: "https://ark.cn-beijing.volces.com/api/v3", auth: "bearer" },
  hunyuan: { id: "hunyuan", label: "混元", style: "openai", baseURL: "https://api.hunyuan.cloud.tencent.com/v1", auth: "bearer" },
  baichuan: { id: "baichuan", label: "百川", style: "openai", baseURL: "https://api.baichuan-ai.com/v1", auth: "bearer" },
  yi: { id: "yi", label: "零一万物", style: "openai", baseURL: "https://api.lingyiwanwu.com/v1", auth: "bearer" },
  grok: { id: "grok", label: "Grok", style: "openai", baseURL: "https://api.x.ai/v1", auth: "bearer" },
  mistral: { id: "mistral", label: "Mistral", style: "openai", baseURL: "https://api.mistral.ai/v1", auth: "bearer" },
  ollama: { id: "ollama", label: "Ollama", style: "openai", baseURL: "http://localhost:11434/v1", auth: "bearer" },
  openrouter: { id: "openrouter", label: "OpenRouter", style: "openai", baseURL: "https://openrouter.ai/api/v1", auth: "bearer" },
  groq: { id: "groq", label: "Groq", style: "openai", baseURL: "https://api.groq.com/openai/v1", auth: "bearer" },
  perplexity: { id: "perplexity", label: "Perplexity", style: "openai", baseURL: "https://api.perplexity.ai", auth: "bearer" },
  together: { id: "together", label: "Together", style: "openai", baseURL: "https://api.together.xyz/v1", auth: "bearer" },
  claude: { id: "claude", label: "Claude", style: "claude", baseURL: "https://api.anthropic.com/v1", auth: "x-api-key" },
  gemini: { id: "gemini", label: "Gemini", style: "gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta", auth: "gemini-key" },
  ernie: { id: "ernie", label: "文心一言", style: "ernie", baseURL: "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat", auth: "ernie-token" },
  // 别名：与前端 llm.js 的厂商 key 对齐（避免 /agent/* 因“未知服务商”被误判为不可用而回退直连）
  moonshot: { id: "moonshot", label: "Kimi（月之暗面）", style: "openai", baseURL: "https://api.moonshot.cn/v1", auth: "bearer" },
  qwen: { id: "qwen", label: "通义千问（阿里）", style: "openai", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", auth: "bearer" },
};

export function providerOf(id: string): ProviderDef {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`未知服务商: ${id}（支持: ${Object.keys(PROVIDERS).join(", ")}）`);
  return p;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalTokens: number;
}

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, totalTokens: 0 };
}

export function normUsage(u: Partial<Usage>): Usage {
  const input = u.inputTokens ?? 0;
  const output = u.outputTokens ?? 0;
  const cr = u.cacheReadTokens ?? 0;
  const cc = u.cacheCreateTokens ?? 0;
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cr, cacheCreateTokens: cc, totalTokens: u.totalTokens ?? input + output + cr + cc };
}

export interface ChatOpts {
  provider: string;
  model: string;
  apiKey: string;
  apiSecret?: string; // 文心用
  system: string;
  user: string;
  jsonMode?: boolean; // 强制模型输出合法 JSON（OpenAI 兼容 response_format: {type:"json_object"}）
  onToken?: (t: string) => void;
  signal?: AbortSignal;
  proxyBase?: string; // 用户若开启代理，服务端模型调用也走该代理的 /relay（避免服务端直连被墙导致 agent 失败回落）
  lsParentRunId?: string | null; // LangSmith：父 run id，每次模型调用会建一条子 run 上报
  // —— 韧性（P1 收尾）——
  maxRetries?: number;          // 覆盖默认重试次数（默认读 LLM_MAX_RETRIES，再默认 2）
  fallback?: FallbackSpec[];    // 主 provider 用尽重试仍失败时的主备切换列表（单发，不级联重试）
}

// 主备切换规格：主 provider 失败后，按顺序尝试这些 provider 完成本次生成。
// 通常由环境变量 LLM_FALLBACK_PROVIDERS 解析而来（服务端持有备用 Key），也可由调用方显式传入。
export interface FallbackSpec {
  provider: string;
  model: string;
  apiKey?: string;
  apiSecret?: string;
}

export interface ChatResult {
  text: string;
  usage: Usage;
  elapsedMs: number;
}

// ---- SSE 行解析 ----
async function readSSE(r: Response, onLine: (line: string) => void, signal?: AbortSignal): Promise<void> {
  if (!r.body) throw new Error("无响应体");
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.startsWith("data:")) onLine(line.slice(5).trim());
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
}

function authHeaders(p: ProviderDef, key: string): Record<string, string> {
  switch (p.auth) {
    case "bearer": return { Authorization: `Bearer ${key}`, "content-type": "application/json" };
    case "x-api-key": return { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
    default: return { "content-type": "application/json" };
  }
}

// 统一请求入口：若传入 proxyBase（用户代理），则把请求发往 `${proxyBase}/relay` 转发；否则直连上游。
// 这样 agent 的服务端模型调用与前端一样可走代理，避免服务端直连被墙导致 agent 失败、客户端误判“回退直连”。
async function doFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal | undefined,
  proxyBase?: string,
): Promise<Response> {
  if (proxyBase) {
    const base = proxyBase.replace(/\/$/, "");
    return fetch(`${base}/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, method, headers, body: body === undefined ? null : body }),
      signal,
    });
  }
  return fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    signal,
  });
}

async function ernieToken(apiKey: string, secret: string, signal?: AbortSignal): Promise<string> {
  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secret)}`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`文心 token 换取失败: ${r.status}`);
  const j = (await r.json()) as any;
  if (!j.access_token) throw new Error("文心 token 换取失败: " + JSON.stringify(j));
  return j.access_token as string;
}

// ---- OpenAI 兼容流式 ----
async function streamOpenAI(p: ProviderDef, model: string, key: string, opts: ChatOpts): Promise<ChatResult> {
  const url = `${p.baseURL}/chat/completions`;
  const body = {
    model,
    stream: true,
    max_tokens: 8192,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
  };
  const r = await doFetch(url, "POST", { ...authHeaders(p, key) }, body, opts.signal, opts.proxyBase);
  if (!r.ok) throw new Error(`[${p.label}] ${r.status} ${await r.text().catch(() => "")}`);
  let text = "";
  const usage = emptyUsage();
  await readSSE(r, (line) => {
    if (line === "[DONE]") return;
    try {
      const j = JSON.parse(line);
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) { text += delta; opts.onToken?.(delta); }
      if (j.usage) {
        usage.inputTokens = j.usage.prompt_tokens ?? usage.inputTokens;
        usage.outputTokens = j.usage.completion_tokens ?? usage.outputTokens;
        usage.totalTokens = j.usage.total_tokens ?? usage.totalTokens;
      }
    } catch { /* 跳过非 JSON 行 */ }
  }, opts.signal);
  return { text, usage: normUsage(usage), elapsedMs: 0 };
}

// ---- Claude 流式 ----
async function streamClaude(p: ProviderDef, model: string, key: string, opts: ChatOpts): Promise<ChatResult> {
  const url = `${p.baseURL}/messages`;
  const body = {
    model,
    max_tokens: 4096,
    stream: true,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  };
  const r = await doFetch(url, "POST", authHeaders(p, key), body, opts.signal, opts.proxyBase);
  if (!r.ok) throw new Error(`[${p.label}] ${r.status} ${await r.text().catch(() => "")}`);
  let text = "";
  const usage = emptyUsage();
  await readSSE(r, (line) => {
    if (line === "[DONE]") return;
    try {
      const j = JSON.parse(line);
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") { text += j.delta.text; opts.onToken?.(j.delta.text); }
      else if (j.type === "message_start" && j.message?.usage) { usage.inputTokens = j.message.usage.input_tokens ?? 0; usage.cacheReadTokens = j.message.usage.cache_read_input_tokens ?? 0; usage.cacheCreateTokens = j.message.usage.cache_creation_input_tokens ?? 0; }
      else if (j.type === "message_delta" && j.usage) { usage.outputTokens = j.usage.output_tokens ?? 0; }
    } catch { /* ignore */ }
  }, opts.signal);
  return { text, usage: normUsage(usage), elapsedMs: 0 };
}

// ---- Gemini 流式 ----
async function streamGemini(p: ProviderDef, model: string, key: string, opts: ChatOpts): Promise<ChatResult> {
  const url = `${p.baseURL}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
  };
  const r = await doFetch(url, "POST", { "content-type": "application/json" }, body, opts.signal, opts.proxyBase);
  if (!r.ok) throw new Error(`[${p.label}] ${r.status} ${await r.text().catch(() => "")}`);
  let text = "";
  const usage = emptyUsage();
  await readSSE(r, (line) => {
    try {
      const j = JSON.parse(line);
      const part = j.candidates?.[0]?.content?.parts?.[0]?.text;
      if (part) { text += part; opts.onToken?.(part); }
      if (j.usageMetadata) {
        usage.inputTokens = j.usageMetadata.promptTokenCount ?? 0;
        usage.outputTokens = j.usageMetadata.candidatesTokenCount ?? 0;
        usage.totalTokens = j.usageMetadata.totalTokenCount ?? 0;
      }
    } catch { /* ignore */ }
  }, opts.signal);
  return { text, usage: normUsage(usage), elapsedMs: 0 };
}

// ---- 文心流式（OpenAI 兼容 + token 换取）----
async function streamErnie(p: ProviderDef, model: string, key: string, secret: string, opts: ChatOpts): Promise<ChatResult> {
  const token = await ernieToken(key, secret, opts.signal);
  const url = `${p.baseURL}/${model}?access_token=${encodeURIComponent(token)}`;
  const body = {
    stream: true,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  const r = await doFetch(url, "POST", { "content-type": "application/json" }, body, opts.signal, opts.proxyBase);
  if (!r.ok) throw new Error(`[${p.label}] ${r.status} ${await r.text().catch(() => "")}`);
  let text = "";
  const usage = emptyUsage();
  await readSSE(r, (line) => {
    try {
      const j = JSON.parse(line);
      const delta = j.result ?? j.choices?.[0]?.delta?.content;
      if (delta) { text += delta; opts.onToken?.(delta); }
      if (j.usage) { usage.inputTokens = j.usage.prompt_tokens ?? 0; usage.outputTokens = j.usage.completion_tokens ?? 0; usage.totalTokens = j.usage.total_tokens ?? 0; }
    } catch { /* ignore */ }
  }, opts.signal);
  return { text, usage: normUsage(usage), elapsedMs: 0 };
}

// ---------- 韧性：错误分类 / 重试退避 / 主备切换 ----------

// 从错误信息里解析上游 HTTP 状态码（stream* 抛出的错误形如 `[标签] 500 ...`）。
function statusOf(err: unknown): number | null {
  const m = /\[(\d{3})\]/.exec(String((err as any)?.message ?? err));
  return m ? Number(m[1]) : null;
}

// 判断错误是否值得重试：超时/网络故障/限流(429)/5xx 可重试；4xx 鉴权或参数错误不可重试。
function isRetryable(err: unknown): boolean {
  if (!err) return false;
  if ((err as any)?.name === "AbortError") return false; // 超时/用户停止：不重试（message 正则里的 aborted 字样会误判，这里显式覆盖）
  const e = err as any;
  const msg = String(e?.message ?? e);
  if (/fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|ECONNRESET|network|socket|aborted|timeout|undici/i.test(msg)) return true;
  const s = statusOf(err);
  if (s != null) return [408, 409, 425, 429, 500, 502, 503, 504].includes(s);
  return false; // 未知错误默认不重试（保守，避免对不可恢复错误空转）
}

export interface RetryOpts { maxRetries?: number; baseMs?: number; maxMs?: number; }

// 指数退避重试（带抖动），仅对可重试错误生效；达到上限或遇不可重试错误立即抛出。
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? Number(process.env.LLM_MAX_RETRIES ?? 2);
  const baseMs = opts.baseMs ?? Number(process.env.LLM_RETRY_BASE_MS ?? 400);
  const maxMs = opts.maxMs ?? Number(process.env.LLM_RETRY_MAX_MS ?? 8000);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !isRetryable(err)) throw err;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const jitter = Math.random() * backoff * 0.3;
      const wait = Math.round(backoff + jitter);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// 由环境变量解析主备 provider 列表（服务端持有备用 Key 时启用）。
// 例：LLM_FALLBACK_PROVIDERS="openrouter:openai/gpt-4o,deepseek:deepseek-chat" + LLM_FALLBACK_API_KEY=sk-xxx
export function resolveFallbacks(): FallbackSpec[] {
  const raw = (process.env.LLM_FALLBACK_PROVIDERS ?? "").trim();
  if (!raw) return [];
  const key = process.env.LLM_FALLBACK_API_KEY;
  const secret = process.env.LLM_FALLBACK_API_SECRET;
  if (!key) return []; // 没有备用 Key 则不成主备
  return raw.split(",").map((s) => s.trim()).filter(Boolean).map((spec) => {
    const idx = spec.indexOf(":");
    if (idx < 0) return { provider: spec, model: "", apiKey: key, apiSecret: secret };
    return { provider: spec.slice(0, idx), model: spec.slice(idx + 1), apiKey: key, apiSecret: secret };
  });
}

// 单次模型调用（不含重试/主备，不含指标）：超时 + 协议分发。本地个人工具不接 LangSmith/运营指标。
async function chatPrimary(opts: ChatOpts): Promise<ChatResult> {
  const p = providerOf(opts.provider);
  const t0 = Date.now();
  const ctrl = new AbortController();
  const TIMEOUT_MS = 600_000; // 总兜底 10 分钟：F2 超长成品生成（6000+ tokens）耗时可达 3min+，180s 会误杀持续输出；流式持续输出不中断，真卡住才到点
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  const withTimeout = { ...opts, signal: ctrl.signal };
  let res: ChatResult;
  try {
    switch (p.style) {
      case "openai": res = await streamOpenAI(p, opts.model, opts.apiKey, withTimeout); break;
      case "claude": res = await streamClaude(p, opts.model, opts.apiKey, withTimeout); break;
      case "gemini": res = await streamGemini(p, opts.model, opts.apiKey, withTimeout); break;
      case "ernie": res = await streamErnie(p, opts.model ?? "ernie-4.0-8k", opts.apiKey, opts.apiSecret ?? "", withTimeout); break;
      default: throw new Error("未支持的 style: " + p.style);
    }
  } finally {
    clearTimeout(timer);
  }
  res.elapsedMs = Date.now() - t0;
  return res;
}

export async function chatStream(opts: ChatOpts): Promise<ChatResult> {
  const t0 = Date.now();
  const maxRetries = opts.maxRetries ?? Number(process.env.LLM_MAX_RETRIES ?? 2);
  let primaryErr: unknown = null;
  // 主 provider：指数退避重试（仅可重试错误）
  try {
    const res = await withRetry(() => chatPrimary(opts), { maxRetries });
    recordProviderAttempt(opts.provider, opts.model, true, res.elapsedMs);
    return res;
  } catch (err) {
    primaryErr = err;
    recordProviderAttempt(opts.provider, opts.model, false, Date.now() - t0, String((err as any)?.message ?? err));
  }
  // 主 provider 失败 → 主备切换（每个备 provider 单发，不级联重试，避免长级联拖垮延迟）
  const fallbacks = (opts.fallback && opts.fallback.length)
    ? opts.fallback
    : resolveFallbacks();
  for (const fb of fallbacks) {
    if (!fb.provider || !fb.apiKey) continue;
    const fbOpts: ChatOpts = {
      ...opts,
      provider: fb.provider,
      model: fb.model || opts.model,
      apiKey: fb.apiKey,
      apiSecret: fb.apiSecret,
      fallback: [], // 防止备 provider 再触发嵌套主备
    };
    const ft0 = Date.now();
    try {
      const r = await chatPrimary(fbOpts);
      recordProviderAttempt(fb.provider, fbOpts.model, true, r.elapsedMs);
      recordFailover(true);
      return r;
    } catch (fbErr) {
      recordProviderAttempt(fb.provider, fbOpts.model, false, Date.now() - ft0, String((fbErr as any)?.message ?? fbErr));
    }
  }
  if (fallbacks.length) recordFailover(false);
  // 对外仍抛出主 provider 的原始错误（保留 [status] 语义，调用方照旧处理）
  throw primaryErr;
}

export function labelOf(id: string, model: string): string {
  try { return `${providerOf(id).label}·${model}`; } catch { return `${id}·${model}`; }
}

// ---- 工具调用（非流式，仅 openai 兼容）：让 LLM 决定是否调用检索等工具 ----
export interface ToolCall {
  name: string;
  arguments: string; // JSON 字符串
}
export interface ToolCallResult {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
}
export async function chatWithTools(opts: {
  provider: string;
  model: string;
  apiKey: string;
  apiSecret?: string;
  proxyBase?: string;
  system: string;
  user: string;
  jsonMode?: boolean; // 强制模型输出合法 JSON（OpenAI 兼容 response_format: {type:"json_object"}）
  tools: unknown[];
  signal?: AbortSignal;
  lsParentRunId?: string | null;
}): Promise<ToolCallResult> {
  const p = providerOf(opts.provider);
  if (p.style !== "openai") throw new Error(`chatWithTools 仅支持 openai 兼容服务商（当前 ${p.style}）`);
  const childId = LS_ENABLED && opts.lsParentRunId
    ? await lsStart(`${p.label}·${opts.model}·tool`, "llm", { provider: opts.provider, model: opts.model }, opts.lsParentRunId, { model: opts.model })
    : null;
  try {
    const url = `${p.baseURL}/chat/completions`;
    const body = {
      model: opts.model,
      stream: false,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      tools: opts.tools,
      tool_choice: "auto",
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };
    const r = await doFetch(url, "POST", { ...authHeaders(p, opts.apiKey) }, body, opts.signal, opts.proxyBase);
    if (!r.ok) throw new Error(`[${p.label}] ${r.status} ${await r.text().catch(() => "")}`);
    const j = (await r.json()) as any;
    const msg = j.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc: any) => ({
      name: tc.function?.name ?? "",
      arguments: tc.function?.arguments || "",
    }));
    const content = typeof msg.content === "string" ? msg.content : "";
    const usage = j.usage
      ? normUsage({ inputTokens: j.usage.prompt_tokens, outputTokens: j.usage.completion_tokens, totalTokens: j.usage.total_tokens })
      : emptyUsage();
    await lsEnd(childId, { outputs: { toolCalls, content }, metadata: { usage } });
    return { content, toolCalls, usage };
  } catch (err) {
    await lsEnd(childId, { error: String((err as any)?.message || err) });
    throw err;
  }
}
