// eval-chain.ts
// 可测试的成对评测核心：把「生成」与「裁判」注入进来，核心只负责
//   1) 盲测随机化（裁判不知道哪条是实验组）
//   2) 重复采样与结果映射
//   3) 统计汇总（胜率 + bootstrap CI + 符号检验）
// CLI 见 scripts/eval_chain.ts；离线单测见 tests/eval-chain.test.ts。

import { bootstrapCI, mean, mulberry32, signTestP, type CI } from "./eval-stats.js";

export interface Scenario {
  industry: string;
  goal: string;
}

export type Condition = "A" | "B";
export type Presented = "X" | "Y";
export type Outcome = Condition | "tie" | "invalid";

export interface Verdict {
  winner: Presented | "tie";
  reason: string;
}

export interface PairEvalDeps {
  /** 生成某条件在某个场景下的产物（成品提示词）。 */
  produce: (condition: Condition, scenario: Scenario) => Promise<string>;
  /** 盲裁判：只看到 X/Y 两条文本，不知道它们属于哪个条件。 */
  judge: (scenario: Scenario, x: string, y: string) => Promise<Verdict>;
}

export interface PairEvalOptions {
  /** 每个场景重复比较次数（每次重新随机左右顺序）。默认 3。 */
  repeats?: number;
  /** 随机种子：保证同 seed 复跑结果一致。 */
  seed?: number;
  onProgress?: (done: number, total: number, message: string) => void;
}

export interface ComparisonRecord {
  scenario: Scenario;
  repeat: number;
  /** 呈现给裁判的 X 槽位实际是哪个条件。 */
  first: Condition;
  outcome: Outcome;
  reason: string;
}

export interface ScenarioSummary {
  scenario: Scenario;
  aWins: number;
  bWins: number;
  ties: number;
  invalid: number;
  majority: Condition | "tie" | "invalid";
}

export interface PairReport {
  nScenarios: number;
  nComparisons: number;
  aWins: number;
  bWins: number;
  ties: number;
  invalid: number;
  /** 排除平局后的 A 胜率。 */
  winRateA: number;
  winRateCI: CI;
  pValue: number;
  /** 每场景的平均分差口径：A 胜=+1，B 胜=-1，平=0（无效不计）。 */
  meanScore: number;
  perScenario: ScenarioSummary[];
  records: ComparisonRecord[];
}

function other(c: Condition): Condition {
  return c === "A" ? "B" : "A";
}

export async function runPairwiseEval(
  scenarios: readonly Scenario[],
  deps: PairEvalDeps,
  opts: PairEvalOptions = {},
): Promise<PairReport> {
  const repeats = Math.max(1, opts.repeats ?? 3);
  const seed = opts.seed ?? 20260101;
  const records: ComparisonRecord[] = [];
  const total = scenarios.length * repeats;
  let done = 0;

  for (let si = 0; si < scenarios.length; si++) {
    const scenario = scenarios[si];
    let aText = "";
    let bText = "";
    let produceErr = "";

    try {
      [aText, bText] = await Promise.all([
        deps.produce("A", scenario),
        deps.produce("B", scenario),
      ]);
    } catch (e) {
      produceErr = String((e as Error)?.message ?? e);
    }

    for (let r = 0; r < repeats; r++) {
      if (produceErr) {
        records.push({ scenario, repeat: r, first: "A", outcome: "invalid", reason: `生成失败：${produceErr}` });
        done++;
        opts.onProgress?.(done, total, `✗ ${scenario.industry} 生成失败`);
        continue;
      }

      // 每次重复都重新随机左右顺序，抵消位置偏好（position bias）。
      const rnd = mulberry32(seed + si * 1009 + r * 7919);
      const first: Condition = rnd() < 0.5 ? "A" : "B";
      const x = first === "A" ? aText : bText;
      const y = first === "A" ? bText : aText;

      let outcome: Outcome = "invalid";
      let reason = "";
      try {
        const v = await deps.judge(scenario, x, y);
        reason = v.reason || "";
        if (v.winner === "tie") outcome = "tie";
        else if (v.winner === "X") outcome = first;
        else if (v.winner === "Y") outcome = other(first);
      } catch (e) {
        reason = `裁判失败：${String((e as Error)?.message ?? e)}`;
      }

      records.push({ scenario, repeat: r, first, outcome, reason });
      done++;
      opts.onProgress?.(done, total, `${scenario.industry} · 第 ${r + 1}/${repeats} 次 → ${outcome}`);
    }
  }

  const valid = records.filter((r) => r.outcome !== "invalid");
  const aWins = valid.filter((r) => r.outcome === "A").length;
  const bWins = valid.filter((r) => r.outcome === "B").length;
  const ties = valid.filter((r) => r.outcome === "tie").length;
  const invalid = records.length - valid.length;
  const decided = aWins + bWins;

  const winRateA = decided ? aWins / decided : NaN;
  const winRateCI = bootstrapCI(valid.filter((r) => r.outcome !== "tie").map((r) => (r.outcome === "A" ? 1 : 0)), {
    seed,
  });
  const pValue = signTestP(aWins, bWins);
  const meanScore = mean(valid.map((r) => (r.outcome === "A" ? 1 : r.outcome === "B" ? -1 : 0)));

  const perScenario: ScenarioSummary[] = scenarios.map((scenario) => {
    const rs = records.filter((r) => r.scenario === scenario);
    const a = rs.filter((r) => r.outcome === "A").length;
    const b = rs.filter((r) => r.outcome === "B").length;
    const t = rs.filter((r) => r.outcome === "tie").length;
    const bad = rs.filter((r) => r.outcome === "invalid").length;
    const majority: ScenarioSummary["majority"] = bad === rs.length ? "invalid" : a > b ? "A" : b > a ? "B" : "tie";
    return { scenario, aWins: a, bWins: b, ties: t, invalid: bad, majority };
  });

  return {
    nScenarios: scenarios.length,
    nComparisons: records.length,
    aWins,
    bWins,
    ties,
    invalid,
    winRateA,
    winRateCI,
    pValue,
    meanScore,
    perScenario,
    records,
  };
}

// 确定性数据划分：用于「调参集 / 留出集」。
// 以 goal 的稳定哈希取模，保证同一份场景每次划分一致，且不依赖数组顺序。
export function splitScenarios(
  scenarios: readonly Scenario[],
  part: "dev" | "holdout" | "all",
): Scenario[] {
  if (part === "all") return [...scenarios];
  return scenarios.filter((s) => {
    let h = 2166136261;
    for (let i = 0; i < s.goal.length; i++) {
      h ^= s.goal.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const bucket = (h >>> 0) % 2;
    return part === "dev" ? bucket === 0 : bucket === 1;
  });
}
