// tests/agent-trace-endpoint.test.ts
// T03 端点级回归测试：`POST /agent/trace`（离线、零真实网络）。
//
// 动机：tests/trace.test.ts 覆盖的是 **纯函数层**（parseTraceReport / toUsageMetadata / emitTraceReport），
// 端点 handler（index.ts 的 handleAgentTrace）的 HTTP 分支此前只靠代码审查、无测试证据。
//
// 方法（为何用子进程）：index.ts 的 handler 未导出，且 **import 该模块会触发顶层副作用**
// （`server.listen(PORT)` 绑定端口 + process.on 信号注册 + warmupRag），无法在测试进程内安全 import。
// 因此本测试以 **子进程** 启动真实服务器（`npx tsx src/index.ts`），再用 `fetch` 打真实 HTTP 请求——
// 这是在不改动 index.ts（T02 领地）前提下的 **真·HTTP 层覆盖**。
//
// 开关控制：LS_ENABLED 是 langsmith.ts 在 **模块加载期** 由 process.env 求值的常量，
// 故通过给子进程注入不同 env（LANGSMITH_ENABLED / LANGSMITH_ENDPOINT）来控制开/关态与网络目标。
// 离线保证：关闭态下端点零网络早退；开启态下把 LANGSMITH_ENDPOINT 指向 **本机已关闭端口**，
//         任何真实上报都会 connection-refused（不触云、不依赖 .env 里的真实 Key）。

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, "..", "src", "index.ts");
const IS_WIN = process.platform === "win32";

// 每个场景用独立端口，避免与其它测试 / 已运行实例冲突。
const PORT_DISABLED = 18811;
const PORT_ENABLED = 18812;
// 指向本机一个确定关闭的端口：开启态下任何真实 LangSmith 上报都会失败（离线安全网）。
const DEAD_ENDPOINT = "http://127.0.0.1:1";

// ---------------- 子进程服务器助手 ----------------

interface RunningServer {
  proc: ChildProcess;
  base: string;
}

// 启动一个真实服务器子进程，轮询直到端口就绪（或超时）。
async function startServer(port: number, env: Record<string, string>): Promise<RunningServer> {
  const proc = spawn("npx", ["tsx", SERVER_ENTRY], {
    env: { ...process.env, ...env, PORT: String(port) },
    shell: true,
    // POSIX 下独立进程组，便于整体 kill 掉 npx→tsx→node 整棵树（避免残留进程吊住事件循环）。
    detached: !IS_WIN,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // 吞掉子进程输出，避免污染测试输出；保留最后若干行便于失败诊断。
  let tail = "";
  proc.stdout?.on("data", (d: Buffer) => { tail = (tail + d.toString()).slice(-2000); });
  proc.stderr?.on("data", (d: Buffer) => { tail = (tail + d.toString()).slice(-2000); });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40_000; // 冷启动含重型依赖导入，给足 40s
  // 轮询 /healthz（GET，无副作用）直到就绪。
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`服务器子进程提前退出（code=${proc.exitCode}）：\n${tail}`);
    }
    try {
      const r = await fetch(base + "/healthz", { method: "GET" });
      if (r.ok) return { proc, base };
    } catch {
      /* 未就绪，继续轮询 */
    }
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
      // Windows：/T 连整棵进程树，/F 强杀（npx 会派生出 tsx->node 子进程）。
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      // POSIX：杀独立进程组（负 pid），覆盖 npx→tsx→node 全树。
      try { process.kill(-pid, "SIGKILL"); } catch { /* 组可能已退出 */ }
    }
  } catch { /* ignore */ }
  try { s.proc.kill(); } catch { /* ignore */ }
}

