// tests/resilience.test.ts
// LLM 韧性关键不变量回归测试（离线、零网络）。
// 守三件事：重试退避分类（含 AbortError 不重试）、主备解析、prompt 版本注册。
// （裁剪为个人本地版后：DB 迁移(migrations)、运营指标(opmetrics)已移除，相关测试随功能一并删除；
//  社区/防护相关测试见 community.test.ts/security.test.ts 的删除记录——功能已裁剪。）

import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, resolveFallbacks, statusOf, tokenLimitField } from "../src/providers.js";
import { getPrompt, latestVersion, PROMPT_VERSIONS } from "../src/prompts.js";

// ---------------- 重试退避分类 ----------------
// 回归重点：生产错误格式是 `[OpenAI] 500 ...`（方括号里是厂商名），
// 旧实现用 /\[(\d{3})\]/ 只认 `[500]`，导致真实 5xx/429 永不重试。
test("statusOf: 解析生产错误格式 `[OpenAI] 500 ...`", () => {
  assert.equal(statusOf(new Error("[OpenAI] 500 internal server error")), 500);
  assert.equal(statusOf(new Error("[DeepSeek] 429 rate limited")), 429);
  assert.equal(statusOf(new Error("[Kimi] 401 unauthorized")), 401);
  assert.equal(statusOf(new Error("[Gemini] 503 unavailable")), 503);
});

test("statusOf: 优先读取结构化 status 字段", () => {
  assert.equal(statusOf(Object.assign(new Error("upstream failed"), { status: 502 })), 502);
  assert.equal(statusOf(Object.assign(new Error("x"), { response: { status: 504 } })), 504);
  assert.equal(statusOf(new Error("no status here")), null);
});

test("withRetry: 真实 5xx 错误会重试并最终成功", async () => {
  let n = 0;
  const r = await withRetry(async () => {
    n++;
    if (n < 3) throw new Error("[OpenAI] 500 server error");
    return "ok";
  }, { baseMs: 1, maxMs: 2, maxRetries: 3 });
  assert.equal(r, "ok");
  assert.equal(n, 3);
});

test("withRetry: 真实 429 限流会重试", async () => {
  let n = 0;
  const r = await withRetry(async () => {
    n++;
    if (n < 2) throw new Error("[DeepSeek] 429 rate limited");
    return "ok";
  }, { baseMs: 1, maxMs: 2, maxRetries: 3 });
  assert.equal(r, "ok");
  assert.equal(n, 2);
});

test("withRetry: 不可重试错误(400)立即抛出不重试", async () => {
  let n = 0;
  await assert.rejects(
    async () => withRetry(async () => { n++; throw new Error("[OpenAI] 400 bad request"); }, { baseMs: 1, maxMs: 2, maxRetries: 3 }),
    /400/,
  );
  assert.equal(n, 1, "400 不应重试");
});

test("withRetry: 401 鉴权错误不重试", async () => {
  let n = 0;
  await assert.rejects(
    async () => withRetry(async () => { n++; throw new Error("[OpenAI] 401 invalid api key"); }, { baseMs: 1, maxMs: 2, maxRetries: 3 }),
    /401/,
  );
  assert.equal(n, 1, "401 不应重试");
});

test("withRetry: 网络错误被视为可重试", async () => {
  let n = 0;
  const r = await withRetry(async () => { n++; if (n < 2) throw new Error("fetch failed ECONNRESET"); return "ok"; }, { baseMs: 1, maxMs: 2, maxRetries: 3 });
  assert.equal(r, "ok");
  assert.equal(n, 2);
});

test("withRetry: 超出重试上限后抛出最后错误", async () => {
  let n = 0;
  await assert.rejects(
    async () => withRetry(async () => { n++; throw new Error("[OpenAI] 503 unavailable"); }, { baseMs: 1, maxMs: 2, maxRetries: 2 }),
    /503/,
  );
  assert.equal(n, 3, "应尝试 1 次 + 重试 2 次 = 3 次");
});

