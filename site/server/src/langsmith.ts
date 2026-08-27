// langsmith.ts（精简占位）
// 可观测/链路追踪层已在「个人本地工具」裁剪中移除（不再上报任何遥测）。
// 此处仅保留空操作导出，使 agent.ts / providers.ts 的调用点无需改写即可编译通过。
export const LS_ENABLED = false;

export async function withTrace<T>(_name: string, _meta: unknown, fn: (rootId: string | null) => Promise<T>): Promise<T> {
  return fn(null);
}

export async function lsStart(..._args: unknown[]): Promise<string | null> {
  return null;
}

export async function lsEnd(_id: string | null, _extra?: unknown): Promise<void> {
  /* no-op */
}

export function recordProviderAttempt(..._args: unknown[]): void {
  /* no-op */
}

export function recordFailover(..._args: unknown[]): void {
  /* no-op */
}
