// langsmith.ts
// 可选可观测层：把 Agent 的每次调用以 run 形式上报 LangSmith，用于调试 / 监控 / token 统计。
// 设计原则：
//   1. 显式开关优先（LANGSMITH_ENABLED），未设置则按 LANGSMITH_API_KEY 有无自动判断；
//   2. 未启用 / 无 Key / 断网 / 上报异常 → 全部 no-op，零开销，绝不拖慢或中断主链路；
//   3. 有 Key 时：每次流程 = 一条 chain run（父），其内部每次模型调用 = 一条 llm run（子）。
// 零新增依赖：仅使用 Node 内置 fetch / globalThis.crypto。

import { toUsageMetadata } from "./trace.js";
import type { Usage } from "./providers.js";

const KEY = process.env.LANGSMITH_API_KEY;
export const PROJECT = process.env.LANGSMITH_PROJECT || "模法师-Promptly";
export const ENDPOINT = (process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com").replace(/\/$/, "");
// stats.ts 复用：读取 Key / endpoint / project（Key 为空表示未启用）。
export const LS_API_KEY = KEY;

// 开关语义：显式开关优先；未设置时按有无 Key 自动判断。
//   已设 LANGSMITH_ENABLED → 其值 "1"/"true" 为开，其余为关；
//   未设 → KEY 有值即开。
const EXPLICIT = process.env.LANGSMITH_ENABLED;
export const LS_ENABLED: boolean = EXPLICIT !== undefined
  ? (EXPLICIT === "1" || EXPLICIT.toLowerCase() === "true")
  : !!KEY;

// 模块级单例状态：已解析的项目 id（并发去重由 createEnsureProject 内部 inflight 负责）。
let projectId: string | null = null;

// 可观测层是「尽力而为」：任何一次上报都必须有硬超时，绝不能拖住生成主链路。
const LS_TIMEOUT_MS = Number(process.env.LANGSMITH_TIMEOUT_MS ?? 3000);

// 已发出但尚未完成的 create run 请求。lsEnd 在后台等待它完成再 PATCH，避免
// 「PATCH 先于 POST 到达 → 404」的竞态；对调用方仍然零等待。
const pendingCreates = new Map<string, Promise<boolean>>();

// ensureProject 的可注入依赖（供离线单测；默认走真实 fetch + 模块常量）。
export interface EnsureProjectDeps {
  enabled: boolean;                              // LS_ENABLED
  apiKey?: string;                               // x-api-key
  endpoint: string;                              // LangSmith endpoint
  project: string;                               // 项目名
  fetchRaw: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; text: string }>;
}

// 默认依赖：绑定模块常量与真实 fetch。
function defaultEnsureDeps(): EnsureProjectDeps {
  return {
    enabled: LS_ENABLED,
    apiKey: KEY,
    endpoint: ENDPOINT,
    project: PROJECT,
    fetchRaw: async (url, init) => {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(LS_TIMEOUT_MS) });
      const text = await r.text();
      return { status: r.status, ok: r.ok, text };
    },
  };
}

// 解析 LangSmith project id 的核心实现（依赖注入版，自带单例状态）。
// 返回一个函数，其持有独立的「已解析 id + in-flight Promise」单例 —— 便于单测隔离。
//
// ⚠️ 2026-09-18 真机实测：`POST /projects` 在当前 LangSmith API 上已**废弃返 404**
//    （application/problem+json「The requested path does not exist ... upgrade your LangSmith SDK」）。
//    正确查法是 `GET /sessions?name=<项目名>`（实测 200，返回**数组**，取 [0].id）。
//    故主路径改为 GET /sessions；POST /projects 仅作兜底（自建/未来版本可能只有 POST），
//    且**不挡在主路径前**（否则每次都是一次无谓 404 往返）。
export function createEnsureProject(deps: EnsureProjectDeps): () => Promise<string | null> {
  let pid: string | null = null;
  let inflight: Promise<string | null> | null = null;
  return async function ensure(): Promise<string | null> {
    if (pid) return pid;
    if (!deps.enabled) return null; // §2.8 关闭态：零网络、立即返回
    if (inflight) return inflight;
    inflight = (async (): Promise<string | null> => {
      try {
        // ① 主路径：GET /sessions?name=<项目名>（URL 编码）。响应是数组，取首元素 id。
        const r = await deps.fetchRaw(`${deps.endpoint}/sessions?name=${encodeURIComponent(deps.project)}`, {
          method: "GET",
          headers: { "x-api-key": deps.apiKey ?? "" },
        });
        if (r.ok) {
          let j: unknown = null;
          try { j = JSON.parse(r.text); } catch { j = null; }
          const id = Array.isArray(j) && j.length > 0 ? (j[0] as { id?: string })?.id : undefined;
          if (id) {
            pid = id;
            return pid;
          }
          // 空数组 → 项目不存在，走 ② 兜底尝试创建
        }
        // ② 兜底：POST /projects（旧接口；部分实例可能仍支持）。仅主路径拿不到 id 时才走。
        const r2 = await deps.fetchRaw(`${deps.endpoint}/projects`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": deps.apiKey ?? "" },
          body: JSON.stringify({ name: deps.project }),
        });
        let j2: { id?: string } = {};
        try { j2 = JSON.parse(r2.text) as { id?: string }; } catch { j2 = {}; }
        pid = j2?.id ?? null;
        return pid;
      } catch {
        pid = null;
        return null;
      } finally {
        // 无论成败都释放 in-flight（失败不缓存 Promise，允许下次重试）。
        inflight = null;
      }
    })();
    return inflight;
  };
}

