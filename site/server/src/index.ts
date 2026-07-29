// index.ts
// 服务端入口：托管静态站 + /relay 代理 + /agent/generate (SSE)。
// 静态根 = site/（本文件位于 site/server/src）。

import "dotenv/config"; // 必须在读取 LANGSMITH_API_KEY 的 langsmith.ts 之前加载 .env
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent, runAgentUse, runAgentClarify, runAgentRefine } from "./agent.js";
import { invalidateRagIndex, warmupRag } from "./rag.js";
import { PROVIDERS, providerOf, labelOf } from "./providers.js";
import { board, bump, rate, getOne, resetAll, type BoardSort } from "./metrics.js";
import {
  publishCommunity, listCommunity, draftsCommunity, getCommunity, publishNowCommunity,
  unpublishCommunity, deleteCommunity, communityRate, communityUse, communityFavorite,
  reportCommunity, listReports, resolveReport, logModeration, listModerationLog,
  listCommunityMine, draftsCommunityMine, getUserById,
  addComment, listComments, deleteComment, listCommunityByAuthor, findSimilarCommunity,
  recordTrace, listTraces, closeDb,
} from "./db.js";
import {
  handleAuthLogin, handleAuthMe, handleAuthRegister,
  verifyRequestToken, verifyAdminToken, authPayload,
} from "./auth.js";
import { moderateContent } from "./moderation.js";
import { assertRelayTarget } from "./ssrf.js";
import { checkLengths, validateCommunityDraft, LIMITS } from "./validate.js";
import { rateLimit, clientIp } from "./ratelimit.js";
import { log } from "./logger.js";
import { snapshot, recordGeneration } from "./opmetrics.js";
import { reportError } from "./sentry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 静态根：优先使用 Vite 生产构建产物（dist/）；未构建时回退到源码根（仅便于未打包时仍跑得起来，但 TS 模块不会被转译，需走 vite dev）。
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DIST_ROOT = path.resolve(PROJECT_ROOT, "dist");
const STATIC_ROOT = existsSync(DIST_ROOT) ? DIST_ROOT : PROJECT_ROOT;
if (STATIC_ROOT === PROJECT_ROOT) {
  log.warn("未检测到 dist/ 构建产物，将直接服务源码根（前端 TS 模块不会被转译，请用 `npm run build` 后再启动，或用 `npm run dev` 起 Vite 开发服务器）。");
}
const PORT = Number(process.env.PORT ?? 8000);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// 安全响应头（P0-③ XSS 收口 / 纵深防御）。connect-src 纳入各 LLM 厂商域名，
// 既允许「浏览器直连厂商」模式，又限制脚本只能向白名单域发起请求（阻断 XSS 外泄）。
function buildCsp(): string {
  const hosts = new Set<string>(["'self'"]);
  for (const p of Object.values(PROVIDERS)) {
    try { hosts.add(new URL((p as any).baseURL).origin); } catch { /* ignore */ }
  }
  const connect = [...hosts].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://cdn.tailwindcss.com",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
const CSP = buildCsp();
const SEC_HEADERS = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

// CORS：默认仅允许同源（请求 Origin 与服务器 host 一致）；配置 APP_CORS_ORIGIN（逗号分隔）
// 后按白名单放行指定源。未命中则返回空字符串，浏览器因缺 ACAO 拒绝跨域——避免 "*" 全开放大调用面。
function corsOrigin(req: http.IncomingMessage): string {
  const origin = req.headers.origin;
  if (!origin) return "";
  const allowed = (process.env.APP_CORS_ORIGIN ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length > 0) return allowed.includes(origin) ? origin : "";
  try { if (new URL(origin).host === req.headers.host) return origin; } catch { /* ignore */ }
  return "";
}

function sendJSON(res: http.ServerResponse, code: number, obj: unknown) {
  const req = res.req as http.IncomingMessage;
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": corsOrigin(req),
    "vary": "origin",
    ...SEC_HEADERS,
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  // 防遍历
  const filePath = path.normalize(path.join(STATIC_ROOT, urlPath));
  if (!filePath.startsWith(STATIC_ROOT)) { res.writeHead(403); res.end("forbidden"); return; }
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) { res.writeHead(403); res.end("forbidden"); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "access-control-allow-origin": corsOrigin(req), "vary": "origin", ...SEC_HEADERS });
    createReadStream(filePath).pipe(res);
  } catch {
    // SPA 兜底：未命中文件则回 index.html
    try {
      const html = await readFile(path.join(STATIC_ROOT, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"], ...SEC_HEADERS });
      res.end(html);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  }
}

// trace 捕获：在路由层包裹 Agent 事件回调——既照常向前端推 SSE，又把步骤/用量/错误累积到 acc；
// 调用方在 await Agent 完成后用 recordTrace 落盘（agent.ts 无需改动）。
interface TraceAcc { steps: string[]; usage?: any; error?: string; }
function traceCapture(events: any, acc: TraceAcc) {
  const sum = (a: any, u: any) => {
    if (!u || typeof u !== "object") return a;
    if (!a) return { ...u };
    return {
      prompt_tokens: (a.prompt_tokens || 0) + (u.prompt_tokens || 0),
      completion_tokens: (a.completion_tokens || 0) + (u.completion_tokens || 0),
      total_tokens: (a.total_tokens || 0) + (u.total_tokens || 0),
    };
  };
  return {
    ...events,
    onNode: (n: string) => { acc.steps.push(String(n)); events.onNode?.(n); },
    onUsage: (u: any) => { acc.usage = sum(acc.usage, u); events.onUsage?.(u); },
    onError: (m: string) => { acc.error = String(m); events.onError?.(m); },
    onThink: events.onThink,
    onContext: events.onContext,
    onToken: events.onToken,
    onResult: events.onResult,
  };
}

// /relay：把 {url, method, headers, body} 转发，支持 SSE 流式回传。
// 安全：目标必须经过 ssrf.assertRelayTarget 校验（LLM 厂商白名单 + 解析后私有地址拦截），
// 再透传；清洗 hop-by-hop 头避免 host 冲突。
async function handleRelay(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let payload: any;
  try { payload = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const { url, method = "POST", headers = {}, body } = payload;
  if (!url) return sendJSON(res, 400, { error: "缺少 url" });

  // SSRF 闸门：白名单 + DNS 私有地址拦截（fail closed）
  let target: URL;
  try {
    target = await assertRelayTarget(url);
  } catch (e) {
    return sendJSON(res, 403, { error: "relay 目标被拒绝：" + (e as Error).message });
  }

  // 透传 headers 时清洗逐跳头，避免 host/content-length 冲突
  const fwd: Record<string, string> = { ...(headers as Record<string, string>) };
  delete fwd.host; delete fwd["content-length"]; delete fwd.connection;

  const ac = new AbortController();
  req.on("close", () => ac.abort());
  try {
    const upstream = await fetch(target, {
      method,
      headers: fwd,
      body: typeof body === "string" ? body : body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "access-control-allow-origin": corsOrigin(req),
      "vary": "origin",
      "cache-control": "no-store",
    });
    if (upstream.body) for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (err) {
    sendJSON(res, 502, { error: "relay 失败: " + String(err) });
  }
}

// /agent/generate：SSE 流式返回 Agent 进度
async function handleAgentGenerate(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let payload: any;
  try { payload = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const { provider, model, apiKey, apiSecret, industry, sentence, proxyBase } = payload;
  const vErr = checkLengths(payload, { sentence: LIMITS.SENTENCE, industry: LIMITS.INDUSTRY, proxyBase: LIMITS.PROXY_BASE });
  if (vErr.length) return sendJSON(res, 400, { error: "输入过长：" + vErr.join("；") });
  if (!provider || !model || !apiKey || !sentence) {
    return sendJSON(res, 400, { error: "缺少 provider/model/apiKey/sentence" });
  }
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "access-control-allow-origin": corsOrigin(req), "vary": "origin",
  });
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  const ev = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

  ev("meta", { label: labelOf(provider, model) });
  const tacc: TraceAcc = { steps: [] };
  const events = traceCapture({
    onNode: (n: string) => ev("node", { name: n }),
    onToken: (t: string) => ev("token", { text: t }),
    onContext: (refs: any) => ev("context", refs),
    onThink: (t: string) => ev("think", { text: t }),
    onResult: (tpl: any) => ev("result", tpl),
    onUsage: (u: any) => ev("usage", u),
    onError: (m: string) => ev("error", { message: m }),
  }, tacc);
  const t0 = Date.now();
  try {
    await runAgent(
      { provider, model, apiKey, apiSecret, industry: industry ?? "其他", sentence, proxyBase: proxyBase ?? undefined, promptVersions: payload.promptVersions },
      events, ac.signal,
    );
  } finally {
    recordTrace({ type: "生成模板", provider, model, preview: sentence, latencyMs: Date.now() - t0, usage: tacc.usage, status: tacc.error ? "error" : "ok", error: tacc.error, steps: tacc.steps });
    recordGeneration(!tacc.error);
  }
  res.end();
}

// /agent/use：SSE 流式返回"用模板生成的成品提示词"（模型代写，用户只给目标）
async function handleAgentUse(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let payload: any;
  try { payload = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const { provider, model, apiKey, apiSecret, industry, template, goal, proxyBase } = payload;
  const vErr = checkLengths(payload, { goal: LIMITS.GOAL, template: LIMITS.TEMPLATE, industry: LIMITS.INDUSTRY, proxyBase: LIMITS.PROXY_BASE });
  if (vErr.length) return sendJSON(res, 400, { error: "输入过长：" + vErr.join("；") });
  if (!provider || !model || !apiKey || !template || !goal) {
    return sendJSON(res, 400, { error: "缺少 provider/model/apiKey/template/goal" });
  }
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "access-control-allow-origin": corsOrigin(req), "vary": "origin",
  });
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  const ev = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  ev("meta", { label: labelOf(provider, model) });
  const tacc: TraceAcc = { steps: [] };
  const events = traceCapture({
    onNode: (n: string) => ev("node", { name: n }),
    onToken: (t: string) => ev("token", { text: t }),
    onContext: (refs: any) => ev("context", refs),
    onThink: (t: string) => ev("think", { text: t }),
    onResult: (r: any) => ev("result", r),
    onUsage: (u: any) => ev("usage", u),
    onError: (m: string) => ev("error", { message: m }),
  }, tacc);
  const t0 = Date.now();
  try {
    await runAgentUse(
      { provider, model, apiKey, apiSecret, industry: industry ?? template.industry ?? "其他", template, goal, proxyBase: proxyBase ?? undefined, promptVersions: payload.promptVersions },
      events, ac.signal,
    );
  } finally {
    recordTrace({ type: "生成提示词", provider, model, preview: goal, latencyMs: Date.now() - t0, usage: tacc.usage, status: tacc.error ? "error" : "ok", error: tacc.error, steps: tacc.steps });
    recordGeneration(!tacc.error);
  }
  res.end();
}

// /agent/clarify：交互式访谈澄清（SSE 流式）。
// 模型判断"一句话目标"还缺什么信息，把"在想什么"（思考过程）与带选项的问题流式推给前端；多轮直到 complete。
// 无 Key / 模型异常时降级（首轮给兜底问题，有历史则按已有信息判定完成），保证访谈流程不崩。
async function handleAgentClarify(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let payload: any;
  try { payload = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const { provider, model, apiKey, apiSecret, template, goal, history, proxyBase } = payload;
  const vErr = checkLengths(payload, { goal: LIMITS.GOAL, template: LIMITS.TEMPLATE, history: LIMITS.HISTORY, industry: LIMITS.INDUSTRY, proxyBase: LIMITS.PROXY_BASE });
  if (vErr.length) return sendJSON(res, 400, { error: "输入过长：" + vErr.join("；") });
  if (!provider || !model || !apiKey || !template || !goal) {
    return sendJSON(res, 400, { error: "缺少 provider/model/apiKey/template/goal" });
  }
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "access-control-allow-origin": corsOrigin(req), "vary": "origin",
  });
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  const ev = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  const tacc: TraceAcc = { steps: [] };
  const events = traceCapture({
    onNode: (n: string) => ev("node", { name: n }),
    onThink: (t: string) => ev("think", { text: t }),
    onResult: (r: any) => ev("result", r),
    onError: (m: string) => ev("error", { message: m }),
  }, tacc);
  const t0 = Date.now();
  try {
    await runAgentClarify(
      { provider, model, apiKey, apiSecret, industry: template.industry ?? "其他", template, goal, history: Array.isArray(history) ? history : [], proxyBase: proxyBase ?? undefined, promptVersions: payload.promptVersions },
      events, ac.signal,
    );
  } catch (err) {
    // 极端兜底：任何未捕获错误都降级为"按原始目标继续生成"，绝不阻断主链路
    ev("result", { complete: true, enrichedGoal: goal, note: "clarify 异常，按原始目标继续" });
  } finally {
    recordTrace({ type: "访谈澄清", provider, model, preview: goal, latencyMs: Date.now() - t0, usage: tacc.usage, status: tacc.error ? "error" : "ok", error: tacc.error, steps: tacc.steps });
  }
  ev("done", {});
  res.end();
}

// /agent/refine：根据测试反馈动态改写提示词（SSE 流式：analyze 思考 → rewrite 流式输出新版）。
// 入参：prompt(原提示词全文) + feedback(用户反馈) + conversation(可选测试对话)
async function handleAgentRefine(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let payload: any;
  try { payload = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const { provider, model, apiKey, apiSecret, prompt, feedback, conversation, proxyBase } = payload;
  const vErr = checkLengths(payload, { prompt: LIMITS.PROMPT, feedback: LIMITS.FEEDBACK, conversation: LIMITS.CONVERSATION, industry: LIMITS.INDUSTRY, proxyBase: LIMITS.PROXY_BASE });
  if (vErr.length) return sendJSON(res, 400, { error: "输入过长：" + vErr.join("；") });
  if (!provider || !model || !apiKey || !prompt || !feedback) {
    return sendJSON(res, 400, { error: "缺少 provider/model/apiKey/prompt/feedback" });
  }
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "access-control-allow-origin": corsOrigin(req), "vary": "origin",
  });
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  const ev = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  const tacc: TraceAcc = { steps: [] };
  const events = traceCapture({
    onNode: (n: string) => ev("node", { name: n }),
    onToken: (t: string) => ev("token", { text: t }),
    onThink: (t: string) => ev("think", { text: t }),
    onResult: (r: any) => ev("result", r),
    onUsage: (u: any) => ev("usage", u),
    onError: (m: string) => ev("error", { message: m }),
  }, tacc);
  const t0 = Date.now();
  try {
    await runAgentRefine(
      { provider, model, apiKey, apiSecret, prompt, feedback, conversation: Array.isArray(conversation) ? conversation : [], proxyBase: proxyBase ?? undefined, promptVersions: payload.promptVersions },
      events, ac.signal,
    );
  } catch (err) {
    ev("error", { message: err instanceof Error ? err.message : String(err) });
  } finally {
    recordTrace({ type: "改写提示词", provider, model, preview: feedback, latencyMs: Date.now() - t0, usage: tacc.usage, status: tacc.error ? "error" : "ok", error: tacc.error, steps: tacc.steps });
    recordGeneration(!tacc.error);
  }
  ev("done", {});
  res.end();
}

