// 轻量结构化日志：公网部署时 `LOG_FORMAT=json` 输出 JSON 行（便于日志采集/告警），
// 默认(开发)输出人类可读文本。不引入第三方依赖，保持最小可行。
type Level = "info" | "warn" | "error";

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  const fmt = (process.env.LOG_FORMAT ?? "text").toLowerCase();
  if (fmt === "json") {
    process.stdout.write(JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(meta && Object.keys(meta).length ? meta : {}),
    }) + "\n");
  } else {
    const tag = level === "error" ? "ERROR" : level === "warn" ? "WARN" : "INFO";
    const metaStr = meta && Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    process.stdout.write(`[${tag}] ${msg}${metaStr}\n`);
  }
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