test("withRetry: AbortError(用户停止)不重试", async () => {
  // 守 bugfix：用户主动停止产生的 AbortError 不应被当作可重试错误空等
  let n = 0;
  await assert.rejects(
    async () => withRetry(async () => { n++; throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" }); }, { baseMs: 1, maxMs: 2, maxRetries: 3 }),
    /aborted/,
  );
  assert.equal(n, 1, "AbortError 不应重试");
});

test("withRetry: TimeoutError(服务端超时)可重试", async () => {
  // 超时与用户停止必须区分：超时值得重试，用户停止不值得。
  let n = 0;
  const r = await withRetry(async () => {
    n++;
    if (n < 2) throw Object.assign(new Error("模型调用超时"), { name: "TimeoutError" });
    return "ok";
  }, { baseMs: 1, maxMs: 2, maxRetries: 3 });
  assert.equal(r, "ok");
  assert.equal(n, 2);
});

test("tokenLimitField: o 系列 / gpt-5 使用 max_completion_tokens", () => {
  assert.equal(tokenLimitField("o1-mini"), "max_completion_tokens");
  assert.equal(tokenLimitField("o3"), "max_completion_tokens");
  assert.equal(tokenLimitField("gpt-5"), "max_completion_tokens");
  assert.equal(tokenLimitField("gpt-4o-mini"), "max_tokens");
  assert.equal(tokenLimitField("deepseek-chat"), "max_tokens");
});

// ---------------- 主备解析 ----------------
test("resolveFallbacks: 无环境变量返回空", () => {
  const oldP = process.env.LLM_FALLBACK_PROVIDERS;
  const oldK = process.env.LLM_FALLBACK_API_KEY;
  delete process.env.LLM_FALLBACK_PROVIDERS;
  delete process.env.LLM_FALLBACK_API_KEY;
  assert.deepEqual(resolveFallbacks(), []);
  if (oldP) process.env.LLM_FALLBACK_PROVIDERS = oldP;
  if (oldK) process.env.LLM_FALLBACK_API_KEY = oldK;
});

test("resolveFallbacks: 解析 provider:model 列表并带入备用 Key", () => {
  const oldP = process.env.LLM_FALLBACK_PROVIDERS;
  const oldK = process.env.LLM_FALLBACK_API_KEY;
  process.env.LLM_FALLBACK_PROVIDERS = "openrouter:openai/gpt-4o, deepseek:deepseek-chat";
  process.env.LLM_FALLBACK_API_KEY = "sk-test";
  const f = resolveFallbacks();
  assert.equal(f.length, 2);
  assert.equal(f[0].provider, "openrouter");
  assert.equal(f[0].model, "openai/gpt-4o");
  assert.equal(f[1].provider, "deepseek");
  assert.equal(f[1].apiKey, "sk-test");
  if (oldP) process.env.LLM_FALLBACK_PROVIDERS = oldP;
  if (oldK) process.env.LLM_FALLBACK_API_KEY = oldK;
});

// ---------------- prompt 版本注册 ----------------
test("prompts: 全部 prompt 均有 v1 且 getPrompt 返回含关键指令的文本", () => {
  const ids = Object.keys(PROMPT_VERSIONS);
  assert.ok(ids.length >= 7, "应至少注册 7 个 prompt");
  for (const id of ids) {
    assert.ok(PROMPT_VERSIONS[id].some((d) => d.version === 1), `${id} 应有 v1`);
    assert.ok(getPrompt(id).length > 20, `${id} 文本不应为空`);
  }
  assert.ok(getPrompt("draft").includes("提示词模板架构师"));
  assert.ok(getPrompt("draft").includes("单行合法 JSON"), "draft 最新版(v3)应包含单行 JSON 约束");
  assert.ok(getPrompt("use").includes("提示词落地工程师"));
});

test("prompts: 未知 prompt 抛错；指定不存在版本回退最新", () => {
  assert.throws(() => getPrompt("nope"));
  assert.ok(getPrompt("clarify_interview", 999).includes("提示词需求访谈助手"));
});
