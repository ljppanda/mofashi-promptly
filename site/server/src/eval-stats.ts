// eval-stats.ts
// 评测统计的纯函数层：均值、bootstrap 置信区间、配对符号检验。
// 抽出来是为了能离线单测——评测结论的可信度不应该靠「看报告感觉」。

export function mean(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// 确定性 PRNG（mulberry32）：同一 seed 下 bootstrap 结果可复现，便于 CI/复跑对比。
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CI {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

// 对样本均值做 percentile bootstrap 置信区间。
export function bootstrapCI(
  xs: readonly number[],
  opts: { iterations?: number; alpha?: number; seed?: number } = {},
): CI {
  const n = xs.length;
  if (!n) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
  const iterations = opts.iterations ?? 2000;
  const alpha = opts.alpha ?? 0.05;
  const rnd = mulberry32(opts.seed ?? 42);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += xs[Math.floor(rnd() * n)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const loIdx = Math.min(means.length - 1, Math.floor((alpha / 2) * means.length));
  const hiIdx = Math.max(0, Math.ceil((1 - alpha / 2) * means.length) - 1);
  return { mean: mean(xs), lo: means[loIdx], hi: means[hiIdx], n };
}

// 配对差值（同一场景下 A-B）的均值与置信区间。
// 相比「两组独立均值」，配对能消掉场景难度带来的方差，是 A/B 评测更合适的口径。
export function pairedDiffCI(
  a: readonly number[],
  b: readonly number[],
  opts: { iterations?: number; alpha?: number; seed?: number } = {},
): CI {
  if (a.length !== b.length) throw new Error("pairedDiffCI: 两组样本长度必须一致");
  const diffs = a.map((x, i) => x - b[i]);
  return bootstrapCI(diffs, opts);
}

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

// 精确二项符号检验（双侧，H0: 胜率 = 0.5）。忽略平局。
// 小样本下比正态近似可靠，适合 30~100 条场景的评测。
export function signTestP(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += comb(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}

export function fmt(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

export function fmtCI(ci: CI, digits = 3): string {
  if (!Number.isFinite(ci.mean)) return "—";
  return `${fmt(ci.mean, digits)} [${fmt(ci.lo, digits)}, ${fmt(ci.hi, digits)}]`;
}