// ---------- 热度榜（M9）：服务端聚合使用/收藏/评分 ----------
// GET /metrics/board?sort=heat|uses|favorites|rating&limit=100 -> 排序后的榜单
// GET /metrics?id=xxx -> 单个模板的指标
// POST /metrics/bump  {id,type:'use'|'favorite',delta,title?,industry?} -> 计数 +1/-1
// POST /metrics/rate  {id,score,prev?,title?,industry?} -> 更新评分（prev 为本人上次评分，用于改评差值）
// POST /metrics/reset -> 重新播种演示数据
async function handleMetricsBoard(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url ?? "/", "http://localhost");
  const sort = (u.searchParams.get("sort") as BoardSort) || "heat";
  const limit = Number(u.searchParams.get("limit") || "100");
  sendJSON(res, 200, board(sort, Math.min(500, Math.max(1, limit))));
}
async function handleMetricsOne(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url ?? "/", "http://localhost");
  const id = u.searchParams.get("id");
  if (!id) return sendJSON(res, 400, { error: "缺少 id" });
  const e = getOne(id);
  if (!e) return sendJSON(res, 404, { error: "无记录" });
  const avg = e.ratingCount ? e.ratingSum / e.ratingCount : 0;
  sendJSON(res, 200, { ...e, avgRating: Math.round(avg * 10) / 10 });
}
async function handleMetricsBump(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any;
  try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  if (!p.id || (p.type !== "use" && p.type !== "favorite")) return sendJSON(res, 400, { error: "缺少 id 或 type(use|favorite)" });
  const e = bump(p.id, p.type, Number(p.delta) || 0, p.title, p.industry);
  sendJSON(res, 200, e);
}
async function handleMetricsRate(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any;
  try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  if (!p.id || !(p.score >= 1 && p.score <= 5)) return sendJSON(res, 400, { error: "缺少 id 或 score(1-5)" });
  const prev = p.prev != null ? Number(p.prev) : null;
  const e = rate(p.id, Number(p.score), prev, p.title, p.industry);
  const avg = e.ratingCount ? e.ratingSum / e.ratingCount : 0;
  sendJSON(res, 200, { ...e, avgRating: Math.round(avg * 10) / 10 });
}
async function handleMetricsReset(req: http.IncomingMessage, res: http.ServerResponse) {
  const m = resetAll();
  sendJSON(res, 200, { ok: true, count: Object.keys(m).length });
}

