// trace.ts
// 纯函数工具层：把「内部 Usage → LangSmith 期望字段」的映射、前端上报体的校验与 run 树构造
// 抽离为可单测的纯函数，供 index.ts 的 POST /agent/trace 端点委托调用。
// 设计：无副作用（emitTraceReport 通过可注入 deps 完成实际上报，便于离线单测）。

import type { Usage } from "./providers.js";

// ---------- 类型定义 ----------

export interface TraceCall {
  name?: string;
  provider: string;
  model: string;
  usage?: Partial<Usage>;
  elapsedMs?: number;
  error?: string;
}

export interface TraceReport {
  flow: string;
  label?: string;
  metadata?: Record<string, unknown>;
  calls: TraceCall[];
}

// LangSmith outputs.usage_metadata 的结构（平台 token 统计列读取源）。
export interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_token_details?: { cache_read: number; cache_creation: number };
}

// 对外白名单流程名（§8 命名规范）：T03 端点 /agent/trace 仅接受这 9 个前端可上报流程。
export const PUBLIC_FLOWS: readonly string[] = [
  "judge:eval",
  "llm:instantiate",
  "llm:run",
  "llm:optimize",
  "llm:refine-direct",
  "llm:generate-template",
  "llm:prod-selfcheck",
  "llm:preview",
  "llm:chat",
] as const;

// 全量流程白名单：在 PUBLIC_FLOWS 基础上纳入 4 个后端 agent 流程名，
// 供后端内部复用本模块（parseTraceReport(raw, TRACE_FLOWS) / 直接构造 run 树）。
export const TRACE_FLOWS: readonly string[] = [
  ...PUBLIC_FLOWS,
  "agent:generate",
  "agent:use",
  "agent:clarify",
  "agent:refine",
] as const;

// ---------- 纯函数 ----------

// 数字兜底：非有限数或负数一律归 0（负数 token 会污染平台统计与成本汇总）。
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * 内部 Usage → outputs.usage_metadata（LangSmith token 列读取源）。
 * total 缺失时用 input + output + cacheRead + cacheCreate 兜底。
 * usage 为空 / undefined 时返回 undefined（调用方「无则略」）。
 */
export function toUsageMetadata(u: Partial<Usage> | undefined): UsageMetadata | undefined {
  if (!u || typeof u !== "object") return undefined;
  const input = num(u.inputTokens);
  const output = num(u.outputTokens);
  const cacheRead = num(u.cacheReadTokens);
  const cacheCreate = num(u.cacheCreateTokens);
  const total = num(u.totalTokens) || input + output + cacheRead + cacheCreate;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    input_token_details: { cache_read: cacheRead, cache_creation: cacheCreate },
  };
}

/**
 * 构造 LangSmith 模型元数据（写入 run 的 extra.metadata）。
 * 关键：LangSmith 从 extra.metadata.ls_model_name / ls_provider / ls_model_type 识别模型并估算成本。
 * 官方文档：缺 ls_model_name 时 token 可能仍记录，但 cost 不会估算。
 */
export function toLsModelMetadata(provider: string, model: string): Record<string, unknown> {
  return { ls_provider: provider, ls_model_type: "chat", ls_model_name: model };
}

/**
 * 校验前端上报体，返回规范化 TraceReport 或 null（非法）。
 * allowed：允许的 flow 白名单，默认 PUBLIC_FLOWS（端点收窄白名单）；
 *          后端内部复用时可传 TRACE_FLOWS（含 agent:* 流程名）。
 * 校验规则：
 *   - raw 必须是对象；flow 必须在 allowed 白名单；calls 必须为非空数组；
 *   - 每个 call 必须有非空 provider / model；usage 若存在则逐字段取数（非数字忽略）；
 *   - label / metadata 仅在类型正确时保留；多余字段一律丢弃。
 */
