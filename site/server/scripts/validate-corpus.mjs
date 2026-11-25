// validate-corpus.mjs
// CI 守门：确保 server/data/templates.json 与唯一数据源 src/templates.ts 完全一致，
// 且变量、章节、输出规范都通过结构校验。任何漂移都会让 CI 失败。
//
// 用法：node scripts/validate-corpus.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, validateAll, placeholdersOf } from "./build-corpus.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "src", "templates.ts");
const CORPUS = path.join(__dirname, "..", "data", "templates.json");

function fail(lines) {
  console.error("[validate-corpus] ✗ 语料校验失败：");
  for (const l of lines) console.error(`  - ${l}`);
  process.exit(1);
}

if (!fs.existsSync(CORPUS)) fail([`缺少 ${CORPUS}，请先运行 npm run corpus:build`]);

let expected;
try {
  expected = build(fs.readFileSync(SRC, "utf8"));
} catch (e) {
  fail([`源数据本身不合法：${e.message}`]);
}

let actual;
try {
  actual = JSON.parse(fs.readFileSync(CORPUS, "utf8"));
} catch (e) {
  fail([`templates.json 不是合法 JSON：${e.message}`]);
}

const errs = [];
if (!Array.isArray(actual)) fail(["templates.json 顶层必须是数组"]);
if (actual.length !== expected.length) errs.push(`条数不一致：json=${actual.length} source=${expected.length}`);

const bySlug = new Map(actual.map((t) => [t?.slug, t]));
for (const e of expected) {
  const a = bySlug.get(e.slug);
  if (!a) { errs.push(`json 缺少模板 ${e.slug}`); continue; }
  if (a.prompt !== e.prompt) errs.push(`${e.slug}: prompt 与源数据不一致（请重新运行 corpus:build）`);
  if (JSON.stringify(a.variables) !== JSON.stringify(e.variables)) errs.push(`${e.slug}: variables 与源数据不一致`);
  if (a.industry !== e.industry) errs.push(`${e.slug}: industry 与源数据不一致`);
}

// 对 json 本身再做一次结构校验（防止有人手改 json 引入重复章节/丢变量）
errs.push(...validateAll(actual));

// 额外：json 里每条 prompt 的占位符必须与 variables 对齐
for (const t of actual) {
  const ph = placeholdersOf(t.prompt);
  const names = new Set((t.variables || []).map((v) => v.name));
  for (const p of ph) if (!names.has(p)) errs.push(`${t.slug}: 占位符 {{${p}}} 无对应变量`);
}

if (errs.length) fail(errs.slice(0, 30));

const varCount = actual.reduce((n, t) => n + (t.variables?.length || 0), 0);
console.log(`[validate-corpus] ✓ ${actual.length} 条模板 / ${varCount} 个变量，与源数据一致`);