// =====================================================================
// 社区分享（M18）：发布 / 列表 / 草稿 / 公开 / 撤回 / 删除 / 评分 / 计数
// =====================================================================
async function handleCommunityPublish(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any;
  try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  if (!p.prompt || !p.title) return sendJSON(res, 400, { error: "缺少 prompt 或 title" });
  const vErr = validateCommunityDraft(p);
  if (vErr.length) return sendJSON(res, 400, { error: "输入校验失败：" + vErr.join("；") });
  const mod = await moderateContent(`${p.title}\n${p.prompt}`); // AI 软审核闸门（P0-④）
  logModeration(null, String(p.title).slice(0, 120), "publish_draft", mod.safe, mod.engine, mod.reasons || []);
  if (!mod.safe) return sendJSON(res, 403, { error: "内容未通过 AI 审核，无法发布", moderation: mod });
  // 作者名以服务端鉴权身份为准（authorId 绑定），杜绝客户端伪造"李鬼"
  const me = authPayload(req);
  const authorId = me ? me.sub : null;
  const author = me ? (me.sub === "admin" ? "admin" : (getUserById(me.sub)?.username || me.sub)) : "匿名";
  const r = publishCommunity({
    id: p.id || ("c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
    title: String(p.title).slice(0, 120),
    industry: p.industry || "其他",
    author,
    authorId,
    prompt: String(p.prompt),
    tags: Array.isArray(p.tags) ? p.tags.map(String).slice(0, 8) : [],
    note: p.note || "",
  });
  // 发布去重（C3）：草稿创建后查已公开模板相似度，附到返回供前端提示（不打断流程）
  const similar = findSimilarCommunity(String(p.title), String(p.prompt));
  sendJSON(res, 200, { ...r, similar });
}
async function handleCommunityList(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url ?? "/", "http://localhost");
  const rows = listCommunity({
    status: u.searchParams.get("status") || "published",
    sort: (u.searchParams.get("sort") as any) || "heat",
    q: u.searchParams.get("q") || "",
    industry: u.searchParams.get("industry") || "",
    limit: Number(u.searchParams.get("limit") || "100"),
    offset: Number(u.searchParams.get("offset") || "0"),
  });
  sendJSON(res, 200, rows);
}
async function handleCommunityDrafts(req: http.IncomingMessage, res: http.ServerResponse) {
  // 公网修复：原 draftsCommunity() 返回全部用户草稿且无鉴权（信息泄露）。
  // 现改为仅本人登录可见、按 author_id 过滤。管理员审核台仍用 draftsCommunity()（见 moderation）。
  const me = authPayload(req);
  if (!me) return sendJSON(res, 401, { error: "请先登录后再查看草稿" });
  sendJSON(res, 200, draftsCommunityMine(me.sub));
}
// 「我的发布」：作者本人可见的草稿 + 已公开（按 author_id 过滤）
async function handleCommunityMine(req: http.IncomingMessage, res: http.ServerResponse) {
  const me = authPayload(req);
  if (!me) return sendJSON(res, 401, { error: "未授权" });
  sendJSON(res, 200, listCommunityMine(me.sub));
}
async function handleCommunityDetail(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url ?? "/", "http://localhost");
  const id = u.searchParams.get("id");
  if (!id) return sendJSON(res, 400, { error: "缺少 id" });
  const r = getCommunity(id);
  if (!r) return sendJSON(res, 404, { error: "无此社区提示词" });
  sendJSON(res, 200, r);
}
async function handleCommunityPublishNow(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any; try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  if (!p.id) return sendJSON(res, 400, { error: "缺少 id" });
  const rec = getCommunity(p.id);
  if (!rec) return sendJSON(res, 404, { error: "无此记录" });
  const mod = await moderateContent(`${rec.title}\n${rec.prompt}`); // 公开前再审核一次（避免草稿期绕过）
  logModeration(p.id, rec.title, "publish_public", mod.safe, mod.engine, mod.reasons || []);
  if (!mod.safe) return sendJSON(res, 403, { error: "内容未通过 AI 审核，无法公开", moderation: mod });
  const r = publishNowCommunity(p.id);
  if (r) invalidateRagIndex(); // 新发布的社区模板应立刻进入检索池
  sendJSON(res, r ? 200 : 404, r || { error: "无此记录" });
}
async function handleCommunityUnpublish(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any; try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  if (!p.id) return sendJSON(res, 400, { error: "缺少 id" });
  const r = unpublishCommunity(p.id);
  if (r) invalidateRagIndex(); // 下架后不再参与检索
  sendJSON(res, r ? 200 : 404, r || { error: "无此记录" });
}
async function handleCommunityDelete(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any; try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  if (!p.id) return sendJSON(res, 400, { error: "缺少 id" });
  const me = authPayload(req);
  const rec = getCommunity(p.id);
  if (!rec) return sendJSON(res, 404, { error: "无此记录" });
  // 仅作者本人或管理员可删
  if (!(me && (me.role === "admin" || rec.authorId === me.sub))) {
    return sendJSON(res, 403, { error: "只能删除自己发布的草稿" });
  }
  deleteCommunity(p.id);
  invalidateRagIndex(); // 删除后从检索池移除
  sendJSON(res, 200, { ok: true });
}
async function handleCommunityRate(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any; try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const vErr0 = checkLengths(p, { id: LIMITS.ID });
  if (vErr0.length) return sendJSON(res, 400, { error: vErr0.join("；") });
  if (!p.id || !(p.score >= 1 && p.score <= 5)) return sendJSON(res, 400, { error: "缺少 id 或 score(1-5)" });
  const prev = p.prev != null ? Number(p.prev) : null;
  const r = communityRate(p.id, Number(p.score), prev);
  if (!r) return sendJSON(res, 404, { error: "无此记录" });
  sendJSON(res, 200, r);
}
async function handleCommunityUse(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any; try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  if (!p.id) return sendJSON(res, 400, { error: "缺少 id" });
  const r = communityUse(p.id, Number(p.delta) || 1);
  sendJSON(res, r ? 200 : 404, r || { error: "无此记录" });
}
async function handleCommunityFavorite(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any; try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  if (!p.id) return sendJSON(res, 400, { error: "缺少 id" });
  const r = communityFavorite(p.id, Number(p.delta) || 1);
  sendJSON(res, r ? 200 : 404, r || { error: "无此记录" });
}
async function handleCommunityReport(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any; try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const vErr = checkLengths(p, { id: LIMITS.ID, reason: 100, detail: 2000 });
  if (vErr.length) return sendJSON(res, 400, { error: vErr.join("；") });
  if (!p.id || !p.reason) return sendJSON(res, 400, { error: "缺少 id 或举报原因" });
  reportCommunity(String(p.id), String(p.reason), String(p.detail || ""));
  sendJSON(res, 200, { ok: true });
}
async function handleCommunityComment(req: http.IncomingMessage, res: http.ServerResponse) {
  const me = authPayload(req);
  if (!me) return sendJSON(res, 401, { error: "请先登录后再评论" });
  const raw = await readBody(req);
  let p: any; try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const vErr = checkLengths(p, { itemId: LIMITS.ID, content: 2000 });
  if (vErr.length) return sendJSON(res, 400, { error: vErr.join("；") });
  if (!p.itemId || !p.content || !String(p.content).trim()) return sendJSON(res, 400, { error: "缺少 itemId 或评论内容" });
  const item = getCommunity(String(p.itemId));
  if (!item) return sendJSON(res, 404, { error: "无此社区提示词" });
  const author = me.role === "admin" ? "admin" : (getUserById(me.sub)?.username || me.sub);
  const r = addComment(String(p.itemId), me.sub, author, String(p.content).trim());
  sendJSON(res, 200, r);
}
async function handleCommunityComments(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url ?? "/", "http://localhost");
  const itemId = u.searchParams.get("itemId");
  if (!itemId) return sendJSON(res, 400, { error: "缺少 itemId" });
  sendJSON(res, 200, listComments(itemId));
}
async function handleCommunityAuthor(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url ?? "/", "http://localhost");
  const authorId = u.searchParams.get("authorId");
  if (!authorId) return sendJSON(res, 400, { error: "缺少 authorId" });
  const rows = listCommunityByAuthor(authorId);
  const authorName = rows.length ? rows[0].author : (getUserById(authorId)?.username || authorId);
  sendJSON(res, 200, { authorId, author: authorName, items: rows });
}
// 基础 SEO（C4）：sitemap.xml 列出已公开社区模板；robots.txt 指向 sitemap。
// SITE_URL 环境变量可覆盖站点根（部署时设为公网域名，默认 localhost）。
async function handleSitemap(req: http.IncomingMessage, res: http.ServerResponse) {
  const base = (process.env.SITE_URL || "http://localhost:8000").replace(/\/$/, "");
  const items = listCommunity({ status: "published", limit: 5000 });
  const urls = items.map((it: any) => `  <url><loc>${base}/#/c/${encodeURIComponent(it.id)}</loc><priority>0.7</priority></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
  res.end(xml);
}
async function handleRobots(req: http.IncomingMessage, res: http.ServerResponse) {
  const base = (process.env.SITE_URL || "http://localhost:8000").replace(/\/$/, "");
  const txt = `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end(txt);
}
async function handleCommunityModeration(req: http.IncomingMessage, res: http.ServerResponse) {
  sendJSON(res, 200, {
    drafts: draftsCommunity(),
    reports: listReports("pending"),
    log: listModerationLog(50),
  });
}
async function handleCommunityTakedown(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any; try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const vErr = checkLengths(p, { id: LIMITS.ID, reason: 200 });
  if (vErr.length) return sendJSON(res, 400, { error: vErr.join("；") });
  if (!p.id) return sendJSON(res, 400, { error: "缺少 id" });
  const rec = getCommunity(p.id);
  if (!rec) return sendJSON(res, 404, { error: "无此记录" });
  logModeration(p.id, rec.title, "takedown", false, "admin", [p.reason || "管理员下架"]);
  deleteCommunity(p.id);
  invalidateRagIndex(); // 下架后从检索池移除
  sendJSON(res, 200, { ok: true });
}
async function handleCommunityReportResolve(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let p: any; try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  if (!p.id || !(p.action === "resolved" || p.action === "dismissed")) return sendJSON(res, 400, { error: "缺少 id 或 action" });
  resolveReport(String(p.id), p.action);
  sendJSON(res, 200, { ok: true });
}

// 本地可观测：返回最近的 trace 列表
async function handleTraces(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url ?? "/", "http://localhost");
  const limit = Number(u.searchParams.get("limit") || "200");
  sendJSON(res, 200, { traces: listTraces(limit) });
}

