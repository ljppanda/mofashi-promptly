// index.ts
// 服务端入口：托管静态站 + /relay 代理 + /agent/* 生成链路（SSE）。
// 个人本地工具：无社区、无账号、无运营指标、无 SSRF 网关（relay 直连，仅供本机代理使用）。
// 静态根 = site/（本文件位于 site/server/src）。

import "dotenv/config";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent, runAgentUse, runAgentClarify, runAgentRefine } from "./agent.js";
import { warmupRag } from "./rag.js";
import { PROVIDERS, labelOf } from "./providers.js";
import { log } from "./logger.js";

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

// 安全响应头（XSS 收口 / 纵深防御）。connect-src 纳入各 LLM 厂商域名，
// 既允许「浏览器直连厂商」模式，又限制脚本只能向白名单域发起请求（阻断 XSS 外泄）。
function buildCsp(): string {
  const hosts = new Set<string>(["'self'"]);
  for (const p of Object.values(PROVIDERS)) {
    try { hosts.add(new URL((p as any).baseURL).origin); } catch { /* ignore */ }
  }
  const connect = [...hosts].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
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

// /relay：把 {url, method, headers, body} 转发，支持 SSE 流式回传。
// 个人本地工具：relay 作为本机代理转发（如用户开启了代理时，服务端模型调用经此转发），不做 SSRF 白名单闸门。
async function handleRelay(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let payload: any;
  try { payload = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const { url, method = "POST", headers = {}, body } = payload;
  if (!url) return sendJSON(res, 400, { error: "缺少 url" });

  // 透传 headers 时清洗逐跳头，避免 host/content-length 冲突
  const fwd: Record<string, string> = { ...(headers as Record<string, string>) };
  delete fwd.host; delete fwd["content-length"]; delete fwd.connection;

  const ac = new AbortController();
  req.on("close", () => ac.abort());
  try {
    const upstream = await fetch(url, {
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

// 统一把 SSE 事件推给前端
function makeEmitter(res: http.ServerResponse) {
  return (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}
function openSse(res: http.ServerResponse, req: http.IncomingMessage) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "access-control-allow-origin": corsOrigin(req), "vary": "origin",
  });
}

// /agent/generate：SSE 流式返回 Agent 进度
async function handleAgentGenerate(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let payload: any;
  try { payload = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const { provider, model, apiKey, apiSecret, industry, sentence, proxyBase } = payload;
  if (!provider || !model || !apiKey || !sentence) {
    return sendJSON(res, 400, { error: "缺少 provider/model/apiKey/sentence" });
  }
  openSse(res, req);
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  const ev = makeEmitter(res);
  ev("meta", { label: labelOf(provider, model) });
  try {
    await runAgent(
      { provider, model, apiKey, apiSecret, industry: industry ?? "其他", sentence, proxyBase: proxyBase ?? undefined, promptVersions: payload.promptVersions },
      {
        onNode: (n: string) => ev("node", { name: n }),
        onToken: (t: string) => ev("token", { text: t }),
        onContext: (refs: any) => ev("context", refs),
        onThink: (t: string) => ev("think", { text: t }),
        onResult: (tpl: any) => ev("result", tpl),
        onUsage: (u: any) => ev("usage", u),
        onError: (m: string) => ev("error", { message: m }),
      },
      ac.signal,
    );
  } catch (err) {
    ev("error", { message: err instanceof Error ? err.message : String(err) });
  }
  res.end();
}

// /agent/use：SSE 流式返回"用模板生成的成品提示词"
async function handleAgentUse(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let payload: any;
  try { payload = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const { provider, model, apiKey, apiSecret, industry, template, goal, proxyBase } = payload;
  if (!provider || !model || !apiKey || !template || !goal) {
    return sendJSON(res, 400, { error: "缺少 provider/model/apiKey/template/goal" });
  }
  openSse(res, req);
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  const ev = makeEmitter(res);
  ev("meta", { label: labelOf(provider, model) });
  try {
    await runAgentUse(
      { provider, model, apiKey, apiSecret, industry: industry ?? template.industry ?? "其他", template, goal, proxyBase: proxyBase ?? undefined, promptVersions: payload.promptVersions },
      {
        onNode: (n: string) => ev("node", { name: n }),
        onToken: (t: string) => ev("token", { text: t }),
        onContext: (refs: any) => ev("context", refs),
        onThink: (t: string) => ev("think", { text: t }),
        onResult: (r: any) => ev("result", r),
        onUsage: (u: any) => ev("usage", u),
        onError: (m: string) => ev("error", { message: m }),
      },
      ac.signal,
    );
  } catch (err) {
    ev("error", { message: err instanceof Error ? err.message : String(err) });
  }
  res.end();
}

// /agent/clarify：交互式访谈澄清（SSE 流式）
async function handleAgentClarify(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let payload: any;
  try { payload = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const { provider, model, apiKey, apiSecret, template, goal, history, proxyBase } = payload;
  if (!provider || !model || !apiKey || !template || !goal) {
    return sendJSON(res, 400, { error: "缺少 provider/model/apiKey/template/goal" });
  }
  openSse(res, req);
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  const ev = makeEmitter(res);
  try {
    await runAgentClarify(
      { provider, model, apiKey, apiSecret, industry: template.industry ?? "其他", template, goal, history: Array.isArray(history) ? history : [], proxyBase: proxyBase ?? undefined, promptVersions: payload.promptVersions },
      {
        onNode: (n: string) => ev("node", { name: n }),
        onThink: (t: string) => ev("think", { text: t }),
        onResult: (r: any) => ev("result", r),
        onError: (m: string) => ev("error", { message: m }),
      },
      ac.signal,
    );
  } catch (err) {
    ev("error", { message: err instanceof Error ? err.message : String(err) });
  }
  ev("done", {});
  res.end();
}

// /agent/refine：根据测试反馈动态改写提示词（SSE 流式）
async function handleAgentRefine(req: http.IncomingMessage, res: http.ServerResponse) {
  const raw = await readBody(req);
  let payload: any;
  try { payload = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const { provider, model, apiKey, apiSecret, prompt, feedback, conversation, proxyBase } = payload;
  if (!provider || !model || !apiKey || !prompt || !feedback) {
    return sendJSON(res, 400, { error: "缺少 provider/model/apiKey/prompt/feedback" });
  }
  openSse(res, req);
  const ac = new AbortController();
  req.on("close", () => ac.abort());
  const ev = makeEmitter(res);
  try {
    await runAgentRefine(
      { provider, model, apiKey, apiSecret, prompt, feedback, conversation: Array.isArray(conversation) ? conversation : [], proxyBase: proxyBase ?? undefined, promptVersions: payload.promptVersions },
      {
        onNode: (n: string) => ev("node", { name: n }),
        onToken: (t: string) => ev("token", { text: t }),
        onThink: (t: string) => ev("think", { text: t }),
        onResult: (r: any) => ev("result", r),
        onUsage: (u: any) => ev("usage", u),
        onError: (m: string) => ev("error", { message: m }),
      },
      ac.signal,
    );
  } catch (err) {
    ev("error", { message: err instanceof Error ? err.message : String(err) });
  }
  ev("done", {});
  res.end();
}

// 健康检查（供 Docker/K8s/编排探活）——无副作用、不依赖外部资源
function handleHealthz(_req: http.IncomingMessage, res: http.ServerResponse) {
  sendJSON(res, 200, { ok: true, ts: Date.now() });
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": corsOrigin(req), "vary": "origin", "access-control-allow-methods": "POST,GET,OPTIONS", "access-control-allow-headers": "*" });
    res.end();
    return;
  }
  // 健康检查（监控探活）
  if (url.startsWith("/healthz") && req.method === "GET") return handleHealthz(req, res);

  if (url.startsWith("/relay") && (req.method === "POST" || req.method === "GET")) return handleRelay(req, res);
  if (url.startsWith("/agent/generate") && req.method === "POST") return handleAgentGenerate(req, res);
  if (url.startsWith("/agent/use") && req.method === "POST") return handleAgentUse(req, res);
  if (url.startsWith("/agent/clarify") && req.method === "POST") return handleAgentClarify(req, res);
  if (url.startsWith("/agent/refine") && req.method === "POST") return handleAgentRefine(req, res);
  return serveStatic(req, res);
});

// ---------- 进程治理：优雅退出 + 未捕获异常兜底 ----------
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`收到 ${signal}，开始优雅退出…`);
  server.close(() => {
    log.info("已停止接受新连接，进程退出。");
    process.exit(0);
  });
  setTimeout(() => { log.error("强制退出（超时）"); process.exit(1); }, 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  log.error("未捕获异常", { message: (err as Error)?.message, stack: (err as Error)?.stack });
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  log.error("未处理的 Promise 拒绝", { reason: String(reason) });
  // 不退出：保持可用，仅记录
});

server.listen(PORT, () => {
  log.info(`静态 + /relay + /agent 已启动: http://localhost:${PORT}`);
  log.info(`静态根: ${STATIC_ROOT}`);
  // 启动后预热 RAG 索引（不阻塞请求处理；失败也无妨，首次检索会惰性重建）
  warmupRag().catch((e) => log.warn("RAG 预热异常", { message: (e as Error)?.message }));
});
