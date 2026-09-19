// tests/naming.test.ts
// T-01 run 命名规范回归测试（离线、零网络）。
// 守三件事：runNameOf 用 provider id + 半角中点 ·（U+00B7）、labelOf 未被破坏（仍返回中文 label）、
// 二者分工不同（run name 稳定、UI label 可读）。
// 背景：同一 deepseek-chat 曾因 label 文案不同被拆成 5 个统计簇，run name 必须与 label 解耦。

import { test } from "node:test";
import assert from "node:assert/strict";
import { runNameOf, labelOf } from "../src/providers.js";

// ---------------- runNameOf：稳定命名 ----------------

test("runNameOf: provider id + 半角中点 · + ·llm 后缀", () => {
  assert.equal(runNameOf("deepseek", "deepseek-chat"), "deepseek·deepseek-chat·llm");
  assert.equal(runNameOf("openai", "gpt-4o"), "openai·gpt-4o·llm");
});

test("runNameOf: 分隔符是半角中点 U+00B7（锁定码点，防未来手滑改字符）", () => {
  const name = runNameOf("deepseek", "deepseek-chat");
  const parts = name.split("·");
  // 用码点断言，避免源码里看起来像中点的其它字符蒙混过关
  assert.equal(parts.length, 3, "应能按 · 稳定 split 出 3 段");
  assert.deepEqual(parts, ["deepseek", "deepseek-chat", "llm"]);
  assert.equal(name.charCodeAt(8), 0x00b7, "第 1 个分隔符必须是 U+00B7 半角中点");
  // 明确排除常见误用分隔符
  assert.ok(!name.includes("-llm"), "不应把 ·llm 写成 -llm");
  assert.ok(!name.includes("_llm"), "不应使用 _ 作分隔符");
  assert.ok(!name.includes("・"), "不应使用全角/日文中点 ・(U+30FB)");
  assert.ok(!name.includes("\u00b7\u00b7"), "不应出现连续中点");
});

test("runNameOf: 首段是 provider id（与 extra.metadata.ls_provider 同值，可 join）", () => {
  assert.equal(runNameOf("moonshot", "kimi-k2").split("·")[0], "moonshot");
  assert.equal(runNameOf("qwen", "qwen-max").split("·")[0], "qwen");
});

// ---------------- labelOf：未被破坏，仍服务 UI 展示 ----------------

test("labelOf: 仍返回中文 label（UI 展示用途，未被 runNameOf 影响）", () => {
  assert.equal(labelOf("deepseek", "deepseek-chat"), "DeepSeek·deepseek-chat");
  assert.equal(labelOf("qwen", "qwen-max"), "通义千问（阿里）·qwen-max");
});

test("labelOf 与 runNameOf 分工不同：同参下首段不同（label vs id）", () => {
  const id = "deepseek";
  const model = "deepseek-chat";
  const labelName = labelOf(id, model);   // 中文 label
  const runName = runNameOf(id, model);   // provider id
  assert.notEqual(labelName, runName, "两者必须不同，证明 run name 已与 label 解耦");
  assert.equal(labelName.split("·")[0], "DeepSeek");
  assert.equal(runName.split("·")[0], "deepseek");
});

test("labelOf: 未知 provider 回退为 `${id}·${model}`（不抛错）", () => {
  assert.equal(labelOf("nope-provider", "m"), "nope-provider·m");
});
