// views/stats.ts — 用量看板（T-04）。
// 目的：不登 LangSmith 网站，也能一眼看出「调用是否正常」——调用次数 / 模型请求 / token / 成本 / 错误率 / 时延。
//
// 数据源：GET /agent/stats?range=…&groupBy=…（后端 T-03/T-05/T-06，已落地）。
//   真实响应形状（经离线注入 deps 探针实测确认，见交付说明）：
//     {
//       ok: true, enabled: true,
//       range: "7d", groupBy: "flow",
//       generatedAt: "2026-01-01T00:00:00.000Z",   // ISO 字符串，非 epoch
//       groups: [ { key, label?, kind: "flow"|"llm",   // kind 区分流程名 / 模型名（供两张表分流）
//                  stats: { run_count, total_tokens, prompt_tokens,
//                  completion_tokens, total_cost, latency_p50, latency_p99, latency_avg,
//                  first_token_p50, streaming_rate, last_run_start_time } } ],
//       totals: { runCount,          // 含子调用（分组求和），仅遥测区
//                 llmCallCount,      // 大模型请求次数
//                 rootRunCount,      // 过滤噪声后的根 run 数（= 成功+失败+未完成）
//                 filteredNoiseCount,// 被过滤的探针条数
//                 errorRate, pendingRate, errorCount, pendingCount, successCount },
//               // 计数均为 root run 口径（后端直接给出，前端优先读、缺失才回退反推）
//       partial?: boolean, warnings?: string[]
//     }
//   关闭态：{ ok:true, enabled:false }（零外网请求）
//   失败态：{ ok:false, enabled:true, error }
//   恒 HTTP 200。
//
// 归一化：后端 groups[i] 为「嵌套 stats + snake_case」。本文件在 renderReport 前统一
//   归一成扁平的 camelCase `StatGroup`（normalizeGroup），既贴合真实后端，也对旧契约
//   （扁平 camelCase）保持兼容，避免任一侧微调即白屏。
//   分流：`renderFlowTable` 只渲染 kind==="flow"（流程名）；`renderBreakdown` 只渲染 kind==="llm"（模型名）。
//   总量中后端未直接给出的字段（totalTokens / totalCost / latencyP50）由归一后的 groups 就地聚合推导，并在 UI 中标注口径。
//
// 设计：东方墨韵·编辑感——复用 styles.css 的令牌与既有类，不引任何图表库。
// 安全：所有来自外部的文本（flow 名 / 模型名 / 错误信息 / warnings）一律经 esc() 转义。
import { ctx } from "../core/ctx.js";
import { esc, setMeta, fmtInt, fmtCost, fmtLatency, fmtPct, fmtDateTime, fmtRelative } from "../core/ui.js";

// —— 契约类型 ——
type RangeKey = "today" | "7d" | "30d" | "all";
// 后端口径收敛后仅两个值；前端恒用 flow（name 为等价别名）。model / run_type 已废弃。
type GroupBy = "flow" | "name";

// 后端 groups[i].stats 的原始形状（snake_case，字段可空可缺）。
interface RawRunStats {
  run_count?: number | null;
  total_tokens?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_cost?: number | null;
  latency_p50?: number | null;
  latency_p99?: number | null;
  latency_avg?: number | null;
  first_token_p50?: number | null;
  streaming_rate?: number | null;
  last_run_start_time?: string | null;
}

// 后端 groups[i] 的原始形状：key + 可选 label + 嵌套 stats。
// 兼容旧契约：若直接给扁平 camelCase 字段（无 stats），也一并接受。
interface RawStatGroup extends RawRunStats {
  key?: string;
  label?: string;
  kind?: "flow" | "llm";     // 分组类型标记（后端给出：flow 名 / llm 名）
  stats?: RawRunStats;
  // 兼容旧的扁平 camelCase 契约
  runCount?: number | null;
  totalTokens?: number | null;
  totalCost?: number | null;
  latencyP50?: number | null;
  latencyP99?: number | null;
  latencyAvg?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  errorRate?: number | null;
  pendingRate?: number | null;
  errorCount?: number | null;
  successCount?: number | null;
  pendingCount?: number | null;
}

