// stats.ts
// 后端用量聚合端点（GET /agent/stats）的取数层。
// 目的：把 LangSmith 的聚合统计代理成本地一个 JSON，供前端看板渲染，用户无需登录 LangSmith 网站。
// 设计（docs/dashboard_design.md §2）：
//   - 一次看板加载最多 2 次 LangSmith 请求（① 分组 stats + ② runs/query），并行发出（§2.9）。
//   - 错误率自算（error/(success+error)，排除 pending）（§2.5）。
//   - metadata 分组返回空 {} → 回退 name 分组 + canonicalName 归并（§2.3）。
//     ⚠️ 2026-09-18 修正：flow 视图**直接走 name 分组**（groupByBody 映射），不再有「回退重发第 3 次」
//        —— 那个第 3 发必被 LangSmith 429 打死。请求数稳定为 2（stats + query）。
//   - 白名单过滤（TRACE_FLOWS 13 个）+ 探针噪声黑名单（§2.6）。
//   - 30s TTL 内存缓存 + in-flight memo（§2.7）。
//   - 关闭态零网络（§2.8）。
// 依赖全部可注入（deps），使单测能离线零网络：见 StatsDeps / createStatsFetcher。

import { LS_ENABLED, ensureProject, PROJECT, ENDPOINT, LS_API_KEY } from "./langsmith.js";
import { TRACE_FLOWS, PUBLIC_FLOWS } from "./trace.js";
import { PROVIDERS } from "./providers.js";

// ---------- 类型 ----------

export interface RunStats {
  run_count?: number | null;
  total_tokens?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  median_tokens?: number | null;
  tokens_p99?: number | null;
  total_cost?: number | null;
  prompt_cost?: number | null;
  completion_cost?: number | null;
  cost_p50?: number | null;
  cost_p99?: number | null;
  latency_p50?: number | null;
  latency_p99?: number | null;
  latency_avg?: number | null;
  first_token_p50?: number | null;
  first_token_p99?: number | null;
  streaming_rate?: number | null;
  last_run_start_time?: string | null;
}

export interface StatsGroup {
  key: string;                // 规范化后的分组键（flow 名 / canonicalName / run_type）
  label?: string;             // 展示名（provider id 段翻译成中文，可选）
  kind: "flow" | "llm";       // 类型标记：flow 名 → "flow"；llm 名（canonicalName 归一）→ "llm"
  stats: RunStats;
}

export interface StatsTotals {
  runCount: number;           // 分组求和、**含父 chain + llm 子 run**（§3.4）；仅供遥测区，语义 = 含子调用
  llmCallCount: number;       // **大模型请求次数** = 各 kind==="llm" 组的 run_count 之和（口径干净）
  rootRunCount: number;       // **过滤噪声后**的根 run 数（来自 /runs/query(is_root)）
  filteredNoiseCount: number; // 被噪声过滤掉的根 run 条数（供 UI 透明提示）
  errorRate: number | null;   // error/(success+error)，分母 0 → null（root 口径）
  pendingRate: number | null; // pending/全部（root 口径）
  errorCount: number;         // root 口径计数：status=error 的根 run 数
  pendingCount: number;       // root 口径计数：status=pending 的根 run 数
  successCount: number;       // root 口径计数：status=success 的根 run 数
}

export interface StatsResult {
  ok: boolean;
  enabled: boolean;
  range: RangeKey;
  groupBy: GroupByKey;
  generatedAt: string;
  groups: StatsGroup[];
  totals: StatsTotals;
  partial?: boolean;
  warnings?: string[];
  error?: string;
}

export type RangeKey = "today" | "7d" | "30d" | "all";
// 对外的分组口径（收敛后）：`flow` 视图实际走 name 分组归并；`name` 为等价别名。
// 旧的 `model` / `run_type` 已废弃（model 与 flow 完全等价却不过滤/不归一，泄漏探针），
// coerceGroupBy 会把它们落到默认 `flow`。
export type GroupByKey = "flow" | "name";
// groupByBody / buildGroups 内部容忍的历史值 + `metadata` 可选增强路径（非默认 flow 视图）。
export type GroupByKeyPlus = GroupByKey | "model" | "run_type" | "metadata";