// 运营指标（仅管理员可见）：多 LLM 服务健康度（成功率/延迟）、整体生成成功率、RAG 命中率、主备切换情况。
async function handleOpsMetrics(_req: http.IncomingMessage, res: http.ServerResponse) {
  sendJSON(res, 200, snapshot());
}

// 健康检查（供 Docker/K8s/编排探活）——无副作用、不依赖外部资源
function handleHealthz(_req: http.IncomingMessage, res: http.ServerResponse) {
  sendJSON(res, 200, { ok: true, ts: Date.now() });
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": corsOrigin(req), "vary": "origin", "access-control-allow-methods": "POST,GET,OPTIONS", "access-control-allow-headers": "*" }); res.end(); return; }
  // 健康检查（监控探活，不限流）
  if (url.startsWith("/healthz") && req.method === "GET") return handleHealthz(req, res);

  // 速率限制（公网防刷/防滥用）：全局窗口 + 注册/relay 更严格。
  // 限流 key 用真实客户端 IP（反代之后取 X-Forwarded-For），避免被反代 IP 归一。
  const ip = clientIp(req);
  const g = Number(process.env.RL_GLOBAL_LIMIT ?? 240);
  const gw = Number(process.env.RL_GLOBAL_WINDOW ?? 60000);
  const rlGlobal = rateLimit("global:" + ip, g, gw);
  if (!rlGlobal.ok) {
    return sendJSON(res, 429, { error: "请求过于频繁，请稍后再试", retryAfter: rlGlobal.retryAfter });
  }
  // 注册：每小时每 IP 最多 5 次，配合开放注册的强防护（防 spam 账号）
  if (url.startsWith("/api/auth/register") && req.method === "POST") {
    const rlReg = rateLimit("reg:" + ip, Number(process.env.RL_REGISTER_LIMIT ?? 5), Number(process.env.RL_REGISTER_WINDOW ?? 3600000));
    if (!rlReg.ok) return sendJSON(res, 429, { error: "注册过于频繁，请稍后再试", retryAfter: rlReg.retryAfter });
  }
  // 转发代理：每分钟每 IP 最多 30 次，防止开放 relay 被刷爆
  if (url.startsWith("/relay") && req.method === "POST") {
    const rlRelay = rateLimit("relay:" + ip, Number(process.env.RL_RELAY_LIMIT ?? 30), Number(process.env.RL_RELAY_WINDOW ?? 60000));
    if (!rlRelay.ok) return sendJSON(res, 429, { error: "转发请求过于频繁，请稍后再试", retryAfter: rlRelay.retryAfter });
  }
  // 鉴权端点（注册/登录/查询自身）本身不要求已登录
  if (url.startsWith("/api/auth/register") && req.method === "POST") return handleAuthRegister(req, res);
  if (url.startsWith("/api/auth/login") && req.method === "POST") return handleAuthLogin(req, res);
  if (url.startsWith("/api/auth/me") && req.method === "GET") return handleAuthMe(req, res);

  // 普通用户闸门：已登录即可（发布/评分/使用/收藏/举报/删除草稿）
  const USER_GUARDED = [
    "/community/publish", "/community/rate", "/community/use", "/community/favorite",
    "/community/report", "/community/delete", "/community/comment",
  ];
  if (USER_GUARDED.some((p) => url.startsWith(p) && req.method === "POST") && !verifyRequestToken(req)) {
    return sendJSON(res, 401, { error: "请先登录后再操作" });
  }
  // 管理员闸门：公开/撤回/下架/处理举报/审核台/指标重置 仅 role==='admin'
  const ADMIN_GUARDED = [
    "/community/publish-now", "/community/unpublish", "/community/report/resolve",
    "/community/takedown", "/metrics/reset",
  ];
  if (ADMIN_GUARDED.some((p) => url.startsWith(p) && req.method === "POST") && !verifyAdminToken(req)) {
    return sendJSON(res, 401, { error: "需要管理员权限" });
  }
  // 管理员只读闸门：审核台数据含举报/审核日志，仅管理员可见
  if (url.startsWith("/community/moderation") && req.method === "GET" && !verifyAdminToken(req)) {
    return sendJSON(res, 401, { error: "需要管理员权限" });
  }
  // 运营指标：含各 provider 健康度与失败详情，仅管理员可见
  if (url.startsWith("/ops/metrics") && req.method === "GET" && !verifyAdminToken(req)) {
    return sendJSON(res, 401, { error: "需要管理员权限" });
  }

  if (url.startsWith("/relay") && req.method === "POST") return handleRelay(req, res);
  if (url.startsWith("/agent/generate") && req.method === "POST") return handleAgentGenerate(req, res);
  if (url.startsWith("/agent/use") && req.method === "POST") return handleAgentUse(req, res);
  if (url.startsWith("/agent/clarify") && req.method === "POST") return handleAgentClarify(req, res);
  if (url.startsWith("/agent/refine") && req.method === "POST") return handleAgentRefine(req, res);
  if (url.startsWith("/metrics/board") && req.method === "GET") return handleMetricsBoard(req, res);
  if (url.startsWith("/metrics?id=") && req.method === "GET") return handleMetricsOne(req, res);
  if (url.startsWith("/metrics/reset") && req.method === "POST") return handleMetricsReset(req, res);
  if (url.startsWith("/metrics/bump") && req.method === "POST") return handleMetricsBump(req, res);
  if (url.startsWith("/metrics/rate") && req.method === "POST") return handleMetricsRate(req, res);
  if (url.startsWith("/metrics") && req.method === "GET") return handleMetricsBoard(req, res);
  if (url.startsWith("/community/publish-now") && req.method === "POST") return handleCommunityPublishNow(req, res);
  if (url.startsWith("/community/publish") && req.method === "POST") return handleCommunityPublish(req, res);
  if (url.startsWith("/community/unpublish") && req.method === "POST") return handleCommunityUnpublish(req, res);
  if (url.startsWith("/community/delete") && req.method === "POST") return handleCommunityDelete(req, res);
  if (url.startsWith("/community/rate") && req.method === "POST") return handleCommunityRate(req, res);
  if (url.startsWith("/community/use") && req.method === "POST") return handleCommunityUse(req, res);
  if (url.startsWith("/community/favorite") && req.method === "POST") return handleCommunityFavorite(req, res);
  if (url.startsWith("/community/drafts") && req.method === "GET") return handleCommunityDrafts(req, res);
  if (url.startsWith("/community/mine") && req.method === "GET") return handleCommunityMine(req, res);
  if (url.startsWith("/community/detail") && req.method === "GET") return handleCommunityDetail(req, res);
  if (url.startsWith("/community/list") && req.method === "GET") return handleCommunityList(req, res);
  if (url.startsWith("/community/moderation") && req.method === "GET") return handleCommunityModeration(req, res);
  if (url.startsWith("/community/report/resolve") && req.method === "POST") return handleCommunityReportResolve(req, res);
  if (url.startsWith("/community/comment") && req.method === "POST") return handleCommunityComment(req, res);
  if (url.startsWith("/community/comments") && req.method === "GET") return handleCommunityComments(req, res);
  if (url.startsWith("/community/author") && req.method === "GET") return handleCommunityAuthor(req, res);
  if (url.startsWith("/community/report") && req.method === "POST") return handleCommunityReport(req, res);
  if (url.startsWith("/community/takedown") && req.method === "POST") return handleCommunityTakedown(req, res);
  if (url.startsWith("/traces") && req.method === "GET") return handleTraces(req, res);
  if (url.startsWith("/ops/metrics") && req.method === "GET") return handleOpsMetrics(req, res);
  if (url === "/sitemap.xml" && req.method === "GET") return handleSitemap(req, res);
  if (url === "/robots.txt" && req.method === "GET") return handleRobots(req, res);
  return serveStatic(req, res);
});

// ---------- 进程治理：优雅退出 + 未捕获异常兜底 ----------
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`收到 ${signal}，开始优雅退出…`);
  server.close(() => {
    try { closeDb(); } catch { /* ignore */ }
    log.info("已停止接受新连接，进程退出。");
    process.exit(0);
  });
  // 超时强制退出（避免 SSE 长连接卡住）
  setTimeout(() => { log.error("强制退出（超时）"); process.exit(1); }, 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  log.error("未捕获异常", { message: (err as Error)?.message, stack: (err as Error)?.stack });
  reportError(err); // 可选：配置 SENTRY_DSN 时上报
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  log.error("未处理的 Promise 拒绝", { reason: String(reason) });
  reportError(reason);
  // 不退出：保持可用，仅记录
});

server.listen(PORT, () => {
  log.info(`静态 + /relay + /agent 已启动: http://localhost:${PORT}`);
  log.info(`静态根: ${STATIC_ROOT}`);
  // 启动后预热 RAG 索引（不阻塞请求处理；失败也无妨，首次检索会惰性重建）
  warmupRag().catch((e) => log.warn("RAG 预热异常", { message: (e as Error)?.message }));
});
