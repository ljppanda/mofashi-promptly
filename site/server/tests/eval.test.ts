// tests/eval.test.ts
// 评测统计与成对评测核心的离线回归（零网络）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapCI,
  mean,
  mulberry32,
  pairedDiffCI,
  signTestP,
} from "../src/eval-stats.js";
import { runPairwiseEval, splitScenarios, type Scenario } from "../src/eval-chain.js";

test("stats: mean 基本正确且空数组为 NaN", () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.ok(Number.isNaN(mean([])));
});

test("stats: mulberry32 同 seed 可复现", () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test("stats: bootstrapCI 同 seed 稳定且区间包含均值", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const a = bootstrapCI(xs, { seed: 1 });
  const b = bootstrapCI(xs, { seed: 1 });
  assert.deepEqual(a, b);
  assert.ok(a.lo <= a.mean && a.mean <= a.hi, JSON.stringify(a));
  assert.equal(a.n, 10);
});

test("stats: pairedDiffCI 计算配对差值", () => {
  const a = [3, 4, 5, 6];
  const b = [1, 2, 3, 4];
  const ci = pairedDiffCI(a, b, { seed: 2 });
  assert.equal(ci.mean, 2);
});

test("stats: pairedDiffCI 长度不一致抛错", () => {
  assert.throws(() => pairedDiffCI([1], [1, 2]), /长度/);
});

test("stats: signTestP 全胜时显著、五五开时不显著", () => {
  assert.ok(signTestP(10, 0) < 0.01);
  assert.ok(signTestP(5, 5) > 0.9);
  assert.equal(signTestP(0, 0), 1);
});

const scenarios: Scenario[] = [
  { industry: "法律", goal: "g1" },
  { industry: "医疗", goal: "g2" },
  { industry: "职场", goal: "g3" },
];

test("eval-chain: A 恒优于 B 时，胜场与显著性正确", async () => {
  const rep = await runPairwiseEval(
    scenarios,
    {
      produce: async (c) => (c === "A" ? "A-text" : "B-text"),
      judge: async (_s, x) => ({ winner: x.includes("A-text") ? "X" : "Y", reason: "ok" }),
    },
    { repeats: 2, seed: 3 },
  );
  assert.equal(rep.nComparisons, 6);
  assert.equal(rep.aWins, 6);
  assert.equal(rep.bWins, 0);
  assert.equal(rep.winRateA, 1);
  assert.ok(rep.pValue < 0.05);
});

test("eval-chain: 随机化确实会交换左右顺序（抵消位置偏好）", async () => {
  const rep = await runPairwiseEval(
    scenarios,
    {
      produce: async (c) => (c === "A" ? "A-text" : "B-text"),
      // 裁判永远选 X：若顺序固定，A 会 100% 或 0% 胜；随机化后应接近五五开。
      judge: async () => ({ winner: "X", reason: "always X" }),
    },
    { repeats: 20, seed: 11 },
  );
  assert.ok(rep.aWins > 0 && rep.bWins > 0, `a=${rep.aWins} b=${rep.bWins}`);
  assert.ok(rep.winRateA > 0.2 && rep.winRateA < 0.8, `winRate=${rep.winRateA}`);
});

test("eval-chain: 生成失败记为 invalid 且不计入胜率", async () => {
  const rep = await runPairwiseEval(
    [{ industry: "x", goal: "g" }],
    {
      produce: async () => { throw new Error("boom"); },
      judge: async () => ({ winner: "X", reason: "" }),
    },
    { repeats: 2 },
  );
  assert.equal(rep.invalid, 2);
  assert.equal(rep.aWins + rep.bWins, 0);
  assert.ok(Number.isNaN(rep.winRateA));
});

test("eval-chain: 裁判异常记为 invalid", async () => {
  const rep = await runPairwiseEval(
    [{ industry: "x", goal: "g" }],
    {
      produce: async () => "t",
      judge: async () => { throw new Error("judge down"); },
    },
    { repeats: 1 },
  );
  assert.equal(rep.invalid, 1);
});

test("splitScenarios: 确定性且 dev/holdout 不重叠", () => {
  const all: Scenario[] = Array.from({ length: 40 }, (_, i) => ({ industry: "x", goal: `goal-${i}` }));
  const dev1 = splitScenarios(all, "dev");
  const dev2 = splitScenarios(all, "dev");
  const hold = splitScenarios(all, "holdout");
  assert.deepEqual(dev1.map((s) => s.goal), dev2.map((s) => s.goal));
  assert.equal(dev1.length + hold.length, all.length);
  const devSet = new Set(dev1.map((s) => s.goal));
  assert.ok(hold.every((s) => !devSet.has(s.goal)));
});