// §2.2 保守 select 清单：纯标量聚合，**不含 run_facets**（实测会挤掉其它字段）、
// **不含 error_rate**（平台口径把 pending 算作失败，我们用自算口径，见 §2.5）。
export const STATS_SELECT: readonly string[] = [
  "run_count",
  "total_tokens", "prompt_tokens", "completion_tokens",
  "median_tokens", "tokens_p99",
  "total_cost", "prompt_cost", "completion_cost", "cost_p50", "cost_p99",
  "latency_p50", "latency_p99", "latency_avg",
  "first_token_p50", "first_token_p99",
  "streaming_rate",
  "last_run_start_time",
] as const;

const MAX_GROUPS = 20; // §2.2 硬约束：1~20，超出会 422

// 探针噪声黑名单前缀/子串（§2.6）。LangSmith 无删除 API，只能过滤。
// ⚠️ 2026-09-18 补 "e2e-probe-root"（T-05 自测遗留的根 run 探针；此前未收录，污染 rootRunCount/pendingRate）。
const NOISE_PATTERNS: readonly string[] = ["t01-probe", "withtrace-probe", "hello-metadata", "wt-", "e2e-probe-root"];

// 别名表：中文 label 段（PROVIDERS 里没有直接对应 id 时）→ provider id（§1.5）。
// PROVIDERS 中 kimi/moonshot 都叫「Kimi」、tongyi/qwen 都叫「通义千问」，需按优先级归并。
const LABEL_ALIAS: Record<string, string> = {
  "Kimi": "kimi",
  "通义千问（阿里）": "qwen",
};

// ---------- 纯函数：canonicalName 归并（§1.5） ----------

// provider id 集合（用于识别首段是 id 还是 label）。
const PROVIDER_IDS = new Set(Object.keys(PROVIDERS));
// label → id 映射（PROVIDERS 里 label 唯一者）。
const LABEL_TO_ID: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [id, def] of Object.entries(PROVIDERS)) {
    if (!(def.label in m)) m[def.label] = id; // 首个胜出，保证确定性
  }
  return m;
})();

/**
 * 把历史/新 run 名规范化为稳定的归并键，形如 `<providerId>·<model>·llm`。
 * 规则（§1.5）：
 *   1) 去尾部序号后缀 `#\d+` / `#selfcheck`；
 *   2) 去尾部 `·llm` / `·tool` / `·attempt`（类型信息另存，此处只求归并键）；
 *   3) 首段（疑似 provider 段）映射到 provider id：先查 PROVIDER_IDS，再查 LABEL_TO_ID 与别名表；无法识别则保留原样；
 *   4) 补齐缺失的 `·llm` 后缀。
 * 例：`DeepSeek·deepseek-chat·llm` / `deepseek·deepseek-chat·llm#2` / `deepseek-chat·llm`（无前缀）
 *     最终都归并到同一键（见单测）。
 */