export function parseTraceReport(raw: unknown, allowed: readonly string[] = PUBLIC_FLOWS): TraceReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const flow = typeof o.flow === "string" ? o.flow : "";
  if (!allowed.includes(flow)) return null;

  if (!Array.isArray(o.calls) || o.calls.length === 0) return null;

  const calls: TraceCall[] = [];
  for (const c of o.calls) {
    if (!c || typeof c !== "object" || Array.isArray(c)) return null;
    const co = c as Record<string, unknown>;
    const provider = typeof co.provider === "string" ? co.provider.trim() : "";
    const model = typeof co.model === "string" ? co.model.trim() : "";
    if (!provider || !model) return null; // provider/model 必填

    const call: TraceCall = { provider, model };
    if (typeof co.name === "string" && co.name) call.name = co.name;
    if (typeof co.elapsedMs === "number" && Number.isFinite(co.elapsedMs)) call.elapsedMs = co.elapsedMs;
    if (typeof co.error === "string" && co.error) call.error = co.error;
    if (co.usage && typeof co.usage === "object" && !Array.isArray(co.usage)) {
      const u = co.usage as Record<string, unknown>;
      // usage 数值经 num() 归一（负数/非有限数归 0），端点不接受负数 token。
      const usage: Partial<Usage> = {};
      if (typeof u.inputTokens === "number") usage.inputTokens = num(u.inputTokens);
      if (typeof u.outputTokens === "number") usage.outputTokens = num(u.outputTokens);
      if (typeof u.cacheReadTokens === "number") usage.cacheReadTokens = num(u.cacheReadTokens);
      if (typeof u.cacheCreateTokens === "number") usage.cacheCreateTokens = num(u.cacheCreateTokens);
      if (typeof u.totalTokens === "number") usage.totalTokens = num(u.totalTokens);
      call.usage = usage;
    }
    calls.push(call);
  }

  const rep: TraceReport = { flow, calls };
  if (typeof o.label === "string" && o.label) rep.label = o.label;
  if (o.metadata && typeof o.metadata === "object" && !Array.isArray(o.metadata)) {
    rep.metadata = o.metadata as Record<string, unknown>;
  }
  return rep;
}

// emitTraceReport 依赖的上报原语；默认绑定 langsmith.ts 的真实实现，单测可注入替身。
export interface TraceDeps {
  lsStart: (
    name: string,
    runType: "chain" | "llm" | "tool",
    inputs: unknown,
    parentRunId?: string | null,
    metadata?: Record<string, unknown>,
  ) => Promise<string | null>;
  lsEnd: (
    id: string | null,
    opts?: {
      outputs?: unknown;
      error?: string;
      metadata?: Record<string, unknown>;
      usage?: Usage;
      lsModelMetadata?: Record<string, unknown>;
      model?: string;
    },
  ) => Promise<void>;
}

// 默认依赖：动态导入 langsmith.ts，避免测试环境（无 Key）在模块顶层触发任何副作用。
async function defaultDeps(): Promise<TraceDeps> {
  const ls = await import("./langsmith.js");
  return { lsStart: ls.lsStart, lsEnd: ls.lsEnd };
}

/**
 * 把一条前端上报落成 run 树：1 条父 chain run（flow），每个 call 一条子 llm run。
 * 全过程 try/catch 吞异常——埋点永不向调用方报错。
 * deps 可注入以进行离线单测（默认使用 langsmith.ts 的真实实现）。
 */
export async function emitTraceReport(rep: TraceReport, deps?: TraceDeps): Promise<void> {
  const d = deps ?? (await defaultDeps());
  try {
    // 父 chain run 的 metadata：补 flow（= run name），供看板 group_by=metadata&path="flow" 聚合。
    // ⚠️ path 必须用字符串（数组形态会 HTTP 422）。
    const parentMeta: Record<string, unknown> = { ...(rep.metadata ?? {}), flow: rep.flow };
    const parentInputs = rep.label
      ? { label: rep.label, metadata: parentMeta }
      : { metadata: parentMeta };
    const parentId = await d.lsStart(rep.flow, "chain", parentInputs, undefined, parentMeta);

    for (const call of rep.calls) {
      const childName = call.name || `${call.provider}·${call.model}·llm`;
      const childId = await d.lsStart(
        childName,
        "llm",
        { provider: call.provider, model: call.model },
        parentId ?? undefined,
        { provider: call.provider, model: call.model },
      );
      await d.lsEnd(childId, {
        outputs: call.error ? undefined : { elapsedMs: call.elapsedMs },
        error: call.error,
        usage: call.usage as Usage | undefined,
        lsModelMetadata: toLsModelMetadata(call.provider, call.model),
      });
    }

    await d.lsEnd(parentId, { outputs: { callCount: rep.calls.length } });
  } catch {
    /* 埋点失败静默：不影响调用方 */
  }
}
