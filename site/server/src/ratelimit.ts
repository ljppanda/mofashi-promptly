// 内存固定窗口限流：公网防刷/防滥用必备。
// 单进程（单容器）下完全够用；若以后多实例横向扩展，需换成 Redis 等共享存储。
import type http from "node:http";

interface Bucket { count: number; resetAt: number; }
const windows = new Map<string, Bucket>();

export interface RateLimitResult { ok: boolean; retryAfter: number; }

// 固定窗口：同一 key 在 windowMs 内最多允许 limit 次；超出返回 ok=false 与剩余秒数。
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const b = windows.get(key);
  if (!b || now >= b.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { ok: true, retryAfter: 0 };
}

// 取客户端真实 IP。公网部署在反代(caddy/nginx)之后，优先取 X-Forwarded-For 首跳；
// 直连或无该头时退回 socket 地址。这样限流 key 才不会被反代 IP 全部归一。
export function clientIp(req: http.IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}