interface RawTotals {
  runCount?: number | null;
  rootRunCount?: number | null;      // 已过滤噪声后的根 run 数
  llmCallCount?: number | null;      // 大模型请求次数（llm 组 run_count 之和）
  filteredNoiseCount?: number | null; // 被过滤掉的噪声根 run 条数
  errorRate?: number | null;
  pendingRate?: number | null;
  // 成功/失败/未完成计数为 root run 口径，由后端直接给出（优先读，缺失才回退反推）。
  errorCount?: number | null;
  pendingCount?: number | null;
  successCount?: number | null;
}

interface StatsResponse {
  ok: boolean;
  enabled?: boolean;
  error?: string;
  range?: RangeKey;
  groupBy?: GroupBy;
  generatedAt?: string | number;
  partial?: boolean;
  warnings?: string[];
  groups?: RawStatGroup[];
  totals?: RawTotals;
}

// 归一后的分组：扁平 camelCase，供渲染层直接使用。
interface StatGroup {
  key: string;
  label: string;
  kind: "flow" | "llm";
  runCount: number | null;
  totalTokens: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalCost: number | null;
  latencyP50: number | null;
  latencyP99: number | null;
  latencyAvg: number | null;
  errorRate: number | null;
}

// 归一后的总量：包含后端未直接给出、由 groups 就地推导的聚合值。
interface StatTotals {
  runCount: number | null;            // 含子调用（分组求和），仅遥测区
  rootRunCount: number | null;        // 过滤噪声后的根 run 数（= 成功+失败+未完成）
  llmCallCount: number | null;        // 大模型请求次数
  filteredNoiseCount: number | null;  // 被过滤的噪声条数
  totalTokens: number | null;
  totalCost: number | null;
  errorRate: number | null;
  latencyP50: number | null;
  pendingRate: number | null;
  errorCount: number | null;
  successCount: number | null;
  pendingCount: number | null;
}

// 页面内可变状态：当前选中范围（默认 7d）。切范围时重渲染。
let currentRange: RangeKey = "7d";

const RANGES: Array<{ k: RangeKey; label: string }> = [
  { k: "today", label: "今天" },
  { k: "7d", label: "7 天" },
  { k: "30d", label: "30 天" },
  { k: "all", label: "全部" },
];

// ---------- 数值工具（null 安全） ----------

// 取有限数，否则 null。绝不把 NaN/Infinity 当有效值。
function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// null 安全的求和：全 null → null；否则忽略 null 相加（有真实值才给数）。
function sumOrNull(values: Array<number | null>): number | null {
  let acc = 0;
  let any = false;
  for (const v of values) {
    const n = num(v);
    if (n != null) { acc += n; any = true; }
  }
  return any ? acc : null;
}

// 错误率颜色分级：这是「消耗类指标」，不是股价涨跌——绝不用红绿。
//   null → slate 灰且显示「—」；0 → 描金（正常）；(0,0.05) → slate（轻微）；>=0.05 → 朱砂（警示）。
function errorRateColor(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "var(--slate)";
  if (rate === 0) return "var(--amber)";
  if (rate < 0.05) return "var(--slate)";
  return "var(--brand)";
}

// 错误率单元格 HTML（带颜色分级 + null 显示「—」）。
function errorRateCell(rate: number | null | undefined): string {
  return `<span style="font-weight:600;color:${errorRateColor(rate)};">${esc(fmtPct(rate))}</span>`;
}