// 便捷：POST /agent/trace
async function postTrace(base: string, body: string): Promise<{ status: number; json: unknown; text: string }> {
  const r = await fetch(base + "/agent/trace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
  return { status: r.status, json, text };
}

// 合法完整报告体（可复用）。
const VALID_BODY = JSON.stringify({
  flow: "llm:chat",
  label: "被测模型",
  metadata: { industry: "餐饮" },
  calls: [{ provider: "deepseek", model: "deepseek-chat", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, elapsedMs: 123 }],
});

// ---------------- 关闭态（LANGSMITH_ENABLED=0）：零解析早退、恒 200 ----------------

let disabled: RunningServer | null = null;
before(async () => {
  disabled = await startServer(PORT_DISABLED, { LANGSMITH_ENABLED: "0", LANGSMITH_ENDPOINT: DEAD_ENDPOINT });
});
after(() => stopServer(disabled));

test("[关闭态] 非法 JSON 请求体也必须 200 {ok:true}（不因解析失败而 500）", async () => {
  const r = await postTrace(disabled!.base, "this-is-not-json");
  assert.equal(r.status, 200, "关闭态应零解析早退，恒 200");
  assert.deepEqual(r.json, { ok: true });
});

test("[关闭态] 合法报告体 → 200 {ok:true}", async () => {
  const r = await postTrace(disabled!.base, VALID_BODY);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
});

test("[关闭态] 白名单外的 flow（agent:generate）也 200（关闭态不校验、直接早退）", async () => {
  // 关闭态下 even 非法 flow 都直接 {ok:true}——因为根本不解析。此用例锁定「早退」语义。
  const r = await postTrace(disabled!.base, JSON.stringify({ flow: "agent:generate", calls: [{ provider: "a", model: "b" }] }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
});

test("[关闭态] 空 calls 也 200（同上，早退不校验）", async () => {
  const r = await postTrace(disabled!.base, JSON.stringify({ flow: "llm:chat", calls: [] }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
});

// ---------------- 开启态（LANGSMITH_ENABLED=1）：校验与静默兜底 ----------------

let enabled: RunningServer | null = null;
before(async () => {
  // Key 用假值（保证不进真云也能进「开启」分支）；ENDPOINT 指向已关闭端口 → 任何上报即失败。
  enabled = await startServer(PORT_ENABLED, {
    LANGSMITH_ENABLED: "1",
    LANGSMITH_API_KEY: "test-key-offline",
    LANGSMITH_ENDPOINT: DEAD_ENDPOINT,
  });
});
after(() => stopServer(enabled));

test("[开启态] 非法 JSON → 400 {ok:false}", async () => {
  const r = await postTrace(enabled!.base, "{not valid json");
  assert.equal(r.status, 400);
  assert.equal((r.json as any)?.ok, false);
  assert.equal(typeof (r.json as any)?.error, "string");
});

test("[开启态] flow 不在白名单（agent:generate 后端流程名）→ 400（默认走 PUBLIC_FLOWS 收窄）", async () => {
  const r = await postTrace(enabled!.base, JSON.stringify({ flow: "agent:generate", calls: [{ provider: "a", model: "b" }] }));
  assert.equal(r.status, 400, "agent:* 不应被前端端点接受");
  assert.equal((r.json as any)?.ok, false);
});

test("[开启态] 未知 flow → 400", async () => {
  const r = await postTrace(enabled!.base, JSON.stringify({ flow: "nope:nope", calls: [{ provider: "a", model: "b" }] }));
  assert.equal(r.status, 400);
  assert.equal((r.json as any)?.ok, false);
});

test("[开启态] calls 为空数组 → 400", async () => {
  const r = await postTrace(enabled!.base, JSON.stringify({ flow: "llm:chat", calls: [] }));
  assert.equal(r.status, 400);
  assert.equal((r.json as any)?.ok, false);
});

test("[开启态] call 缺 provider/model → 400", async () => {
  const r = await postTrace(enabled!.base, JSON.stringify({ flow: "llm:chat", calls: [{ model: "x" }] }));
  assert.equal(r.status, 400);
  assert.equal((r.json as any)?.ok, false);
});

test("[开启态] calls 非法（非数组）→ 400", async () => {
  const r = await postTrace(enabled!.base, JSON.stringify({ flow: "llm:chat", calls: "nope" }));
  assert.equal(r.status, 400);
  assert.equal((r.json as any)?.ok, false);
});

test("[开启态] 合法报告体 → 200 {ok:true}，且上报目标不可达时静默返回（不 5xx）", async () => {
  // ENDPOINT 指向已关闭端口：emitTraceReport 内部与端点外层双 try/catch 应吞掉连接失败，
  // 端点仍回 200 {ok:true}（埋点永不向调用方报错）。这是「异常兜底」的直接证据。
  const r = await postTrace(enabled!.base, VALID_BODY);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
});

test("[开启态] 多个 call 的合法报告体 → 200 {ok:true}", async () => {
  const r = await postTrace(enabled!.base, JSON.stringify({
    flow: "judge:eval",
    label: "裁判模型",
    calls: [
      { provider: "claude", model: "claude-sonnet-4.6", usage: { inputTokens: 100, outputTokens: 20 } },
      { provider: "openai", model: "gpt-5.5", usage: { inputTokens: 50, outputTokens: 10 }, elapsedMs: 500 },
    ],
  }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
});
