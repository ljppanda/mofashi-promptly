// tests/resilience.test.ts
// 第一档加固（数据可靠性 / LLM 韧性 / 可观测）的关键不变量回归测试（离线、零网络）。
// 守四件事：schema 迁移幂等、重试退避分类、主备解析、运营指标累计、prompt 版本注册。

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, appliedVersions, MIGRATIONS } from "../src/migrations.js";
import { withRetry, resolveFallbacks } from "../src/providers.js";
import {
  snapshot, recordProviderAttempt, recordGeneration, recordRag, recordFailover, _resetForTest,
} from "../src/opmetrics.js";
import { getPrompt, latestVersion, PROMPT_VERSIONS } from "../src/prompts.js";

// 期望已应用的迁移版本：直接从迁移注册表推导，新增迁移（v5/v6…）后无需再手动改这里的断言
const EXPECTED_VERSIONS = MIGRATIONS.map((m) => m.version);

// ---------------- schema 迁移 ----------------
test("migrations: 内存库应用基线 v1 并创建全部表", () => {
  const db = new DatabaseSync(":memory:");
  const ran = runMigrations(db);
  assert.ok(ran.includes("baseline_2026_07_29"), "应执行基线迁移");
  assert.ok(ran.includes("comments_2026_07_29"), "应执行 v2 评论表迁移");
  for (const t of ["metrics", "community", "users", "reports", "moderation_log", "traces", "comments", "schema_migrations", "collections", "collection_items"]) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
    assert.ok(row, `表 ${t} 应存在`);
  }
  assert.deepEqual(appliedVersions(db), EXPECTED_VERSIONS);
});

test("migrations: 重复运行幂等（老库不破坏）", () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const ran2 = runMigrations(db);
  assert.deepEqual(ran2, [], "第二次不应再执行任何迁移");
  assert.deepEqual(appliedVersions(db), EXPECTED_VERSIONS);
});

test("migrations: 在已有表上追加 v2 能补齐而不冲突", () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  assert.deepEqual(appliedVersions(db), EXPECTED_VERSIONS, "基线 v1 + 评论 v2 + traces user_id v3 + 邮箱/重置 v4 应已应用");
  // 模拟一次外部已记录的 v2（非本 runner 写入的同名行），验证 runner 按版本号幂等、不会重复补齐
  db.exec("INSERT INTO schema_migrations(name,version,applied_at) VALUES('v2_fake',2,0)");
  // 再跑 runMigrations（无新迁移定义）应保持幂等、不冲突
  const ran = runMigrations(db);
  assert.deepEqual(ran, []);
  assert.deepEqual([...new Set(appliedVersions(db))], EXPECTED_VERSIONS);
});

// ---------------- 重试退避分类 ----------------
test("withRetry: 可重试错误(5xx)会重试并最终成功", async () => {
  let n = 0;
  const r = await withRetry(async () => {
    n++;
    if (n < 3) throw new Error("[500] server error");
    return "ok";
  }, { baseMs: 1, maxMs: 2, maxRetries: 3 });
  assert.equal(r, "ok");
  assert.equal(n, 3);
});

test("withRetry: 不可重试错误(400)立即抛出不重试", async () => {
  let n = 0;
  await assert.rejects(
    async () => withRetry(async () => { n++; throw new Error("[400] bad request"); }, { baseMs: 1, maxMs: 2, maxRetries: 3 }),
    /400/,
  );
  assert.equal(n, 1, "400 不应重试");
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
    async () => withRetry(async () => { n++; throw new Error("[503] unavailable"); }, { baseMs: 1, maxMs: 2, maxRetries: 2 }),
    /503/,
  );
  assert.equal(n, 3, "应尝试 1 次 + 重试 2 次 = 3 次");
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

// ---------------- 运营指标累计 ----------------
test("opmetrics: 初始为零，记录后正确累计", () => {
  _resetForTest();
  assert.equal(snapshot().generation.attempts, 0);
  recordProviderAttempt("openai", "gpt-4o", true, 100);
  recordProviderAttempt("openai", "gpt-4o", false, 200, "boom");
  recordGeneration(true);
  recordGeneration(false);
  recordRag(1, 1);
  recordRag(1, 0);
  recordFailover(true);
  const s = snapshot();
  assert.equal(s.providers.length, 1);
  assert.equal(s.providers[0].attempts, 2);
  assert.equal(s.providers[0].success, 1);
  assert.equal(s.providers[0].successRate, 0.5);
  assert.equal(s.providers[0].avgLatencyMs, 150);
  assert.equal(s.generation.attempts, 2);
  assert.equal(s.generation.success, 1);
  assert.equal(s.rag.queries, 2);
  assert.equal(s.rag.hits, 1);
  assert.equal(s.rag.hitRate, 0.5);
  assert.equal(s.failover.attempts, 1);
  assert.equal(s.failover.success, 1);
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
  assert.ok(getPrompt("use").includes("提示词落地工程师"));
});

test("prompts: 未知 prompt 抛错；指定不存在版本回退最新", () => {
  assert.throws(() => getPrompt("nope"));
  assert.ok(getPrompt("clarify_interview", 999).includes("提示词需求访谈助手"));
});