// ISO 字符串 / epoch → epoch 毫秒；解析失败返回 null。
function toEpochMs(ts: string | number | undefined): number | null {
  if (ts == null) return null;
  if (typeof ts === "number") return Number.isFinite(ts) ? ts : null;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------- 归一化：真实后端形状 → 扁平 camelCase ----------

// 把后端一个分组（嵌套 stats / snake_case，或旧扁平契约）归一成 StatGroup。
// 导出供离线单测（纯函数，无副作用、不触 DOM）。
export function normalizeGroup(raw: RawStatGroup): StatGroup {
  const s: RawRunStats = raw.stats || raw; // 有 stats 走嵌套；否则视自身为扁平源
  const key = String(raw.key ?? "");
  // label 优先；缺省用 key（渲染层再做「—」兜底）。
  const label = String(raw.label ?? (raw.stats ? raw.key : raw.key) ?? "");
  // kind 优先取后端；旧契约缺失时按 key 形态兜底推断（llm 名以 ·llm 结尾，flow 名含 ":"）。
  const kind: "flow" | "llm" = raw.kind === "llm" || raw.kind === "flow"
    ? raw.kind
    : (/·llm(#.*)?$/.test(key) ? "llm" : "flow");
  return {
    key,
    label,
    kind,
    runCount: num(s.run_count ?? raw.runCount),
    totalTokens: num(s.total_tokens ?? raw.totalTokens),
    promptTokens: num(s.prompt_tokens ?? raw.promptTokens),
    completionTokens: num(s.completion_tokens ?? raw.completionTokens),
    totalCost: num(s.total_cost ?? raw.totalCost),
    latencyP50: num(s.latency_p50 ?? raw.latencyP50),
    latencyP99: num(s.latency_p99 ?? raw.latencyP99),
    latencyAvg: num(s.latency_avg ?? raw.latencyAvg),
    errorRate: num(raw.errorRate),
  };
}

// 把后端 totals（含计数）+ groups 归一/派生 成完整 StatTotals。
//   口径（关键，勿混用）：
//     · runCount = 后端分组求和 → **含父 chain + llm 子 run**（仅在遥测区展示，标注「含子调用」）
//     · rootRunCount = 后端**过滤噪声后**的根 run 数 → **恰等于 成功+失败+未完成**（主口径）
//     · 成功/失败/未完成计数 = **root run 口径**，由后端直接给出（errorCount/pendingCount/successCount）
//     · llmCallCount = **大模型请求次数**（后端=各 llm 组 run_count 之和；缺失时用 groups 兜底求和）
//     · totalTokens / totalCost = 各分组求和；latencyP50 = 各分组 latency_p50 的算术均值（近似口径，UI 标注）。
//   回退：仅当后端未给出计数字段时，才用 rootRunCount 作基数、结合 errorRate/pendingRate 反推
//         （rootRunCount 才是这些比率的分母，绝不能用 runCount）。
// 导出供离线单测（纯函数，无副作用、不触 DOM）。
export function normalizeTotals(raw: RawTotals | undefined, groups: StatGroup[]): StatTotals {
  const rawT = raw || {};
  const runCount = num(rawT.runCount);
  const rootRunCount = num(rawT.rootRunCount);
  const errorRate = num(rawT.errorRate);
  const pendingRate = num(rawT.pendingRate);

  // 大模型请求次数：优先后端；缺失时由 llm 组 run_count 兜底求和。
  const llmCallCount = num(rawT.llmCallCount)
    ?? sumOrNull(groups.filter((g) => g.kind === "llm").map((g) => g.runCount));
  const filteredNoiseCount = num(rawT.filteredNoiseCount) ?? 0;

  const totalTokens = sumOrNull(groups.map((g) => g.totalTokens));
  const totalCost = sumOrNull(groups.map((g) => g.totalCost));

  const p50s = groups.map((g) => g.latencyP50).filter((v): v is number => v != null);
  const latencyP50 = p50s.length ? p50s.reduce((a, b) => a + b, 0) / p50s.length : null;

  // 计数：优先读后端 root 口径字段；缺失才回退反推（基数必须用 rootRunCount）。
  let errorCount = num(rawT.errorCount);
  let pendingCount = num(rawT.pendingCount);
  let successCount = num(rawT.successCount);

  if (errorCount == null && rootRunCount != null && errorRate != null) {
    errorCount = Math.min(rootRunCount, Math.round(rootRunCount * errorRate));
  }
  if (pendingCount == null && rootRunCount != null && pendingRate != null) {
    pendingCount = Math.min(rootRunCount, Math.round(rootRunCount * pendingRate));
  }
  if (successCount == null && rootRunCount != null) {
    // 仅当后端未给 successCount 时反推；error/pending 未知则按 0 计。
    const e = errorCount ?? 0;
    const p = pendingCount ?? 0;
    successCount = Math.max(0, rootRunCount - e - p);
  }

  return {
    runCount, rootRunCount, llmCallCount, filteredNoiseCount,
    totalTokens, totalCost, errorRate, latencyP50, pendingRate,
    errorCount, successCount, pendingCount,
  };
}

// ---------- 入口 ----------

export function stats(): void {
  setMeta("用量看板 · 模法师 Promptly", "查看各流程的调用次数、token 消耗、成本、错误率与时延。");
  render();
}

// 首屏渲染：标题 + 范围切换 + 骨架。
function render(): void {
  const rangeTabs = RANGES.map(
    (r) => `<button class="btn btn-sm ${r.k === currentRange ? "btn-primary" : "btn-ghost"}" data-range="${r.k}">${esc(r.label)}</button>`
  ).join("");

  ctx.appEl().innerHTML = `
    <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
    <div class="flex items-center gap-3 flex-wrap" style="margin-top:10px;">
      <h1 class="section-title" style="font-size:1.7rem;margin:0;">用量看板</h1>
      <div class="flex gap-1 items-center" id="stats-range" style="margin-left:auto;">${rangeTabs}</div>
      <button id="stats-refresh" class="btn btn-ghost btn-sm" title="重新拉取用量">↻ 刷新</button>
    </div>
    <p class="muted" style="font-size:.82rem;margin-top:6px;">本机 LangSmith 调用观测：调用次数、token 消耗、成本、错误率与时延。数据来自后端 <span class="mono">/agent/stats</span>。</p>
    <div id="stats-body" style="margin-top:16px;">
      <div class="card card-pad"><p class="muted" style="margin:0;">正在加载用量数据…</p></div>
    </div>`;

  // 范围切换
  document.querySelectorAll<HTMLButtonElement>("#stats-range [data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-range") as RangeKey | null;
      if (!k || k === currentRange) return;
      currentRange = k;
      render();
    });
  });
  // 刷新
  document.getElementById("stats-refresh")?.addEventListener("click", () => render());

  void loadAndRender();
}

