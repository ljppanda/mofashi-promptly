// tests/ensure-project.test.ts
// ensureProject 回归测试（离线、零网络，全部走注入的 fetch 替身）。
// 背景（2026-09-18 真机实测）：`POST /projects` 已废弃返 404，改走 `GET /sessions?name=`。
// 用 createEnsureProject(deps) 注入依赖，规避模块级单例与 LS_ENABLED 常量的相互干扰。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEnsureProject, type EnsureProjectDeps } from "../src/langsmith.js";

interface Recorded { url: string; method: string; headers: Record<string, string>; body?: string; }

// 可编程 fetch 替身：按 method + url 决定响应；记录每次调用。
function makeDeps(opts: {
  enabled?: boolean;
  project?: string;
  responder: (ctx: { url: string; method: string; callIndex: number }) => { status: number; ok?: boolean; text: string };
}): { deps: EnsureProjectDeps; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const deps: EnsureProjectDeps = {
    enabled: opts.enabled ?? true,
    apiKey: "test-key",
    endpoint: "https://api.smith.langchain.com",
    project: opts.project ?? "模法师-Promptly",
    fetchRaw: async (url, init) => {
      const callIndex = calls.length;
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      const r = opts.responder({ url, method: init.method, callIndex });
      return { status: r.status, ok: r.ok ?? (r.status >= 200 && r.status < 300), text: r.text };
    },
  };
  return { deps, calls };
}

// ---------- 1. GET /sessions 返回数组 → 取 [0].id ----------

test("ensureProject: GET /sessions 返回数组 → 取 [0].id（不再走 POST /projects）", async () => {
  const { deps, calls } = makeDeps({
    responder: ({ url }) => {
      if (url.includes("/sessions?name=")) {
        return { status: 200, text: JSON.stringify([{ id: "4f28d3f1-d6d7-4234-92df-a3d3b9e8f354", name: "模法师-Promptly" }]) };
      }
      return { status: 404, text: "{}" };
    },
  });
  const ensure = createEnsureProject(deps);
  const id = await ensure();
  assert.equal(id, "4f28d3f1-d6d7-4234-92df-a3d3b9e8f354");
  assert.equal(calls.length, 1, "命中主路径后不应再发 POST /projects");
  assert.equal(calls[0].method, "GET");
  assert.ok(calls[0].url.endsWith("/sessions?name=" + encodeURIComponent("模法师-Promptly")));
  assert.equal(calls[0].headers["x-api-key"], "test-key");
});

test("ensureProject: 项目名被 URL 编码（中文/dot 不裸拼）", async () => {
  const { deps, calls } = makeDeps({
    project: "模法师·Promptly/测试",
    responder: () => ({ status: 200, text: JSON.stringify([{ id: "pid-1" }]) }),
  });
  const ensure = createEnsureProject(deps);
  await ensure();
  assert.equal(calls[0].url, "https://api.smith.langchain.com/sessions?name=" + encodeURIComponent("模法师·Promptly/测试"));
  assert.ok(!calls[0].url.includes("·"), "URL 中不应含未编码的中点");
});

// ---------- 2. GET /sessions 返回空数组 → 走 POST /projects 兜底 ----------

test("ensureProject: GET /sessions 空数组 → 兜底 POST /projects 取 id", async () => {
  const { deps, calls } = makeDeps({
    responder: ({ url }) => {
      if (url.includes("/sessions?name=")) return { status: 200, text: "[]" };
      return { status: 200, text: JSON.stringify({ id: "created-999" }) };
    },
  });
  const ensure = createEnsureProject(deps);
  const id = await ensure();
  assert.equal(id, "created-999");
  assert.equal(calls.length, 2, "应发 2 次：GET /sessions + POST /projects");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[1].method, "POST");
  assert.ok(calls[1].url.endsWith("/projects"));
  assert.equal(calls[1].headers["content-type"], "application/json");
});

test("ensureProject: GET /sessions 200 但 body 非数组（异常形态）→ 也走兜底", async () => {
  const { deps, calls } = makeDeps({
    responder: ({ url }) => {
      if (url.includes("/sessions?name=")) return { status: 200, text: JSON.stringify({ id: "not-array" }) };
      return { status: 200, text: JSON.stringify({ id: "fallback-ok" }) };
    },
  });
  const ensure = createEnsureProject(deps);
  const id = await ensure();
  assert.equal(id, "fallback-ok");
  assert.equal(calls.length, 2);
});

