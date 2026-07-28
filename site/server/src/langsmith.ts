// langsmith.ts
// 可选可观测层（M10）：把 Agent 的每次调用以 run 形式上报 LangSmith，用于调试 / 监控。
// 设计原则：读环境变量 LANGSMITH_API_KEY；无 Key 时全部静默跳过，零开销、绝不拖慢主链路。
// 有 Key 时：每次 Agent 调用 = 一条 chain run（父），其内部每次模型调用 = 一条 llm run（子）。

const KEY = process.env.LANGSMITH_API_KEY;
const PROJECT = process.env.LANGSMITH_PROJECT || "模法师-Promptly";
const ENDPOINT = (process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com").replace(/\/$/, "");

export const LS_ENABLED = !!KEY;

let projectId: string | null = null;

async function ensureProject(): Promise<string | null> {
  if (projectId) return projectId;
  if (!KEY) return null;
  try {
    // 先尝试创建（已存在会返回错误或现有项目）；LangSmith 对同名 project 通常幂等返回
    const r = await fetch(`${ENDPOINT}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY! },
      body: JSON.stringify({ name: PROJECT }),
    });
    const j = (await r.json().catch(() => ({}))) as any;
    projectId = (j && j.id) || null;
  } catch {
    projectId = null;
  }
  return projectId;
}

// 创建一条 run（父/子皆可）；失败返回 null，调用方无需关心
export async function lsStart(
  name: string,
  runType: "chain" | "llm" | "tool",
  inputs: unknown,
  parentRunId?: string | null,
  metadata?: Record<string, unknown>,
): Promise<string | null> {
  if (!LS_ENABLED) return null;
  try {
    const pid = await ensureProject();
    const id = crypto.randomUUID();
    const r = await fetch(`${ENDPOINT}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY! },
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
    if (!r.ok) return null;
    return id;
  } catch {
    return null;
  }
}

// 结束一条 run（写 outputs 或 error + end_time）；id 为空直接跳过
export async function lsEnd(
  id: string | null,
  opts: { outputs?: unknown; error?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  if (!id) return;
  try {
    await fetch(`${ENDPOINT}/runs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-api-key": KEY! },
      body: JSON.stringify({
        outputs: opts.outputs,
        error: opts.error || null,
        end_time: new Date().toISOString(),
        extra: opts.metadata ? { metadata: opts.metadata } : undefined,
      }),
    });
  } catch {
    /* 上报失败不影响主链路 */
  }
}

// 便捷包裹：把一段 async 逻辑包成带 trace 的父 run，成功/失败都正确结 run。返回原值。
export async function withTrace<T>(
  name: string,
  metadata: Record<string, unknown>,
  fn: (runId: string | null) => Promise<T>,
): Promise<T> {
  const runId = LS_ENABLED ? await lsStart(name, "chain", metadata) : null;
  try {
    const r = await fn(runId);
    return r;
  } catch (e) {
    await lsEnd(runId, { error: String((e as any)?.message || e) });
    throw e;
  }
}