// 拉取数据并渲染正文。任何网络/解析异常都落到「失败 + 重试」，绝不冒泡成白屏。
async function loadAndRender(): Promise<void> {
  const body = document.getElementById("stats-body");
  if (!body) return;
  let data: StatsResponse;
  try {
    const res = await fetch(`/agent/stats?range=${encodeURIComponent(currentRange)}&groupBy=flow`, {
      headers: { accept: "application/json" },
    });
    // 契约：恒 200。但为鲁棒，非 200 也走失败态（除非是明确的结构化错误体）。
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = (await res.json()) as StatsResponse;
  } catch (e) {
    body.innerHTML = renderError((e as Error)?.message || "网络异常");
    bindRetry();
    return;
  }

  // 形态 1：未启用 LangSmith → 引导卡片（不报错、不白屏）
  if (data && data.enabled === false) {
    body.innerHTML = renderDisabled();
    return;
  }
  // 形态 2：拉取失败 → 顶部错误条 + 重试
  if (!data || data.ok === false) {
    body.innerHTML = renderError((data && data.error) || "拉取失败");
    bindRetry();
    return;
  }
  // 形态 3：正常（含空数据）
  body.innerHTML = renderReport(data);
}

function bindRetry(): void {
  document.getElementById("stats-retry")?.addEventListener("click", () => render());
}

// —— 形态 1：未启用 ——
function renderDisabled(): string {
  return `
    <div class="card card-pad" style="max-width:640px;">
      <div class="section-title" style="font-size:1.05rem;">LangSmith 未启用</div>
      <p class="slate" style="font-size:.9rem;line-height:1.7;margin-top:10px;">
        在 <span class="mono">site/server/.env</span> 配置 <span class="mono">LANGSMITH_API_KEY</span> 并重启服务，即可在此查看用量。
      </p>
      <div class="tpl-meta mono" style="font-size:.8rem;">LANGSMITH_API_KEY=lsv2_…</div>
      <p class="muted" style="font-size:.78rem;margin-top:10px;">配置为可选：留空时系统不做任何上报、零开销，主流程不受影响。</p>
    </div>`;
}

// —— 形态 2：失败 ——
function renderError(msg: string): string {
  return `
    <div class="tr-error" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <span>⚠ 用量数据拉取失败：${esc(msg)}</span>
      <button id="stats-retry" class="btn btn-sm btn-ghost">重试</button>
    </div>
    <div class="card card-pad" style="margin-top:12px;"><p class="muted" style="margin:0;">点击「重试」重新拉取；若持续失败，请确认后端已启动。</p></div>`;
}