export function canonicalName(runName: string): string {
  let s = String(runName ?? "").trim();
  if (!s) return "";

  // 1) 去掉尾部序号 / #selfcheck 后缀
  s = s.replace(/#selfcheck$/i, "").replace(/#\d+$/, "");

  // 2) 拆分并按需去掉尾部类型后缀
  let parts = s.split("·").map((p) => p.trim()).filter((p) => p.length > 0);
  const TYPE_SUFFIXES = new Set(["llm", "tool", "attempt", "failover"]);
  let last = parts[parts.length - 1] ?? "";
  if (TYPE_SUFFIXES.has(last.toLowerCase())) parts = parts.slice(0, -1);
  else if (parts.length === 1) {
    // 单段且无类型后缀，可能是纯 flow 名（含 ":"），原样返回（不参与 provider·model 归并）
    return parts[0];
  }

  // flow 名（形如 agent:generate）不参与 provider·model 归并，原样返回
  if (parts.length === 1 && /:/.test(parts[0])) return parts[0];

  if (parts.length === 0) return s;

  // 3) 首段 → provider id（仅在有多段、疑似 provider·model 形态时）
  if (parts.length >= 2) {
    const first = parts[0];
    if (!PROVIDER_IDS.has(first)) {
      const mapped = LABEL_TO_ID[first] ?? LABEL_ALIAS[first];
      if (mapped) parts[0] = mapped;
    }
    // 4) 补齐 ·llm 后缀
    return `${parts.join("·")}·llm`;
  }

  // 单段（无 provider 前缀，如 `deepseek-chat`）：作为 model，无法补 provider，保留 + ·llm
  return `${parts[0]}·llm`;
}

// ---------- 纯函数：白名单 / 噪声过滤（§2.6） ----------

const FLOW_WHITELIST = new Set<string>([...TRACE_FLOWS, ...PUBLIC_FLOWS]);

/** 是否为探针噪声名（黑名单）。 */
export function isNoise(name: string): boolean {
  const n = String(name ?? "");
  return NOISE_PATTERNS.some((p) => n.includes(p));
}

/** 是否为白名单 flow 名（主视图保留）。 */
export function isWhitelistedFlow(name: string): boolean {
  return FLOW_WHITELIST.has(String(name ?? ""));
}

/** 是否为 llm 子 run 名（`providerId·model·llm[...]`），用于「按厂商/模型」区。 */
export function isLlmRunName(name: string): boolean {
  return /·llm(#.*)?$/.test(String(name ?? ""));
}

// ---------- 纯函数：range 换算（§2.4） ----------

/**
 * range → { start_time?, end_time? }（ISO 8601 UTC）。
 * `today` 用**本地时区** 00:00；`7d`/`30d` = now − 对应时长；`all` 省略该字段（返回 {}）。
 * now 可注入以便单测确定性。
 */
export function rangeToTimes(range: RangeKey, now: Date = new Date()): { start_time?: string; end_time?: string } {
  if (range === "all") return {};
  if (range === "today") {
    const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0); // 本地 00:00
    return { start_time: local.toISOString() };
  }
  const days = range === "7d" ? 7 : 30;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { start_time: start.toISOString() };
}

// ---------- 纯函数：错误率口径（§2.5） ----------

export interface StatusDist { success: number; error: number; pending: number; total: number; }

export function statusDistribution(runs: Array<{ status?: string }>): StatusDist {
  let success = 0, error = 0, pending = 0;
  for (const r of runs) {
    const s = String(r?.status ?? "");
    if (s === "success") success++;
    else if (s === "error") error++;
    else if (s === "pending") pending++;
  }
  return { success, error, pending, total: runs.length };
}

/** 错误率 = error/(success+error)（分母排除 pending）；分母 0 → null。 */
export function errorRateOf(dist: StatusDist): number | null {
  const denom = dist.success + dist.error;
  return denom > 0 ? dist.error / denom : null;
}

/** 未完成率 = pending/全部；全部 0 → null。 */
export function pendingRateOf(dist: StatusDist): number | null {
  return dist.total > 0 ? dist.pending / dist.total : null;
}

// ---------- 分组：groupBy → LangSmith group_by 体 ----------

/**
 * groupBy → LangSmith `group_by`。
 * ⚠️ `metadata` 分组的 `path` 必须是**字符串**（数组形态 → HTTP 422，§2.3 实测）。
 * ⚠️ 2026-09-18 修正：`flow` 视图**直接走 name 分组**，不再用 metadata path=flow。
 *    原因：metadata.flow 只有新写入的 run 才有，历史 run 全空 → 分组必然残缺或 `{}`；
 *    而 name 分组天然包含 flow 名（root chain run 的 name 即 flow 名）+ llm 名，
 *    配合 canonicalName + 白名单即可正确归类（真机实测 8 组全对）。
 *    这样请求数从 3 降到 2，符合 §2.9 预算，且历史 run 也能统计进来。
 *    （metadata 分组能力保留：groupBy 显式传 "metadata" 时仍可用，只是默认 flow 视图不走它。）
 * ⚠️ 2026-09-18 修正 2：`model` 已废弃（与 flow 完全等价但 buildGroups 不过滤/不归一，泄漏探针）。
 *    此处保留 case 仅为防御式兼容（内部若被直接调用仍安全），对外的 coerceGroupBy 会把它落到 flow。
 */
export function groupByBody(groupBy: GroupByKeyPlus): { attribute: string; path?: string; max_groups: number } {
  switch (groupBy) {
    case "flow": return { attribute: "name", max_groups: MAX_GROUPS }; // 直接 name 分组（见上）
    case "metadata": return { attribute: "metadata", path: "flow", max_groups: MAX_GROUPS }; // 可选增强路径
    case "model": return { attribute: "name", max_groups: MAX_GROUPS }; // 已废弃，兼容保留
    case "run_type": return { attribute: "run_type", max_groups: MAX_GROUPS };
    case "name":
    default: return { attribute: "name", max_groups: MAX_GROUPS };
  }
}

// ---------- 缓存（§2.7） ----------

interface CacheEntry { ts: number; data: StatsResult; }
const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<string, Promise<StatsResult>>();
const TTL_MS = 30_000;

/** 清空缓存（供单测使用）。 */
export function _clearStatsCache(): void {
  CACHE.clear();
  INFLIGHT.clear();
}

// ---------- 依赖注入（供离线单测） ----------

export interface StatsDeps {
  enabled: boolean;                              // LS_ENABLED
  apiKey?: string;                               // x-api-key
  endpoint: string;                              // LangSmith endpoint
  project: string;                               // 项目名
  ensureProject: () => Promise<string | null>;   // 复用 langsmith.ts
  // 底层 fetch（可注入替身）；返回 { status, contentType, text }
  fetchRaw: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; contentType: string; text: string }>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

// 默认依赖：绑定 langsmith.ts 与真实 fetch。
export function defaultDeps(): StatsDeps {
  return {
    enabled: LS_ENABLED,
    apiKey: LS_API_KEY,
    endpoint: ENDPOINT,
    project: PROJECT,
    ensureProject,
    fetchRaw: async (url, init) => {
      const r = await fetch(url, init);
      const contentType = r.headers.get("content-type") ?? "";
      const text = await r.text();
      return { status: r.status, contentType, text };
    },
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

// ---------- 429 / 非 JSON 判定 + 退避重试（§2.9） ----------

const BACKOFFS = [1000, 3000]; // 最多 2 次重试；真机 429 窗口较大，300→900ms 太短（2026-09-18 实测改）

function isThrottled(res: { status: number; contentType: string }): boolean {
  // 限流判定：429 或 content-type 非 JSON（429 响应体是 HTML，直接 json() 会抛 Unexpected token '<'）
  if (res.status === 429) return true;
  const ct = (res.contentType || "").toLowerCase();
  return !ct.includes("application/json");
}

interface FetchJsonResult { ok: boolean; status: number; json?: unknown; throttled: boolean; }

// 带退避重试的 POST JSON：成功返回 json；限流/网络错误按 BACKOFFS 退避重试，最多 2 次；仍失败返回 ok:false。
async function postJson(deps: StatsDeps, url: string, body: unknown): Promise<FetchJsonResult> {
  let lastThrottled = false;
  for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
    let res: { status: number; contentType: string; text: string } | null = null;
    try {
      res = await deps.fetchRaw(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": deps.apiKey ?? "" },
        body: JSON.stringify(body),
      });
    } catch {
      res = null; // 网络异常：按可重试处理
    }

    if (res && res.status >= 200 && res.status < 300 && !isThrottled(res)) {
      try {
        return { ok: true, status: res.status, json: JSON.parse(res.text), throttled: false };
      } catch {
        // 2xx 但 body 非 JSON（理论上不该发生）→ 视为失败，不重试
        return { ok: false, status: res.status, throttled: false };
      }
    }

    lastThrottled = res ? isThrottled(res) : false;
    if (attempt < BACKOFFS.length) {
      const base = BACKOFFS[attempt];
      const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20%
      await deps.sleep(Math.max(0, Math.round(base + jitter)));
    }
  }
  return { ok: false, status: 0, throttled: lastThrottled };
}

// ---------- 取数：① 分组 stats ----------

interface StatsFetchOutcome { groups: StatsGroup[]; partial: boolean; warnings: string[]; }

// 拉一次分组 stats（**单次请求，绝不换参重发**，§2.9 预算）。
// flow 视图已在 groupByBody 里映射为 name 分组，故不存在「metadata 空 → 回退重发第 3 次」的设计。
async function fetchGroupStats(deps: StatsDeps, projectId: string, range: RangeKey, groupBy: GroupByKey): Promise<StatsFetchOutcome> {
  const times = rangeToTimes(range, deps.now());
  const warnings: string[] = [];

  const gb = groupByBody(groupBy);
  const body: Record<string, unknown> = {
    session: [projectId],
    select: [...STATS_SELECT],
    group_by: gb,
    ...times,
  };
  const r = await postJson(deps, `${deps.endpoint}/api/v1/runs/stats`, body);
  if (!r.ok || !r.json || typeof r.json !== "object") return { groups: [], partial: true, warnings: ["stats 请求失败"] };

  const raw = r.json as Record<string, RunStats>;
  // flow 视图按 run 名归并统计（中性提示，非「回退」——不再有重发动作）。
  if (groupBy === "flow") warnings.push("按 run 名归并统计");

  const groups = buildGroups(raw, groupBy);
  return { groups, partial: false, warnings };
}

// 把 LangSmith 扁平 map 转成 StatsGroup[]：按 groupBy 决定 key 归一 + 白名单/噪声过滤 + 聚合。
// 导出供单测（用真机 8 组名验证归类）。
export function buildGroups(raw: Record<string, RunStats>, groupBy: GroupByKeyPlus): StatsGroup[] {
  const acc = new Map<string, { stats: RunStats; kind: "flow" | "llm" }>();

  for (const [rawKey, stats] of Object.entries(raw)) {
    if (isNoise(rawKey)) continue; // 探针噪声：完全隐藏

    let key: string;
    let kind: "flow" | "llm" = "flow";

    if (groupBy === "name" || groupBy === "flow" || groupBy === "model") {
      // name 分组会同时返回 flow 名（agent:generate）与 llm 名（deepseek·deepseek-chat·llm）。
      // flow 视图同样走 name 分组（groupByBody 已映射），故两者共用同一套归类逻辑。
      // model 已废弃（与 flow 等价），此处并入同一分支，杜绝其走 else 而泄漏探针/大写重复桶。
      if (isWhitelistedFlow(rawKey)) {
        key = rawKey; // flow 名进主视图
        kind = "flow";
      } else if (isLlmRunName(rawKey)) {
        key = canonicalName(rawKey); // llm 名归一 → 进「按厂商/模型」区
        kind = "llm";
      } else {
        continue; // 不在白名单也不是 llm 名 → 主视图丢弃
      }
    } else if (groupBy === "metadata") {
      // metadata 分组（可选增强路径，非默认 flow 视图）：key 即 flow 值；非白名单 flow 丢弃（含探针）
      if (!isWhitelistedFlow(rawKey)) continue;
      key = rawKey;
      kind = "flow";
    } else {
      key = rawKey; // run_type：原样；run_type 恰为 "llm" 者归 llm，其余归 flow
      kind = key === "llm" ? "llm" : "flow";
    }

    mergeStats(acc, key, stats);
    // kind 直接写入（同一 key 的 kind 必然一致：flow 名含 ":"，llm 名含 "·…·llm"，二者不相交）。
    acc.get(key)!.kind = kind;
  }

  const groups: StatsGroup[] = [...acc.entries()].map(([key, v]) => ({
    key,
    label: labelForKey(key),
    kind: v.kind,
    stats: v.stats,
  }));
  // 按 run_count 降序（无值排后）
  groups.sort((a, b) => (b.stats.run_count ?? 0) - (a.stats.run_count ?? 0));
  return groups;
}

// 合并同组统计：加和型字段相加，比率/分位取「先到者」（粗粒度归并，§1.5 U1，不做精细加权）。
function mergeStats(acc: Map<string, { stats: RunStats; kind: "flow" | "llm" }>, key: string, incoming: RunStats): void {
  const cur = acc.get(key);
  if (!cur) { acc.set(key, { stats: { ...incoming }, kind: "flow" }); return; }
  const curStats = cur.stats;
  const SUM_KEYS: (keyof RunStats)[] = ["run_count", "total_tokens", "prompt_tokens", "completion_tokens", "total_cost", "prompt_cost", "completion_cost"];
  for (const k of SUM_KEYS) {
    const a = typeof curStats[k] === "number" ? (curStats[k] as number) : null;
    const b = typeof incoming[k] === "number" ? (incoming[k] as number) : null;
    if (a === null && b === null) (curStats[k] as unknown) = null;
    else (curStats[k] as unknown) = (a ?? 0) + (b ?? 0);
  }
  // 非加和字段：保留已有非空值，否则取新值（逐字段判空，§2.2）
  const KEEP_KEYS: (keyof RunStats)[] = ["median_tokens", "tokens_p99", "cost_p50", "cost_p99", "latency_p50", "latency_p99", "latency_avg", "first_token_p50", "first_token_p99", "streaming_rate", "last_run_start_time"];
  for (const k of KEEP_KEYS) {
    if ((curStats[k] === null || curStats[k] === undefined) && incoming[k] !== undefined) (curStats[k] as unknown) = incoming[k];
  }
}

// 展示 label：key 首段是 provider id 时翻译成中文 label（§1.2）。
function labelForKey(key: string): string | undefined {
  const parts = key.split("·");
  if (parts.length < 2) return undefined;
  const id = parts[0];
  const def = PROVIDERS[id];
  if (def && def.label) return [def.label, ...parts.slice(1)].join("·");
  return undefined;
}

// ---------- 取数：② runs/query（status 分布 + 根 run 数，§2.5） ----------

interface QueryOutcome { runs: Array<{ name?: string; status?: string }>; filteredNoiseCount: number; partial: boolean; warnings: string[]; }

async function fetchRootRuns(deps: StatsDeps, projectId: string): Promise<QueryOutcome> {
  const body = { session: [projectId], limit: 100, is_root: true };
  const r = await postJson(deps, `${deps.endpoint}/api/v1/runs/query`, body);
  if (!r.ok || !r.json || typeof r.json !== "object") return { runs: [], filteredNoiseCount: 0, partial: true, warnings: ["runs/query 请求失败"] };
  // ⚠️ 响应是对象不是数组：{ runs:[...], cursors, search_cursors, parsed_query }
  const allRuns = (r.json as { runs?: Array<{ name?: string; status?: string }> }).runs ?? [];
  // 过滤探针噪声：否则 rootRunCount / errorRate / pendingRate 会被探针残留污染
  // （2026-09-18 真机：17 条根 run 里 5 条是探针，pendingRate 23.5% 全来自探针，真实为 0）。
  const runs = allRuns.filter((run) => !isNoise(run?.name ?? ""));
  const filteredNoiseCount = allRuns.length - runs.length;
  return { runs, filteredNoiseCount, partial: false, warnings: [] };
}

// ---------- 对外主入口 ----------

export const VALID_RANGES: readonly RangeKey[] = ["today", "7d", "30d", "all"];
// 收敛为两个：flow（= name 归并）与 name。model / run_type 已废弃（见 GroupByKey 注释）。
export const VALID_GROUP_BYS: readonly GroupByKey[] = ["flow", "name"];

function coerceRange(v: unknown): RangeKey {
  return VALID_RANGES.includes(v as RangeKey) ? (v as RangeKey) : "7d";
}
// 导出供单测：非白名单值（含已废弃的 model / run_type）一律落到默认 `flow`。
export function coerceGroupBy(v: unknown): GroupByKey {
  return VALID_GROUP_BYS.includes(v as GroupByKey) ? (v as GroupByKey) : "flow";
}

/**
 * 组装一次看板取数（最多 2 次 LangSmith 请求，并行发出）。
 * 恒返回 StatsResult（绝不抛出）；关闭态零网络。
 */
export async function getStats(rawRange: unknown, rawGroupBy: unknown, deps: StatsDeps = defaultDeps()): Promise<StatsResult> {
  const range = coerceRange(rawRange);
  const groupBy = coerceGroupBy(rawGroupBy);
  const generatedAt = new Date().toISOString();

  // §2.8 关闭态：零网络。
  if (!deps.enabled) {
    return { ok: true, enabled: false, range, groupBy, generatedAt, groups: [], totals: emptyTotals() };
  }

  const pid = await deps.ensureProject().catch(() => null);
  if (!pid) {
    return { ok: false, enabled: true, range, groupBy, generatedAt, groups: [], totals: emptyTotals(), error: "无法解析 LangSmith 项目 id" };
  }

  // ① 分组 stats 与 ② runs/query 并行发出（不串行）。
  const [statsOut, queryOut] = await Promise.all([
    fetchGroupStats(deps, pid, range, groupBy),
    fetchRootRuns(deps, pid),
  ]);

  const warnings = [...statsOut.warnings, ...queryOut.warnings];
  const partial = statsOut.partial || queryOut.partial;

  // 总量口径（§3.4）：
  //   · runCount = 分组求和 → **含父 chain run + llm 子 run**（语义 = 含子调用；仅供遥测区）
  //   · llmCallCount = 各 kind==="llm" 组的 run_count 之和 → **大模型请求次数**（口径干净）
  //   · rootRunCount / errorCount / pendingCount / successCount = /runs/query(is_root) 且**已过滤噪声**
  //   ⚠️ runCount（含子）与 root 口径计数分母不同，前端**不得**用 runCount 反推 errorCount。
  const runCount = statsOut.groups.reduce((s, g) => s + (g.stats.run_count ?? 0), 0);
  const llmCallCount = statsOut.groups
    .filter((g) => g.kind === "llm")
    .reduce((s, g) => s + (g.stats.run_count ?? 0), 0);
  const dist = statusDistribution(queryOut.runs);
  const totals: StatsTotals = {
    runCount,
    llmCallCount,
    rootRunCount: queryOut.runs.length,           // 已过滤噪声的根 run 数
    filteredNoiseCount: queryOut.filteredNoiseCount,
    errorRate: errorRateOf(dist),      // 分母 = success+error（root 口径）
    pendingRate: pendingRateOf(dist),  // 分母 = total（root 口径）
    errorCount: dist.error,            // root 口径计数
    pendingCount: dist.pending,        // root 口径计数
    successCount: dist.success,        // root 口径计数
  };

  // 两者都失败 → ok:false（前端显示错误条）；仅其一失败 → ok:true + partial。
  const bothFailed = statsOut.partial && queryOut.partial;
  if (bothFailed) {
    return { ok: false, enabled: true, range, groupBy, generatedAt, groups: [], totals, partial: true, warnings, error: "LangSmith 取数失败" };
  }

  return {
    ok: true, enabled: true, range, groupBy, generatedAt,
    groups: statsOut.groups, totals,
    ...(partial ? { partial: true } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

function emptyTotals(): StatsTotals {
  return { runCount: 0, llmCallCount: 0, rootRunCount: 0, filteredNoiseCount: 0, errorRate: null, pendingRate: null, errorCount: 0, pendingCount: 0, successCount: 0 };
}

// ---------- 缓存包装（TTL 30s + in-flight memo，§2.7） ----------

/**
 * 带缓存的取数入口：同 key 30s 内直接命中；并发同 key 共享一个 in-flight Promise。
 * 供 index.ts 路由调用。
 */
export function getStatsCached(rawRange: unknown, rawGroupBy: unknown, deps: StatsDeps = defaultDeps()): Promise<StatsResult> {
  const range = coerceRange(rawRange);
  const groupBy = coerceGroupBy(rawGroupBy);
  const key = `${range}|${groupBy}`;

  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.ts < TTL_MS) return Promise.resolve(hit.data);

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;

  const p = getStats(range, groupBy, deps)
    .then((data) => {
      CACHE.set(key, { ts: Date.now(), data });
      return data;
    })
    .catch((e): StatsResult => ({
      ok: false, enabled: true, range, groupBy, generatedAt: new Date().toISOString(),
      groups: [], totals: emptyTotals(), error: String((e as Error)?.message ?? e),
    }))
    .finally(() => { INFLIGHT.delete(key); });

  INFLIGHT.set(key, p);
  return p;
}
