// tests/relay-allowlist.test.ts — P0-2 白名单纯函数层离线回归（零网络、可安全 import 新模块）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_ORIGINS,
  isAllowedRelayUrl,
  checkRedirect,
  buildCsp,
} from "../src/relay-allowlist.js";

const OPENAI = "https://api.openai.com";

function expectAllow(raw: unknown): URL {
  const r = isAllowedRelayUrl(raw);
  assert.equal(r.ok, true, `应命中白名单: ${String(raw)}`);
  return (r as { ok: true; url: URL }).url;
}

function expectDeny(raw: unknown, code: "RELAY_BAD_URL" | "RELAY_ORIGIN_DENIED"): { origin?: string; reason: string } {
  const r = isAllowedRelayUrl(raw);
  assert.equal(r.ok, false, `应拒绝: ${String(raw)}`);
  assert.equal((r as { ok: false; code: string }).code, code);
  return r as { origin?: string; reason: string };
}

// A1 —— 白名单命中：全成员任意路径都应放行
test("[白名单命中] ALLOWED_ORIGINS 全成员 origin + 任意深层路径全部放行", () => {
  assert.ok(ALLOWED_ORIGINS.size >= 20, "内置 19 个唯一 origin + 豆包前端 origin");
  for (const origin of ALLOWED_ORIGINS) {
    const u = expectAllow(`${origin}/any/deep/path?x=1`);
    assert.equal(u.origin, origin);
  }
});

test("[白名单命中] 关键既有链路路径：文心 / 各家 models / openrouter / 前后端豆包 / ollama", () => {
  const paths = [
    "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat", // 文心 chat（与 token 换取同 origin）
    "https://aip.baidubce.com/oauth/2.0/token",
    "https://api.openai.com/v1/models",
    "https://openrouter.ai/api/v1/chat/completions",
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",      // 后端 providers.ts 豆包
    "https://ark.cn-beijing.volcesengine.com/api/v3/chat/completions", // 前端 llm.ts 豆包（🔴 漂移纠正）
    "http://localhost:11434/v1/chat/completions",                     // ollama 精确 origin
  ];
  for (const p of paths) expectAllow(p);
  assert.ok(ALLOWED_ORIGINS.has("https://ark.cn-beijing.volcesengine.com"));
  assert.ok(ALLOWED_ORIGINS.has("https://ark.cn-beijing.volces.com"));
});

// A1 —— 白名单拒绝：云元数据 / 本机其它端口 / 调试端口 / 外部域名
test("[白名单拒绝] 云元数据 / 内网 / 调试端口 / 外部域名 → RELAY_ORIGIN_DENIED 且 origin 正确", () => {
  const cases: Array<[string, string]> = [
    ["http://169.254.169.254/latest/meta-data/", "http://169.254.169.254"],
    ["http://127.0.0.1:8000/healthz", "http://127.0.0.1:8000"],
    ["http://localhost:9222/json", "http://localhost:9222"],
    ["https://evil.com/v1/chat/completions", "https://evil.com"],
  ];
  for (const [raw, origin] of cases) {
    const r = expectDeny(raw, "RELAY_ORIGIN_DENIED");
    assert.equal(r.origin, origin);
    assert.equal(typeof r.reason, "string");
  }
});

// A5 —— 协议混淆
test("[协议混淆] javascript:/file:/data:/ftp: → RELAY_BAD_URL", () => {
  for (const raw of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/plain,x",
    "ftp://x.example.com/v1",
  ]) expectDeny(raw, "RELAY_BAD_URL");
});

// A5 —— 无 protocol（new URL 不传 base）
test("[无 protocol] //evil.com 与裸域名 / 非字符串 → RELAY_BAD_URL", () => {
  expectDeny("//evil.com/v1", "RELAY_BAD_URL");
  expectDeny("api.openai.com/v1/chat/completions", "RELAY_BAD_URL");
  expectDeny("", "RELAY_BAD_URL");
  expectDeny(undefined, "RELAY_BAD_URL");
  expectDeny(123, "RELAY_BAD_URL");
});

// A5 —— 大小写归一
test("[大小写] 大写 SCHEME/HOST 归一后仍命中", () => {
  const u = expectAllow("HTTPS://API.OPENAI.COM/v1/chat/completions");
  assert.equal(u.origin, OPENAI);
});

// A5 —— 默认端口归一
test("[默认端口] :443 归一命中；:8443 非白名单被拒", () => {
  expectAllow("https://api.openai.com:443/v1/chat/completions");
  const r = expectDeny("https://api.openai.com:8443/v1/chat/completions", "RELAY_ORIGIN_DENIED");
  assert.equal(r.origin, "https://api.openai.com:8443");
});