// —— 形态 3：正常 ——
function renderReport(data: StatsResponse): string {
  const rawGroups = Array.isArray(data.groups) ? data.groups : [];
  const groups: StatGroup[] = rawGroups.map(normalizeGroup);
  const t: StatTotals = normalizeTotals(data.totals, groups);

  const warnBar = data.partial
    ? `<div class="pill-amber" style="display:inline-block;padding:6px 12px;border-radius:10px;font-size:.8rem;margin-bottom:12px;">部分数据缺失：${esc((data.warnings || []).join("；") || "上游某项获取失败")}</div>`
    : "";

  const ms = toEpochMs(data.generatedAt);
  const genAt = ms != null ? `生成于 ${esc(fmtDateTime(ms))}（${esc(fmtRelative(ms))}）` : "";

  return `
    ${warnBar}
    <div class="flex items-center gap-2 flex-wrap" style="margin-bottom:12px;">
      <span class="pill pill-muted">范围：
        ${esc((RANGES.find((r) => r.k === currentRange) || { label: currentRange }).label)}
      </span>
      <span class="pill pill-muted">分组：按流程</span>
      <span class="muted" style="font-size:.76rem;margin-left:auto;">${genAt}</span>
    </div>

    ${renderOverview(t)}
    ${renderFlowTable(groups)}
    ${renderBreakdown(groups)}

    <details class="card card-pad" style="margin-top:18px;">
      <summary style="cursor:pointer;font-weight:700;font-size:.9rem;">运维遥测（点击展开）</summary>
      <div style="margin-top:10px;">
        ${renderTelemetry(t)}
      </div>
    </details>`;
}

// —— 区块 1：总览卡片（6 张）——
// ⚠️「调用次数」用 rootRunCount（过滤噪声后的根 run 数），使其恰好等于 成功+失败+未完成，界面自洽。
//    （旧版用 runCount（含子 run）会与下方拆分对不上。）另加「模型请求」= 大模型请求次数。
function renderOverview(t: StatTotals): string {
  const cards: Array<{ label: string; value: string; color?: string }> = [
    { label: "调用次数", value: fmtInt(t.rootRunCount) },
    { label: "模型请求", value: fmtInt(t.llmCallCount) },
    { label: "总 token", value: fmtInt(t.totalTokens) },
    { label: "总成本", value: fmtCost(t.totalCost) },
    { label: "错误率", value: fmtPct(t.errorRate), color: errorRateColor(t.errorRate) },
    { label: "P50 时延", value: fmtLatency(t.latencyP50) },
  ];
  const html = cards.map((c) => `
    <div class="stats-card">
      <div class="metric-label">${esc(c.label)}</div>
      <div class="metric-num" style="color:${c.color || "var(--ink)"};">${esc(c.value)}</div>
    </div>`).join("");
  return `<div class="stats-cards">${html}</div>`;
}

