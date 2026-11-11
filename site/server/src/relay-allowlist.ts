// relay-allowlist.ts — /relay 最小域名白名单（纯函数、零副作用）：单一共享 origin 集合同时供 CSP 与 relay 校验。
// 放在独立模块是因为 index.ts 顶层有 listen + warmupRag 副作用，无法安全 import 做白盒离线测试。
import { PROVIDERS } from "./providers.js";
import { log } from "./logger.js";

// 前端 llm.ts:34 豆包 base 的 origin 与后端 providers.ts:26 漂移（volcesengine.com vs volces.com），两者都放行，
// 否则豆包代理模式 100% 被 403；同时修好豆包直连模式原本被 CSP 拦截的既有缺口。
const FRONTEND_ONLY_ORIGINS: readonly string[] = [
  "https://ark.cn-beijing.volcesengine.com",
];

const BAD_URL_PREFIX = "目标地址无效（仅支持 http/https 的已知模型厂商域名）：";

function buildAllowedOrigins(): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const p of Object.values(PROVIDERS)) {
    try { hosts.add(new URL(p.baseURL).origin); } catch { /* 非法 baseURL 跳过 */ }
  }
  for (const o of FRONTEND_ONLY_ORIGINS) {
    try { hosts.add(new URL(o).origin); } catch { /* 常量恒合法 */ }
  }
  for (const item of (process.env.RELAY_ALLOWED_ORIGINS ?? "").split(",")) {
    const s = item.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        log.warn("RELAY_ALLOWED_ORIGINS 忽略非 http/https 项", { value: s });
        continue;
      }
      hosts.add(u.origin);
    } catch {
      log.warn("RELAY_ALLOWED_ORIGINS 忽略非法项", { value: s });
    }
  }
  Object.freeze(hosts);
  return hosts;
}

export const ALLOWED_ORIGINS: ReadonlySet<string> = buildAllowedOrigins();

type RelayCheck =
  | { ok: true; url: URL }
  | { ok: false; code: "RELAY_BAD_URL" | "RELAY_ORIGIN_DENIED"; origin?: string; reason: string };

// 校验单个 relay 目标：按 origin 比较，放行所有既有链路路径（文心 token / 各家 /models / openrouter 兜底）。
export function isAllowedRelayUrl(raw: unknown): RelayCheck {
  const bad = (reason: string): RelayCheck => ({ ok: false, code: "RELAY_BAD_URL", reason: BAD_URL_PREFIX + reason });
  if (typeof raw !== "string" || raw.trim() === "") return bad("缺少 url");

  let u: URL;
  try {
    u = new URL(raw); // 不传 base：无 protocol 的 //evil.com、api.openai.com/v1 直接解析失败
  } catch {
    return bad("目标地址无法解析");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return bad("仅支持 http/https 协议");
  if (u.username || u.password) return bad("目标地址不得包含用户名或密码凭证");

  // new URL 已归一大小写 / 默认端口 / IDN；尾点域名归一后仍带点 → 不匹配 → fail-closed 拒绝。
  const origin = u.origin;
  if (!ALLOWED_ORIGINS.has(origin)) {
    return {
      ok: false,
      code: "RELAY_ORIGIN_DENIED",
      origin,
      reason: `目标域名不在允许列表：${origin}。/relay 仅转发已知模型厂商域名；若使用自定义服务商，请在服务端 .env 配置 RELAY_ALLOWED_ORIGINS 并重启，或到「设置」关闭『通过代理服务器调用』。`,
    };
  }
  return { ok: true, url: u };
}

type RedirectCheck =
  | { ok: true }
  | { ok: false; code: "RELAY_REDIRECT_DENIED"; reason: string };

const REDIRECT_STATUSES: ReadonlySet<number> = new Set<number>([301, 302, 303, 307, 308]);

// 一律拒绝 3xx：配合 handleRelay 的 redirect:"manual"，不自动跟随、不白名单化 Location（防 SSRF 绕道）。
export function checkRedirect(status: number, location: string | null): RedirectCheck {
  if (REDIRECT_STATUSES.has(status)) {
    return {
      ok: false,
      code: "RELAY_REDIRECT_DENIED",
      reason: `目标返回重定向，已拒绝转发（防止跳转到非白名单地址）：${location ?? "(未提供 Location)"}。请检查该服务商的接口地址。`,
    };
  }
  return { ok: true };
}

// 原样沿用 index.ts 既有指令数组，仅把 hosts 换成共享集合（保证 relay 与 CSP 同源），其余逐字不动以不改 XSS 面。
export function buildCsp(): string {
  const connect = ["'self'", ...ALLOWED_ORIGINS].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
