// ssrf.ts
// /relay 服务端转发代理的 SSRF 防护：仅允许 LLM 厂商公网域名 + 解析后拒绝私有/保留地址。
// 设计目标：保留「前端带自有 Key 经服务端转发到 LLM 厂商、避开浏览器跨域」的核心能力，
// 同时杜绝被当作跳板打内网 / 云 metadata(169.254.169.254) / 开放中转。

import dns from "node:dns/promises";
import { PROVIDERS } from "./providers.js";

// 内置白名单：从 PROVIDERS 提取公网 https 域名，排除 localhost / 私有地址（如 ollama）。
const BUILTIN_HOSTS = (() => {
  const s = new Set<string>();
  for (const p of Object.values(PROVIDERS)) {
    try {
      const u = new URL((p as { baseURL: string }).baseURL);
      if (u.protocol !== "https:") continue;
      const h = u.hostname.toLowerCase();
      if (h === "localhost" || h.endsWith(".localhost") || /^127\./.test(h) || /^\[::1\]/.test(h)) continue;
      s.add(h);
    } catch { /* ignore */ }
  }
  return s;
})();

// 额外允许的主机（env，逗号分隔）。支持 ".suffix" 形式匹配子域；用于自建兼容代理。
const EXTRA_HOSTS = (process.env.RELAY_EXTRA_HOSTS ?? "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export function isAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BUILTIN_HOSTS.has(h)) return true;
  for (const x of EXTRA_HOSTS) {
    if (x.startsWith(".")) {
      if (h === x.slice(1) || h.endsWith(x)) return true;
    } else if (h === x) return true;
  }
  return false;
}

// 判定 IP 是否落在私有/环回/链路本地/保留段（SSRF 拦截核心）。
function ipIsPrivate(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true; // IPv6 链路本地/唯一本地
  if (v.startsWith("::ffff:")) return ipIsPrivate(v.slice(7)); // IPv4-mapped

  if (v.includes(".")) {
    const p = v.split(".");
    if (p.length !== 4) return true;
    const a = Number(p[0]); const b = Number(p[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return true;
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // 10/8 私有
    if (a === 127) return true;                     // 环回
    if (a === 169 && b === 254) return true;        // 链路本地（含云 metadata 169.254.169.254）
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 私有
    if (a === 192 && b === 168) return true;        // 192.168/16 私有
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a >= 224) return true;                      // 组播/保留
  }
  return false;
}

// 校验 /relay 目标：白名单 + 解析后私有地址拦截。通过则返回 URL，否则抛错（fail closed）。
export async function assertRelayTarget(rawUrl: string): Promise<URL> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error("非法 URL"); }
  if (u.protocol !== "https:") throw new Error("仅允许 https 目标（拒绝明文/内网协议）");
  if (!isAllowedHost(u.hostname)) throw new Error("目标域名不在允许列表");
  // DNS 解析后校验，防域名指向内网 / DNS rebinding（白名单域名本身可信，此为纵深防御）。
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(u.hostname, { all: true });
  } catch {
    throw new Error("DNS 解析失败，已拒绝");
  }
  for (const a of addrs) {
    if (ipIsPrivate(a.address)) throw new Error("目标解析到私有/保留地址，已拒绝");
  }
  return u;
}

// 供测试/运维查看当前生效的白名单。
export function relayAllowList(): string[] {
  return [...BUILTIN_HOSTS, ...EXTRA_HOSTS];
}
