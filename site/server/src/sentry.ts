// sentry.ts — 可选错误聚合（仅当 SENTRY_DSN 配置时启用，零依赖、best-effort）。
//
// 设计：不引入官方 SDK（避免新增依赖与网络假设）。仅当配置了 SENTRY_DSN 时，把未捕获异常以
// 最小事件 POST 到 Sentry 的 store endpoint；未配置则完全不动作，离线/内测环境零开销、零外发。
// 用法：设环境变量 SENTRY_DSN=https://<key>@<host>/<projectId> 即可自动启用。

const DSN = process.env.SENTRY_DSN;
let projectId: string | null = null;
let key: string | null = null;
if (DSN) {
  try {
    const u = new URL(DSN);
    const m = u.pathname.replace(/^\//, "");
    projectId = m || null;
    key = u.username || null;
    if (!projectId || !key) { projectId = null; key = null; }
  } catch {
    projectId = null;
    key = null;
  }
}

export function reportError(err: unknown): void {
  if (!DSN || !projectId || !key) return; // 未配置：静默跳过
  const message = String((err as any)?.message ?? err);
  const stack = String((err as any)?.stack ?? "");
  const event = {
    event_id: Math.random().toString(16).slice(2, 18),
    timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    level: "error",
    platform: "node",
    message,
    exception: [{ type: "Error", value: message }],
    extra: { stack },
  };
  const host = new URL(DSN).host;
  const url = `https://${host}/api/${projectId}/store/`;
  try {
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=cppromptly/1.0`,
      },
      body: JSON.stringify(event),
    }).catch(() => { /* 上报失败忽略 */ });
  } catch {
    /* 忽略 */
  }
}
