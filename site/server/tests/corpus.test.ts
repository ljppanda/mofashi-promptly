// tests/corpus.test.ts
// 语料流水线的纯函数回归：确保「占位符 ↔ variables」「章节唯一」「输出规范非空」三条规则
// 在 CI 中始终生效，而不是只靠人肉 review。
// @ts-expect-error build-corpus.mjs 是无类型的纯 ESM 脚本
import { validateTemplate, placeholdersOf, build } from "../scripts/build-corpus.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const good = {
  slug: "demo",
  title: "演示",
  industry: "测试",
  task: "演示任务",
  prompt: [
    "# 角色与背景",
    "你是一名 {{role}}。",
    "# 目标",
    "基于 {{input}} 产出结果。",
    "# 输出规范",
    "请输出 {{format}}。",
  ].join("\n") + "\n" + "填充".repeat(120),
  variables: [
    { name: "role", label: "角色", type: "text", required: true },
    { name: "input", label: "输入", type: "textarea", required: true },
    { name: "format", label: "格式", type: "select", options: ["表格", "列表"], required: true },
  ],
};

test("corpus: 合法模板通过校验", () => {
  assert.deepEqual(validateTemplate(good), []);
});

test("corpus: 检测未声明的占位符", () => {
  const bad = { ...good, variables: good.variables.filter((v) => v.name !== "input") };
  const errs = validateTemplate(bad);
  assert.ok(errs.some((e: string) => e.includes("{{input}}") && e.includes("未声明")), errs.join("\n"));
});

test("corpus: 检测声明了但未使用的变量", () => {
  const bad = { ...good, variables: [...good.variables, { name: "unused", label: "未用", type: "text" }] };
  const errs = validateTemplate(bad);
  assert.ok(errs.some((e: string) => e.includes("unused") && e.includes("未使用")), errs.join("\n"));
});

test("corpus: 检测重复章节", () => {
  const bad = { ...good, prompt: good.prompt.replace("# 输出规范", "# 目标\n重复\n# 输出规范") };
  const errs = validateTemplate(bad);
  assert.ok(errs.some((e: string) => e.includes('章节重复 "# 目标"')), errs.join("\n"));
});

test("corpus: 检测输出规范以标点开头（拼接腐坏）", () => {
  const bad = { ...good, prompt: good.prompt.replace("请输出 {{format}}。", "。请输出 {{format}}。") };
  const errs = validateTemplate(bad);
  assert.ok(errs.some((e: string) => e.includes("以标点开头")), errs.join("\n"));
});

test("corpus: 占位符提取去重", () => {
  assert.deepEqual([...placeholdersOf("{{a}} {{b}} {{a}}")].sort(), ["a", "b"]);
});

test("corpus: 真实模板库可通过完整构建", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../src/templates.ts"), "utf8");
  const corpus = build(src);
  assert.ok(corpus.length >= 100, `模板数异常：${corpus.length}`);
  assert.ok(corpus.every((t: any) => t.variables.length > 0), "每条模板都应带 variables");
});
