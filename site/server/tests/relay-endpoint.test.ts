// tests/relay-endpoint.test.ts — P0-2 /relay 端点级离线回归（子进程真起服务器 + 真 HTTP + 本机 mock，全程零外网）。
//
// 方法仿 tests/agent-trace-endpoint.test.ts：index.ts 顶层有 listen + warmupRag 副作用，无法在测试进程内 import，
// 故用子进程启动真实服务器；再用 RELAY_ALLOWED_ORIGINS 把白名单指向本机 mock origin，实现离线零外网验证。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, "..", "src", "index.ts");
const IS_WIN = process.platform === "win32";

// mock 上游返回的固定 body：用例 ① 断言它被原样透传（成功路径数据结构不变）。
const MOCK_BODY = '{"id":"relay-mock-1","choices":[{"message":{"role":"assistant","content":"hello"}}]}';
// 302 的 Location 指向本机确定关闭的端口：即便意外自动跟随也不会触外网，且会立刻 connection-refused 暴露问题。
const MOCK_REDIRECT_LOCATION = "http://127.0.0.1:1/steal";

interface MockServer {
  server: http.Server;
  port: number;
  hits: string[];
}

function startMock(): Promise<MockServer> {
  return new Promise((resolve) => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(`${req.method ?? ""} ${req.url ?? ""}`);
      const p = (req.url ?? "").split("?")[0];
      if (p === "/redirect") {
        res.writeHead(302, { location: MOCK_REDIRECT_LOCATION, "content-type": "text/plain", connection: "close" });
        res.end("redirecting");
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", connection: "close" });
      res.end(MOCK_BODY);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      resolve({ server, port, hits });
    });
  });
}

// 取一个空闲端口给服务器子进程，避免与并行工程师 / 已运行实例冲突。
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

interface RunningServer {
  proc: ChildProcess;
  base: string;
}

async function startServer(port: number, env: Record<string, string>): Promise<RunningServer> {
  const proc = spawn("npx", ["tsx", SERVER_ENTRY], {
    env: { ...process.env, ...env, PORT: String(port) },
    shell: true,
    detached: !IS_WIN,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tail = "";
  proc.stdout?.on("data", (d: Buffer) => { tail = (tail + d.toString()).slice(-2000); });
  proc.stderr?.on("data", (d: Buffer) => { tail = (tail + d.toString()).slice(-2000); });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40_000; // 冷启动含重型依赖导入，给足 40s
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`服务器子进程提前退出（code=${proc.exitCode}）：\n${tail}`);
    try {
      const r = await fetch(base + "/healthz", { method: "GET" });
      if (r.ok) return { proc, base };
    } catch { /* 未就绪，继续轮询 */ }
    await new Promise((res) => setTimeout(res, 400));
  }
  proc.kill();
  throw new Error(`服务器子进程启动超时（>40s）：\n${tail}`);
}

function stopServer(s: RunningServer | null): void {
  if (!s) return;
  const pid = s.proc.pid;
  if (pid === undefined) return;
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try { process.kill(-pid, "SIGKILL"); } catch { /* 组可能已退出 */ }
    }
  } catch { /* ignore */ }
  try { s.proc.kill(); } catch { /* ignore */ }
}

interface RelayResp {
  status: number;
  json: any;
  text: string;
  csp: string | null;
}

async function postRelay(base: string, body: string): Promise<RelayResp> {
  const r = await fetch(base + "/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
  return { status: r.status, json, text, csp: r.headers.get("content-security-policy") };
}

let allowed: MockServer | null = null;   // 加入白名单（RELAY_ALLOWED_ORIGINS）
let denied: MockServer | null = null;    // 不加入白名单，用于证明「拒绝发生在 fetch 之前」
let srv: RunningServer | null = null;

before(async () => {
  allowed = await startMock();
  denied = await startMock();
  const port = await freePort();
  srv = await startServer(port, {
    RELAY_ALLOWED_ORIGINS: `http://127.0.0.1:${allowed.port}`,
    LANGSMITH_ENABLED: "0", // 关闭 LangSmith 上报，避免任何外部网络
  });
});

after(() => {
  stopServer(srv);
  for (const m of [allowed, denied]) {
    if (!m) continue;
    try { m.server.closeAllConnections(); } catch { /* Node <18.2 无此方法 */ }
    try { m.server.close(); } catch { /* ignore */ }
  }
});

test("① 白名单命中 → 200 且上游 body 原样透传（成功路径数据结构不变）", async () => {
  const before = allowed!.hits.length;
  const r = await postRelay(srv!.base, JSON.stringify({
    url: `http://127.0.0.1:${allowed!.port}/v1/chat/completions`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { model: "mock", messages: [] },
  }));
  assert.equal(r.status, 200);
  assert.equal(r.text, MOCK_BODY, "body 必须原样透传，不得改写");
  assert.equal(allowed!.hits.length, before + 1, "上游 mock 应收到 1 次请求");
});

test("② 非白名单端口 → 403 + RELAY_ORIGIN_DENIED，且 mock 未收到任何请求（证明 fetch 前拦截）", async () => {
  const before = denied!.hits.length;
  const r = await postRelay(srv!.base, JSON.stringify({
    url: `http://127.0.0.1:${denied!.port}/v1/chat/completions`,
  }));
  assert.equal(r.status, 403);
  assert.equal(r.json?.code, "RELAY_ORIGIN_DENIED");
  assert.equal(r.json?.origin, `http://127.0.0.1:${denied!.port}`);
  assert.equal(typeof r.json?.error, "string");
  assert.ok(r.json.error.length > 0, "error 应为中文可操作文案");
  assert.equal(denied!.hits.length, before, "拒绝必须发生在 fetch 之前：mock 不得收到任何请求");
  assert.ok(r.csp && r.csp.includes("connect-src"), "403 响应须带 content-security-policy");
});

test("③ 上游返回 302 → 403 + RELAY_REDIRECT_DENIED（redirect:manual，不自动跟随）", async () => {
  const r = await postRelay(srv!.base, JSON.stringify({
    url: `http://127.0.0.1:${allowed!.port}/redirect`,
  }));
  assert.equal(r.status, 403);
  assert.equal(r.json?.code, "RELAY_REDIRECT_DENIED");
  assert.equal(typeof r.json?.error, "string");
  assert.ok(r.json.error.includes(MOCK_REDIRECT_LOCATION), "错误文案应带上被拒绝的 Location");
});

test("④ 非法 JSON / 缺 url → 保持现有 400 行为不变", async () => {
  const r1 = await postRelay(srv!.base, "{not-valid-json");
  assert.equal(r1.status, 400);
  assert.equal(r1.json?.error, "无效 JSON");
  const r2 = await postRelay(srv!.base, JSON.stringify({ method: "POST" }));
  assert.equal(r2.status, 400);
  assert.equal(r2.json?.error, "缺少 url");
});

test("⑤ 响应带 SEC_HEADERS.content-security-policy，且 connect-src 与 relay 同源（含 env 扩展 origin）", async () => {
  const r = await fetch(srv!.base + "/healthz", { method: "GET" });
  assert.equal(r.status, 200);
  const csp = r.headers.get("content-security-policy");
  assert.ok(csp && csp.includes("connect-src"), "响应须带 CSP");
  assert.ok(csp!.includes(`http://127.0.0.1:${allowed!.port}`), "env 扩展的 origin 须同步进 CSP");
  assert.ok(!csp!.includes(`http://127.0.0.1:${denied!.port}`), "非白名单 origin 不得进 CSP");
});
