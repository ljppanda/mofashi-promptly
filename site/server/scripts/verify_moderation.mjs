// 端到端冒烟：社区举报 + 审核台 + 审核日志 + SSRF 回归
const B = "http://localhost:8000";
const H = (extra = {}) => ({ "content-type": "application/json", ...extra });
let pass = 0, fail = 0;
function ok(name, cond, extra = "") { if (cond) { pass++; console.log("  ✅", name, extra); } else { fail++; console.log("  ❌", name, extra); } }

async function j(method, path, body, tok) {
  const headers = H(tok ? { "x-auth-token": tok } : {});
  const r = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const passphrase = process.argv[2];
if (!passphrase) { console.log("用法: node smoke4.mjs <临时口令>"); process.exit(2); }

// 1) 登录
const login = await j("POST", "/api/auth/login", { passphrase });
ok("管理员登录", login.status === 200 && login.data.token, "status=" + login.status);
const tok = login.data.token;

// 2) healthz
const hz = await j("GET", "/healthz");
ok("healthz", hz.status === 200);

// 3) 审核台无令牌 → 401
const modNoTok = await j("GET", "/community/moderation");
ok("审核台 未授权→401", modNoTok.status === 401);

// 4) 举报无令牌 → 401
const repNoTok = await j("POST", "/community/report", { id: "x", reason: "测试" });
ok("举报 未授权→401", repNoTok.status === 401);

// 5) 审核台有令牌 → 200 且字段齐全
const mod0 = await j("GET", "/community/moderation", null, tok);
ok("审核台 授权→200", mod0.status === 200 && Array.isArray(mod0.data.drafts) && Array.isArray(mod0.data.reports) && Array.isArray(mod0.data.log), JSON.stringify(Object.keys(mod0.data || {})));

// 6) 发布良性草稿（触发 publish_draft 审核日志）
const pub = await j("POST", "/community/publish", { title: "冒烟测试-请假邮件", industry: "职场", author: "tester", prompt: "帮我写一封请假邮件，简洁礼貌。", tags: ["邮件"], note: "" }, tok);
ok("发布草稿→200", pub.status === 200 && pub.data.id, "status=" + pub.status);
const cid = pub.data.id;

// 7) 公开（触发 publish_public 审核日志）
const pubNow = await j("POST", "/community/publish-now", { id: cid }, tok);
ok("公开→200", pubNow.status === 200 && pubNow.data.status === "published");

// 8) 举报该已公开内容
const rep = await j("POST", "/community/report", { id: cid, reason: "重复/垃圾", detail: "这是一条冒烟测试举报" }, tok);
ok("举报→200", rep.status === 200 && rep.data.ok);

// 9) 审核台应含 1 条待处理举报
const mod1 = await j("GET", "/community/moderation", null, tok);
ok("审核台 含待处理举报", mod1.data.reports.some(r => r.itemId === cid), "reports=" + mod1.data.reports.length);
ok("审核台 含审核日志(>=2)", mod1.data.log.length >= 2, "log=" + mod1.data.log.length);
const blockedOrPass = mod1.data.log.some(l => l.action === "publish_public");
ok("审核日志含 publish_public", blockedOrPass);

// 10) 下架（触发 takedown 日志 + 从广场移除）
const take = await j("POST", "/community/takedown", { id: cid, reason: "被举报下架" }, tok);
ok("下架→200", take.status === 200 && take.data.ok);

// 11) 处理后举报应可标记 resolved
const rid = mod1.data.reports.find(r => r.itemId === cid).id;
const resolve = await j("POST", "/community/report/resolve", { id: rid, action: "resolved" }, tok);
ok("举报处理→200", resolve.status === 200 && resolve.data.ok);

// 12) 该内容已从广场消失
const sq = await j("GET", "/community/list?status=published&q=冒烟测试");
ok("下架后从广场消失", !sq.data.some(r => r.id === cid), "square=" + sq.data.length);

// 13) SSRF 回归：恶意 metadata → 403
const relay = await j("POST", "/relay", { url: "https://169.254.169.254/latest/meta-data/", method: "GET" });
ok("SSRF 回归 恶意→403", relay.status === 403);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