// ---------- 3. 两条都失败 → 返回 null 且不抛异常 ----------

test("ensureProject: GET 与 POST 都失败 → 返回 null，不抛异常", async () => {
  const { deps, calls } = makeDeps({
    responder: () => ({ status: 404, text: '{"detail":"Not Found"}' }),
  });
  const ensure = createEnsureProject(deps);
  await assert.doesNotReject(async () => {
    const id = await ensure();
    assert.equal(id, null);
  });
  assert.equal(calls.length, 2, "两条路径都试过");
});

test("ensureProject: fetchRaw 抛网络异常 → 捕获返回 null，不抛", async () => {
  const deps: EnsureProjectDeps = {
    enabled: true, apiKey: "k", endpoint: "https://api.smith.langchain.com", project: "p",
    fetchRaw: async () => { throw new Error("ENOTFOUND"); },
  };
  const ensure = createEnsureProject(deps);
  const id = await ensure();
  assert.equal(id, null);
});

test("ensureProject: GET 返回 404、POST 返回 404（真机现状复刻）→ null", async () => {
  const { deps } = makeDeps({
    responder: ({ url }) =>
      url.includes("/sessions")
        ? { status: 404, text: '{"title":"Not Found","status":404}' }
        : { status: 404, text: '{"title":"Not Found","status":404}' },
  });
  const ensure = createEnsureProject(deps);
  assert.equal(await ensure(), null);
});

// ---------- 4. !LS_ENABLED → 零 fetch 调用 ----------

test("ensureProject: !enabled → 零 fetch、立即返回 null", async () => {
  const { deps, calls } = makeDeps({
    enabled: false,
    responder: () => ({ status: 200, text: JSON.stringify([{ id: "should-not-be-used" }]) }),
  });
  const ensure = createEnsureProject(deps);
  const id = await ensure();
  assert.equal(id, null);
  assert.equal(calls.length, 0, "关闭态必须零网络请求");
});

// ---------- 5. 单例缓存 + 并发去重 ----------

test("ensureProject: 单例缓存生效 → 连续两次调用只发 1 次请求", async () => {
  const { deps, calls } = makeDeps({
    responder: () => ({ status: 200, text: JSON.stringify([{ id: "pid-cache" }]) }),
  });
  const ensure = createEnsureProject(deps);
  const a = await ensure();
  const b = await ensure();
  assert.equal(a, "pid-cache");
  assert.equal(b, "pid-cache");
  assert.equal(calls.length, 1, "第二次应命中单例缓存，零新增 fetch");
});

test("ensureProject: 并发调用共享 in-flight → 只发 1 次请求", async () => {
  let resolveFetch: (() => void) | null = null;
  let callCount = 0;
  const deps: EnsureProjectDeps = {
    enabled: true, apiKey: "k", endpoint: "https://api.smith.langchain.com", project: "p",
    fetchRaw: async () => {
      callCount++;
      // 挂起，模拟网络在途
      await new Promise<void>((res) => { resolveFetch = res; });
      return { status: 200, ok: true, text: JSON.stringify([{ id: "pid-concurrent" }]) };
    },
  };
  const ensure = createEnsureProject(deps);
  const p1 = ensure();
  const p2 = ensure();
  const p3 = ensure();
  resolveFetch!();
  const [a, b, c] = await Promise.all([p1, p2, p3]);
  assert.equal(a, "pid-concurrent");
  assert.equal(b, "pid-concurrent");
  assert.equal(c, "pid-concurrent");
  assert.equal(callCount, 1, "并发 3 次应共享同一 in-flight，只发 1 次");
});

test("ensureProject: 失败不缓存 Promise → 下次调用可重试（第二次成功）", async () => {
  let n = 0;
  const deps: EnsureProjectDeps = {
    enabled: true, apiKey: "k", endpoint: "https://api.smith.langchain.com", project: "p",
    fetchRaw: async () => {
      n++;
      if (n <= 2) return { status: 404, ok: false, text: "{}" }; // 第 1 轮 GET+POST 都失败
      return { status: 200, ok: true, text: JSON.stringify([{ id: "retry-ok" }]) };
    },
  };
  const ensure = createEnsureProject(deps);
  assert.equal(await ensure(), null, "首轮失败 → null");
  assert.equal(await ensure(), "retry-ok", "次轮应重试并成功（失败未被缓存）");
});