// 模块级唯一实例（供 lsStart / stats.ts 使用）。
const _ensureProjectImpl = createEnsureProject(defaultEnsureDeps());

// 解析（或复用）LangSmith project，返回其 id。并发调用共享同一个 in-flight Promise。
// 导出供 stats.ts 复用（看板取数需要 project id —— 读必须显式指定 session:[id]）。
export async function ensureProject(): Promise<string | null> {
  if (projectId) return projectId;
  if (!LS_ENABLED) return null; // §2.8 关闭态：零网络、立即返回
  const id = await _ensureProjectImpl();
  projectId = id;
  return id;
}

// 创建一条 run（父/子皆可）；失败 / 未启用返回 null，调用方无需关心。
// ⚠️ pid（project_id）为 null 时的行为：**照常上报**，只是省略 project_id 字段、
//    改由 `session_name: PROJECT` 让 LangSmith 按项目名落到默认项目（L79-80）。
//    即「pid 为 null 仍会上报」，并非静默不上报 —— 这也是过去 ensureProject 返 null 时上报看似仍正常的原因。
//
// 性能约定：id 在本地同步生成、网络 POST 在后台完成，函数立即返回。
// 这样父 run / 子 run 的 id 关系不受网络抖动影响，生成链路也不会被观测层拖慢。
export async function lsStart(
  name: string,
  runType: "chain" | "llm" | "tool",
  inputs: unknown,
  parentRunId?: string | null,
  metadata?: Record<string, unknown>,
): Promise<string | null> {
  if (!LS_ENABLED) return null;
  const id = globalThis.crypto.randomUUID();
  const create = (async (): Promise<boolean> => {
    try {
      const pid = await ensureProject();
      const r = await fetch(`${ENDPOINT}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": KEY! },
        signal: AbortSignal.timeout(LS_TIMEOUT_MS),
        body: JSON.stringify({
          id,
          name,
          run_type: runType,
          inputs,
          parent_run_id: parentRunId || undefined,
          project_id: pid || undefined,
          session_name: PROJECT,
          start_time: new Date().toISOString(),
          extra: metadata ? { metadata } : undefined,
        }),
      });
      return r.ok;
    } catch {
      return false;
    }
  })();
  pendingCreates.set(id, create);
  return id;
}

// 结束一条 run（写 outputs / error / token 标准字段）；id 为空直接跳过。
// token / 成本统计写入 LangSmith 能识别的固定位置：
//   - outputs.usage_metadata ← 输出 token / total（官方「Return usage_metadata in the output」路径）
//   - extra.metadata.usage_metadata ← 双写一份（SDK anthropic 路径即写此处，覆盖更稳）
//   - extra.metadata.ls_provider / ls_model_name / ls_model_type ← 成本估算必需
//     （官方：缺 ls_model_name 时 token 可能仍记录，但 cost 不会估算）
// 兼容策略：保留原有 outputs 与 extra.metadata（旧面板），只做「有则补、无则略」，绝不抛错。
// 性能约定：返回已 resolve 的 Promise，网络 PATCH 在后台完成；调用方 await 也不会等待网络。
export function lsEnd(
  id: string | null,
  opts: {
    outputs?: unknown;
    error?: string;
    metadata?: Record<string, unknown>;
    usage?: Usage;
    lsModelMetadata?: Record<string, unknown>;
    model?: string;
  } = {},
): Promise<void> {
  if (!LS_ENABLED || !id) return Promise.resolve();
  const create = pendingCreates.get(id);
  void (async () => {
    try {
      const ok = create ? await create : true;
      pendingCreates.delete(id);
      if (!ok) return; // create 都没成功，PATCH 必然 404，直接放弃

      // outputs：若上游已给对象则合并 usage_metadata；否则以 usage_metadata 为 outputs。
      const usageMeta = toUsageMetadata(opts.usage);
      let outputs = opts.outputs;
      if (usageMeta) {
        outputs = (opts.outputs && typeof opts.outputs === "object" && !Array.isArray(opts.outputs))
          ? { ...(opts.outputs as Record<string, unknown>), usage_metadata: usageMeta }
          : { usage_metadata: usageMeta };
      }

      const lsModelMetadata = opts.lsModelMetadata;

      // extra.metadata：合并上游 metadata 与 ls_* 模型元数据（ls_* 放后即优先生效）。
      const extra: Record<string, unknown> = {};
      const merged = { ...(opts.metadata ?? {}), ...(lsModelMetadata ?? {}) };
      if (Object.keys(merged).length) extra.metadata = merged;
      // 双写 usage_metadata 到 extra.metadata（SDK anthropic 路径即写此处）。
      if (usageMeta) extra.metadata = { ...(extra.metadata ?? {}), usage_metadata: usageMeta };

      await fetch(`${ENDPOINT}/runs/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-api-key": KEY! },
        signal: AbortSignal.timeout(LS_TIMEOUT_MS),
        body: JSON.stringify({
          outputs,
          error: opts.error || null,
          end_time: new Date().toISOString(),
          extra: Object.keys(extra).length ? extra : undefined,
        }),
      });
    } catch {
      /* 上报失败不影响主链路 */
    }
  })();
  return Promise.resolve();
}

