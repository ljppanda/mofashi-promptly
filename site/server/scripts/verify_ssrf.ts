// verify_ssrf.ts
// 验证 /relay 的 SSRF 防护逻辑（白名单 + 私有地址拦截），不依赖外网：
//  - 良性 LLM 厂商域名应在白名单内
//  - 非白名单 / 明文 http / 私有/环回/链路本地地址应在校验阶段即被拒（无需真实发起请求）
// 注：白名单内域名若进一步走 dns.lookup（沙箱无外网会失败），是"真实放行后网络不通"，
//     与"被 SSRF 闸门拒绝"是两回事；真实良性放行需在联网机器验证。

import "dotenv/config";
import { isAllowedHost, assertRelayTarget, relayAllowList } from "../src/ssrf.js";

let fail = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) fail++;
}

// 1) 白名单判定（不触网）
check("白名单含 api.deepseek.com", isAllowedHost("api.deepseek.com"));
check("白名单含 api.moonshot.cn", isAllowedHost("api.moonshot.cn"));
check("白名单含 generativelanguage.googleapis.com", isAllowedHost("generativelanguage.googleapis.com"));
check("排除 localhost（ollama 不走 relay）", !isAllowedHost("localhost"));
check("排除未授权 evil.com", !isAllowedHost("evil.com"));
check("排除 169.254.169.254（云 metadata）", !isAllowedHost("169.254.169.254"));

// 2) assertRelayTarget：恶意目标应在白名单/协议阶段即抛错（不触网）
async function expectReject(name: string, raw: string, keyword: string) {
  try {
    await assertRelayTarget(raw);
    console.log(`❌ ${name}：未拒绝（预期应抛错）`);
    fail++;
  } catch (e) {
    const m = (e as Error).message;
    const ok = m.includes(keyword);
    console.log(`${ok ? "✅" : "❌"} ${name}：拒绝原因="${m}"${ok ? "" : `（期望含 "${keyword}"）`}`);
    if (!ok) fail++;
  }
}

await expectReject("明文 http 被拒", "http://api.deepseek.com/v1", "https");
await expectReject("非白名单域名被拒", "https://evil.example.com/x", "允许列表");
await expectReject("云 metadata 被拒", "https://169.254.169.254/latest/meta-data/", "允许列表");
await expectReject("环回地址被拒", "https://localhost:11434/v1", "允许列表");
await expectReject("非法 URL 被拒", "not-a-url", "非法");

// 3) 良性白名单域名：校验阶段通过（若走 DNS 失败属网络问题，不在本逻辑范围）
try {
  const u = await assertRelayTarget("https://api.deepseek.com/v1/chat/completions");
  console.log(`ℹ️  良性白名单域名校验通过，进入真实请求阶段：${u.hostname}`);
} catch (e) {
  // 沙箱无外网时 dns.lookup 失败 → fail closed。记一条信息，不计入失败。
  console.log(`ℹ️  良性白名单域名在 DNS 解析阶段被 fail-closed（沙箱无外网，正常）：${(e as Error).message}`);
}

console.log(`\n当前 /relay 生效白名单主机数：${relayAllowList().length}`);
relayAllowList().forEach((h) => console.log("   - " + h));

console.log(fail === 0 ? "\n全部 SSRF 防护断言通过 ✅" : `\n有 ${fail} 项失败 ❌`);
process.exit(fail === 0 ? 0 : 1);
