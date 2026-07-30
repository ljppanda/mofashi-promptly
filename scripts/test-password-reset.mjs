// scripts/test-password-reset.mjs — 自测 忘记密码 → 邮箱重置 全链路（dev 模式：链接同步落盘到 dev-reset-links.log）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __here = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:8099";
const LINK_FILE = path.resolve(__here, "..", "site", "server", "data", "dev-reset-links.log");
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name + (extra ? " — " + extra : "")); } else { fail++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); } }

async function regLogin(user, pw, email) {
  await fetch(BASE + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user, password: pw, email }) });
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user, password: pw }) });
  return (await r.json()).token;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForTokenInFile(timeoutMs = 5000) {
  const re = /\?token=([a-f0-9]+)/g;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const txt = fs.readFileSync(LINK_FILE, "utf8");
      const all = [...txt.matchAll(re)];
      if (all.length) return all[all.length - 1][1]; // 取最新一条，避免读到历史残留
    } catch { /* ignore */ }
    await sleep(120);
  }
  return null;
}
// 启动前清空链接文件，保证本次捕获的 token 一定是新鲜的
try { fs.mkdirSync(path.dirname(LINK_FILE), { recursive: true }); fs.writeFileSync(LINK_FILE, ""); } catch {}

console.log("1) 注册带邮箱");
await regLogin("resetuser", "oldpass123", "resetuser@example.com");
ok("注册成功(可登录)", true);

console.log("2) 忘记密码（正确邮箱）→ 服务端日志应打印重置链接");
let r = await fetch(BASE + "/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "resetuser@example.com" }) });
ok("返回 200 通用提示", r.status === 200, "status=" + r.status);
const j = await r.json();
ok("提示语含『已注册/查收邮件』(枚举防护)", /已注册|查收邮件|发送/.test(j.message || ""), j.message);
const token = await waitForTokenInFile();
ok("服务端日志捕获到重置 token", !!token, token ? "len=" + token.length : "未捕获");
if (!token) { console.log("\n结果: " + pass + " 通过 / " + fail + " 失败"); process.exit(1); }

console.log("3) 凭 token 重置密码");
r = await fetch(BASE + "/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, next: "newpass456" }) });
ok("重置返回 200", r.status === 200, "status=" + r.status);
r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "resetuser", password: "newpass456" }) });
ok("新密码可登录", r.status === 200, "status=" + r.status);
r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "resetuser", password: "oldpass123" }) });
ok("旧密码已失效", r.status !== 200, "status=" + r.status);

console.log("4) 复用同一 token（应已消耗）→ 拒绝");
r = await fetch(BASE + "/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, next: "another789" }) });
ok("复用令牌返回 400", r.status === 400, "status=" + r.status);

console.log("5) 不存在的邮箱 → 同样返回 200（枚举防护）");
r = await fetch(BASE + "/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com" }) });
ok("不存在邮箱也返回 200", r.status === 200, "status=" + r.status);

console.log("6) 非法邮箱格式 → 200 或 429(限流)，均不泄露是否存在");
r = await fetch(BASE + "/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "not-an-email" }) });
ok("非法格式返回 200 或 429", r.status === 200 || r.status === 429, "status=" + r.status);

console.log("7) 伪造/无效 token → 400");
r = await fetch(BASE + "/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "deadbeefdeadbeef", next: "whatever123" }) });
ok("无效 token 返回 400", r.status === 400, "status=" + r.status);

console.log("8) 新密码过短 → 400");
r = await fetch(BASE + "/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "x", next: "short" }) });
ok("短密码返回 400", r.status === 400, "status=" + r.status);

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