// 便捷包裹：把一段 async 逻辑包成带 trace 的父 chain run，成功/失败都正确结 run。返回原值。
export async function withTrace<T>(
  name: string,
  metadata: Record<string, unknown>,
  fn: (rootId: string | null) => Promise<T>,
): Promise<T> {
  // inputs 与 metadata 同传：调用方（agent.ts）传入的本就是「入参描述」（feedbackLen/goalLen/convLen/tag），
  // 当 inputs 读合理；同时必须落到第 5 参 → extra.metadata（LangSmith 按 metadata 过滤/分组读的是此处）。
  // 若将来 inputs 与 metadata 需区分，再扩展本函数签名。
  const runId = await lsStart(name, "chain", metadata, undefined, metadata);
  try {
    return await fn(runId);
  } catch (e) {
    await lsEnd(runId, { error: String((e as any)?.message || e) });
    throw e;
  }
}

// 厂商单次尝试埋点（成功/失败）：以一条 tool-style 子 run 上报，便于按 provider/model 归因。
// 未启用时静默 no-op（零开销）。fire-and-forget，不阻塞调用方。
// ⚠️ 全局运维埋点：parent=null，不归属任何具体流程 run（进程级遥测，独立于某次 agent 调用）。
export function recordProviderAttempt(
  provider: string,
  model: string,
  ok: boolean,
  elapsedMs: number,
  err?: string,
): void {
  if (!LS_ENABLED) return;
  void (async () => {
    try {
      const id = await lsStart(
        `${provider}·${model}·attempt`,
        "tool",
        { provider, model },
        null,
        { provider, model, ok, elapsedMs },
      );
      if (!id) return;
      await lsEnd(id, { outputs: { ok, elapsedMs }, error: ok ? undefined : (err || "failed") });
    } catch {
      /* 埋点失败静默 */
    }
  })();
}

// 主备切换埋点：记录一次 failover 结果。未启用时静默 no-op。
// ⚠️ 全局运维埋点：parent=null，不归属任何具体流程 run（进程级遥测）。
export function recordFailover(ok: boolean): void {
  if (!LS_ENABLED) return;
  void (async () => {
    try {
      const id = await lsStart("llm:failover", "tool", { ok }, null, { ok });
      if (!id) return;
      await lsEnd(id, { outputs: { ok } });
    } catch {
      /* 埋点失败静默 */
    }
  })();
}
