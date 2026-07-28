// tests/security.test.ts
// 关键不变量回归测试（离线、零依赖，CI 可跑）。只守三件最不该被改坏的事：
//   1) /relay 的 SSRF 闸门（白名单 + 仅 https + 拒绝 metadata/内网）
//   2) 用户输入长度上限（防超大 payload 打挂）
//   3) 内容审核关键词兜底（无 LLM 配置时仍能拦违规）
// 注意：本测试在「未配置 MODERATION_PROVIDER」环境下运行，走关键词兜底路径；
//       若 CI 误配了审核 LLM，结果仍应一致（兜底复核），但为确定性此处依赖关键词路径。

import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedHost, assertRelayTarget, relayAllowList } from "../src/ssrf.js";
import { checkLengths, validateCommunityDraft, LIMITS } from "../src/validate.js";
import { moderateContent } from "../src/moderation.js";

// ---------------- SSRF 闸门 ----------------
test("ssrf: 白名单至少含一个厂商域名且能被 isAllowedHost 识别", () => {
  const list = relayAllowList();
  assert.ok(list.length > 0, "白名单不应为空（应含 LLM 厂商域名）");
  assert.equal(isAllowedHost(list[0]), true, "白名单内主机应放行");
});

test("ssrf: 非白名单域名被拒绝", () => {
  assert.equal(isAllowedHost("evil.example.com"), false);
  assert.equal(isAllowedHost("attacker.com"), false);
});

test("ssrf: localhost / 私有地址不在白名单", () => {
  assert.equal(isAllowedHost("localhost"), false);
  assert.equal(isAllowedHost("127.0.0.1"), false);
  assert.equal(isAllowedHost("192.168.1.1"), false);
});

test("ssrf: assertRelayTarget 拒绝明文 http", async () => {
  await assert.rejects(
    () => assertRelayTarget("http://api.deepseek.com/v1"),
    /仅允许 https/,
  );
});

test("ssrf: assertRelayTarget 拒绝云 metadata 地址", async () => {
  await assert.rejects(
    () => assertRelayTarget("https://169.254.169.254/latest/meta-data/"),
    /目标域名不在允许列表/,
  );
});

test("ssrf: assertRelayTarget 拒绝非白名单 https 目标", async () => {
  await assert.rejects(
    () => assertRelayTarget("https://evil.example.com/"),
    /目标域名不在允许列表/,
  );
});

test("ssrf: assertRelayTarget 拒绝非法 URL", async () => {
  await assert.rejects(
    () => assertRelayTarget("not-a-url"),
    /非法 URL/,
  );
});

// ---------------- 输入长度上限 ----------------
test("validate: checkLengths 检测超长字段", () => {
  const errs = checkLengths({ prompt: "x".repeat(LIMITS.PROMPT + 1) }, { prompt: LIMITS.PROMPT });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /超过上限/);
});

test("validate: checkLengths 合法输入通过", () => {
  const errs = checkLengths({ prompt: "正常提示词", title: "标题" }, { prompt: LIMITS.PROMPT, title: LIMITS.TITLE });
  assert.deepEqual(errs, []);
});

test("validate: validateCommunityDraft 标签越界", () => {
  const tooMany = validateCommunityDraft({ prompt: "p", tags: new Array(LIMITS.TAGS_MAX + 1).fill("a") });
  assert.ok(tooMany.some((e) => e.includes("标签数量")), "应报标签数量超限");

  const tooLong = validateCommunityDraft({ prompt: "p", tags: ["x".repeat(LIMITS.TAG + 1)] });
  assert.ok(tooLong.some((e) => e.includes("标签项过长")), "应报标签项过长");
});

test("validate: validateCommunityDraft 超长 prompt 被拦", () => {
  const errs = validateCommunityDraft({ title: "t", prompt: "y".repeat(LIMITS.PROMPT + 1) });
  assert.ok(errs.some((e) => e.includes("prompt")), "应报 prompt 超长");
});

test("validate: validateCommunityDraft 合法草稿通过", () => {
  const errs = validateCommunityDraft({ title: "请假邮件模板", prompt: "帮我写请假邮件", tags: ["邮件", "职场"] });
  assert.deepEqual(errs, []);
});

// ---------------- 内容审核关键词兜底 ----------------
test("moderation: 良性内容放行（关键词兜底）", async () => {
  const r = await moderateContent("请帮我写一封得体的请假邮件，语气正式");
  assert.equal(r.safe, true);
  assert.equal(r.engine, "keyword");
});

test("moderation: 违规内容被拦截（关键词兜底）", async () => {
  const r = await moderateContent("这是色情网站的内容，请勿外传");
  assert.equal(r.safe, false);
  assert.equal(r.engine, "keyword");
  assert.ok(r.reasons.some((x) => x.includes("命中敏感词")), "应给出命中敏感词原因");
});