// A5 —— 凭证混淆
test("[凭证混淆] host@ / user:pw@ 一律拒绝（不误放行 evil.com）", () => {
  const r1 = isAllowedRelayUrl("https://api.openai.com@evil.com/v1/chat/completions");
  assert.equal(r1.ok, false);
  const r2 = isAllowedRelayUrl("https://user:pw@api.openai.com/v1/chat/completions");
  assert.equal(r2.ok, false);
});

// A5 —— 尾点域名 fail-closed
test("[尾点域名] api.openai.com. 归一后仍带点 → fail-closed 拒绝", () => {
  const r = isAllowedRelayUrl("https://api.openai.com./v1/chat/completions");
  assert.equal(r.ok, false);
});

// A5 —— 重定向：3xx 一律拒绝，含「302 指向白名单域名也拒绝」
test("[重定向] 301/302/303/307/308 一律拒绝，且 302 指向白名单域名也不自动跟随", () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const r = checkRedirect(status, "http://169.254.169.254/latest/meta-data/");
    assert.equal(r.ok, false, `${status} 应被拒绝`);
    assert.equal((r as { ok: false; code: string }).code, "RELAY_REDIRECT_DENIED");
    assert.equal(typeof (r as { ok: false; reason: string }).reason, "string");
  }
  const toAllowed = checkRedirect(302, "https://api.openai.com/v1/models");
  assert.equal(toAllowed.ok, false, "不自动跟随，即便 Location 在白名单内也拒绝");
  assert.equal((toAllowed as { ok: false; code: string }).code, "RELAY_REDIRECT_DENIED");
});

test("[重定向] 非 3xx（200/204/400/404/429/500）一律放行", () => {
  for (const status of [200, 204, 400, 404, 429, 500]) {
    assert.equal(checkRedirect(status, null).ok, true, `${status} 应放行`);
  }
});

// A2 —— CSP 同源性逐项断言
test("[CSP 同源性] connect-src = {'self'} ∪ ALLOWED_ORIGINS，逐项相等且无多余项", () => {
  const csp = buildCsp();
  const directives = csp.split("; ").map((d) => d.trim());
  const connect = directives.find((d) => d.startsWith("connect-src "));
  assert.ok(connect, "应含 connect-src 指令");
  const tokens = connect!.slice("connect-src ".length).split(" ").filter(Boolean);
  const got = new Set(tokens);
  const want = new Set<string>(["'self'", ...ALLOWED_ORIGINS]);
  assert.deepEqual([...got].sort(), [...want].sort(), "connect-src 必须与 ALLOWED_ORIGINS 逐项相等");
  assert.ok(!csp.includes("169.254.169.254"), "不得含云元数据地址");
  assert.ok(!tokens.some((t) => t === "*" || t.includes("localhost:*")), "不得有 localhost 通配");
  // 其余指令逐字不动（避免改动 XSS 面）
  for (const d of [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ]) assert.ok(directives.includes(d), `缺失或改动指令: ${d}`);
});

// env 扩展：模块级 const 在 import 时求值，需 cache-bust 动态 import
test("[env 扩展] RELAY_ALLOWED_ORIGINS 合法项同步进 CSP 与白名单，非法项跳过并告警", async () => {
  const prev = process.env.RELAY_ALLOWED_ORIGINS;
  process.env.RELAY_ALLOWED_ORIGINS = "http://127.0.0.1:19999,not-a-url, ,ftp://bad.example";
  try {
    const mod = await import(`../src/relay-allowlist.js?relay_env_test=${Date.now()}_${Math.random().toString(36).slice(2)}`);
    assert.ok(mod.ALLOWED_ORIGINS.has("http://127.0.0.1:19999"), "合法 origin 应加入白名单");
    assert.equal(mod.isAllowedRelayUrl("http://127.0.0.1:19999/anything?x=1").ok, true);
    assert.ok(mod.buildCsp().includes("http://127.0.0.1:19999"), "CSP 须同步含该 origin");
    assert.ok(![...mod.ALLOWED_ORIGINS].some((o) => o.includes("bad.example")), "非 http/https 项应跳过");
    assert.ok(!mod.ALLOWED_ORIGINS.has("null"), "非法项不得产生 'null' origin");
    assert.ok(![...mod.ALLOWED_ORIGINS].some((o) => o.includes("not-a-url")), "非法项应跳过");
  } finally {
    if (prev === undefined) delete process.env.RELAY_ALLOWED_ORIGINS;
    else process.env.RELAY_ALLOWED_ORIGINS = prev;
  }
});
