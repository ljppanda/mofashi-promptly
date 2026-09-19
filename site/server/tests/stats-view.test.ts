// tests/stats-view.test.ts
// 前端用量看板口径回归（离线、零网络、零 DOM）。
// 背景：后端 totals 的 runCount 是「分组求和、含子 run」，而成功/失败/未完成计数是「root run」口径。
//   两者分母不同，前端**不得**用 runCount 反推计数。本测试锁定 normalizeTotals 的两条规则：
//     1) 后端直接给出计数时，优先读之；2) 缺字段回退反推时，基数必须用 rootRunCount（不是 runCount）。
// normalizeTotals 是 views/stats.ts 里的纯函数（已导出，无副作用、不触 DOM），可安全在 node 下 import。

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTotals, normalizeGroup } from "../../src/views/stats.js";

// 空分组：只关心 totals 的计数逻辑（token/cost/latency 由 groups 派生，此处无需求）。
const NO_GROUPS: any[] = [];

test("normalizeTotals: 后端给了计数字段 → 直接采用（即使与 runCount 口径不符）", () => {
  const t = normalizeTotals(
    { runCount: 21, rootRunCount: 17, errorRate: 0, pendingRate: 4 / 17, errorCount: 0, pendingCount: 4, successCount: 13 },
    NO_GROUPS,
  );
  assert.equal(t.errorCount, 0);
  assert.equal(t.pendingCount, 4);
  assert.equal(t.successCount, 13);
  // 与 runCount 明显不同（21），证明没被反推污染
  assert.notEqual(t.errorCount + t.pendingCount + t.successCount, t.runCount);
});

test("normalizeTotals: 后端缺计数 → 回退用 rootRunCount 作基数（不是 runCount）", () => {
  // 关键对照：round(17 × 4/17) = 4 ✅；若错用 runCount 则 round(21 × 4/17) = 5 ✗
  const t = normalizeTotals(
    { runCount: 21, rootRunCount: 17, errorRate: 0, pendingRate: 4 / 17 },
    NO_GROUPS,
  );
  assert.equal(t.errorCount, 0, "error = round(17×0)=0");
  assert.equal(t.pendingCount, 4, "pending = round(17×(4/17))=4（用 rootRunCount，非 runCount→5）");
  assert.equal(t.successCount, 13, "success = 17-0-4=13（非 21-0-5=16）");
  assert.equal(t.errorCount + t.pendingCount + t.successCount, 17, "三计数之和 = rootRunCount");
});

test("normalizeTotals: 无 rootRunCount → 计数保持 null（绝不退回用 runCount 反推）", () => {
  const t = normalizeTotals({ runCount: 21, errorRate: 0.1, pendingRate: 0.2 }, NO_GROUPS);
  assert.equal(t.errorCount, null, "缺 rootRunCount 时不得用 runCount 反推");
  assert.equal(t.pendingCount, null);
  assert.equal(t.successCount, null);
});

test("normalizeTotals: 部分缺字段 → 只对缺失项回退，已有项不动", () => {
  const t = normalizeTotals(
    { runCount: 21, rootRunCount: 17, pendingRate: 4 / 17, successCount: 99 },
    NO_GROUPS,
  );
  assert.equal(t.successCount, 99, "后端给了 successCount 就直用，不反推");
  assert.equal(t.pendingCount, 4, "pendingCount 缺失 → 用 rootRunCount 反推");
  assert.equal(t.errorCount, null, "无 errorRate 也无 errorCount → 保持 null");
});

test("normalizeTotals: 空/undefined totals 不崩，计数为 null", () => {
  const t = normalizeTotals(undefined, NO_GROUPS);
  assert.equal(t.errorCount, null);
  assert.equal(t.pendingCount, null);
  assert.equal(t.successCount, null);
  assert.equal(t.runCount, null);
});

// ---------- T-06：kind 归一 + llmCallCount ----------

test("normalizeGroup: kind 透传（后端给出）；旧契约缺失时按 key 形态推断", () => {
  // 后端给了 kind → 直用
  assert.equal(normalizeGroup({ key: "agent:refine", kind: "flow", stats: { run_count: 1 } }).kind, "flow");
  assert.equal(normalizeGroup({ key: "deepseek·deepseek-chat·llm", kind: "llm", stats: { run_count: 1 } }).kind, "llm");
  // 旧契约无 kind → 按 key 形态推断：含 ":" → flow；以 ·llm 结尾 → llm
  assert.equal(normalizeGroup({ key: "llm:chat", stats: { run_count: 1 } }).kind, "flow");
  assert.equal(normalizeGroup({ key: "deepseek·deepseek-chat·llm", stats: { run_count: 1 } }).kind, "llm");
  assert.equal(normalizeGroup({ key: "deepseek·deepseek-chat·llm#2", stats: { run_count: 1 } }).kind, "llm");
});

test("normalizeTotals: llmCallCount 优先后端，缺失时由 kind==='llm' 的组兜底求和", () => {
  const groups: any[] = [
    { key: "agent:refine", kind: "flow", runCount: 7, totalTokens: 70, totalCost: 0, latencyP50: 1, promptTokens: 1, completionTokens: 1 },
    { key: "deepseek·deepseek-chat·llm", kind: "llm", runCount: 9, totalTokens: 900, totalCost: 0, latencyP50: 1, promptTokens: 1, completionTokens: 1 },
    { key: "deepseek-chat·llm", kind: "llm", runCount: 2, totalTokens: 200, totalCost: 0, latencyP50: 1, promptTokens: 1, completionTokens: 1 },
  ];
  // 后端给了 → 直用
  assert.equal(normalizeTotals({ llmCallCount: 11 }, groups).llmCallCount, 11);
  // 后端缺失 → 兜底：仅累加 llm 组（9+2=11，不含 flow 组的 7）
  assert.equal(normalizeTotals({}, groups).llmCallCount, 11);
});

test("normalizeTotals: rootRunCount / filteredNoiseCount 透传；filteredNoiseCount 缺省为 0", () => {
  const t = normalizeTotals({ rootRunCount: 12, filteredNoiseCount: 5 }, NO_GROUPS);
  assert.equal(t.rootRunCount, 12);
  assert.equal(t.filteredNoiseCount, 5);
  assert.equal(normalizeTotals({ rootRunCount: 12 }, NO_GROUPS).filteredNoiseCount, 0, "缺省 0");
});