// —— 区块 2：按流程明细表（主视图，仅 kind==="flow"）——
function renderFlowTable(allGroups: StatGroup[]): string {
  const groups = allGroups.filter((g) => g.kind === "flow");
  if (!groups.length) {
    return `<div class="card card-pad" style="margin-top:18px;"><p class="muted" style="margin:0;">该时间段暂无流程调用记录。</p></div>`;
  }
  const rows = groups.map((g) => `
    <tr>
      <td><span class="mono" style="font-size:.82rem;">${esc(g.label || g.key || "(未命名)")}</span></td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtInt(g.runCount))}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtInt(g.totalTokens))}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtCost(g.totalCost))}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtLatency(g.latencyP50))}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtLatency(g.latencyP99))}</td>
      <td style="text-align:right;">${errorRateCell(g.errorRate)}</td>
    </tr>`).join("");
  return `
    <div class="section" style="margin-top:20px;">
      <div class="section-title" style="font-size:1.05rem;">按流程明细</div>
      <div class="card" style="overflow:auto;margin-top:12px;padding:0;">
        <table class="board-table" style="box-shadow:none;">
          <thead>
            <tr>
              <th>流程</th>
              <th style="text-align:right;">次数</th>
              <th style="text-align:right;">token</th>
              <th style="text-align:right;">成本</th>
              <th style="text-align:right;">P50</th>
              <th style="text-align:right;">P99</th>
              <th style="text-align:right;">错误率</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// —— 区块 3+4：按厂商/模型分组表 + 占比条（同一份 groups 数据，仅 kind==="llm"，零额外请求）——
function renderBreakdown(allGroups: StatGroup[]): string {
  const llmGroups = allGroups.filter((g) => g.kind === "llm");
  if (!llmGroups.length) return "";
  // 占比条按 token 降序（token 可能是 null → 视作 0 参与排序，但展示仍走 fmtInt 的「—」）。
  const sorted = [...llmGroups].sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0));
  const max = Math.max(1, ...sorted.map((g) => g.totalTokens ?? 0));
  const bars = sorted.slice(0, 12).map((g) => {
    const v = g.totalTokens ?? 0;
    const pct = Math.round((v / max) * 100);
    const isMax = (g.totalTokens ?? 0) === max;
    return `
      <div class="ratio-row">
        <div class="ratio-label" title="${esc(g.label || g.key)}">${esc(g.label || g.key || "(未命名)")}</div>
        <div class="ratio-track">
          <span class="ratio-fill${isMax ? " is-max" : ""}" style="width:${pct}%;"></span>
        </div>
        <div class="ratio-val">${esc(fmtInt(g.totalTokens))}</div>
      </div>`;
  }).join("");

  const modelRows = sorted.map((g) => `
    <tr>
      <td><span class="mono" style="font-size:.82rem;">${esc(g.label || g.key || "(未命名)")}</span></td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtInt(g.runCount))}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtInt(g.promptTokens))}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtInt(g.completionTokens))}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtCost(g.totalCost))}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtLatency(g.latencyAvg))}</td>
    </tr>`).join("");

  return `
    <div class="section" style="margin-top:20px;">
      <div class="section-title" style="font-size:1.05rem;">按厂商 / 模型分组</div>
      <div class="card" style="overflow:auto;margin-top:12px;padding:0;">
        <table class="board-table" style="box-shadow:none;">
          <thead>
            <tr>
              <th>分组</th>
              <th style="text-align:right;">次数</th>
              <th style="text-align:right;">输入 token</th>
              <th style="text-align:right;">输出 token</th>
              <th style="text-align:right;">成本</th>
              <th style="text-align:right;">平均时延</th>
            </tr>
          </thead>
          <tbody>${modelRows}</tbody>
        </table>
      </div>
    </div>

    <div class="section" style="margin-top:20px;">
      <div class="section-title" style="font-size:1.05rem;">token 占比</div>
      <div class="card card-pad" style="margin-top:12px;">
        ${bars}
      </div>
    </div>`;
}

// —— 区块 5：运维遥测（折叠）——
function renderTelemetry(t: StatTotals): string {
  const pendingNote = (t.pendingRate != null && Number.isFinite(t.pendingRate) && t.pendingRate > 0)
    ? `（有 ${esc(fmtInt(t.pendingCount))} 条未完成，占比 ${esc(fmtPct(t.pendingRate))}）`
    : "";
  // 「含子调用」小字：runCount 是分组求和（含父 chain + llm 子 run），与上方 root 口径不同——纯文本标注，不用 tooltip。
  const withChildren = `<span class="muted" style="font-size:.72rem;">（含子调用）</span>`;
  // 噪声提示：透明告知被过滤掉的探针条数（无则不显示）。
  const noiseNote = (t.filteredNoiseCount != null && t.filteredNoiseCount > 0)
    ? `<span class="muted" style="font-size:.72rem;">（已过滤 ${esc(fmtInt(t.filteredNoiseCount))} 条探针）</span>`
    : "";
  const rows: Array<[string, string]> = [
    ["成功调用", esc(fmtInt(t.successCount))],
    ["失败调用", esc(fmtInt(t.errorCount))],
    ["未完成", esc(fmtInt(t.pendingCount)) + pendingNote],
    ["分组总和" + withChildren, esc(fmtInt(t.runCount))],
    ["P50 时延（分组近似）", esc(fmtLatency(t.latencyP50))],
    ["噪声过滤", noiseNote || `<span class="muted">—</span>`],
  ];
  const html = rows.map(([k, v]) => `
    <div class="flex" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line);">
      <span class="slate" style="font-size:.85rem;">${k}</span>
      <span style="font-size:.85rem;font-variant-numeric:tabular-nums;">${v}</span>
    </div>`).join("");
  return `<div>${html}</div>`;
}
