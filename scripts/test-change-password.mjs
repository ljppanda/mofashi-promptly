// scripts/test-change-password.mjs — 自测 POST /api/auth/change-password
const BASE = "http://localhost:8099";
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name + (extra ? " — " + extra : "")); } else { fail++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); } }

async function regLogin(user, pw) {
  await fetch(BASE + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user, password: pw }) });
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user, password: pw }) });
  const j = await r.json();
  return j.token;
}

console.log("1) 普通用户改密码（正确当前密码）");
let tok = await regLogin("cpuser1", "oldpass123");
let r = await fetch(BASE + "/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json", "x-auth-token": tok }, body: JSON.stringify({ current: "oldpass123", next: "newpass456" }) });
ok("返回 200", r.status === 200, "status=" + r.status);
// 用新密码登录
r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "cpuser1", password: "newpass456" }) });
ok("新密码可登录", r.status === 200, "status=" + r.status);
// 旧密码登录失败
r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "cpuser1", password: "oldpass123" }) });
ok("旧密码已失效", r.status !== 200, "status=" + r.status);

console.log("2) 当前密码错误");
r = await fetch(BASE + "/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json", "x-auth-token": tok }, body: JSON.stringify({ current: "wrongpass", next: "another789" }) });
ok("返回 401 当前密码错误", r.status === 401, "status=" + r.status);
const j2 = await r.json(); ok("错误信息含『当前密码错误』", (j2.error || "").includes("当前密码"), j2.error);

console.log("3) 新密码过短（<8位）");
r = await fetch(BASE + "/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json", "x-auth-token": tok }, body: JSON.stringify({ current: "newpass456", next: "short" }) });
ok("返回 400 长度校验", r.status === 400, "status=" + r.status);

console.log("4) 未登录（无令牌）");
r = await fetch(BASE + "/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current: "x", next: "y1234567" }) });
ok("返回 401 请先登录", r.status === 401, "status=" + r.status);

console.log("5) 管理员（虚拟身份）改密码被拒");
r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "testadminpass" }) });
const adminTok = (await r.json()).token;
r = await fetch(BASE + "/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json", "x-auth-token": adminTok }, body: JSON.stringify({ current: "testadminpass", next: "newadmin123" }) });
ok("返回 400 管理员不可在界面改", r.status === 400, "status=" + r.status);

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
