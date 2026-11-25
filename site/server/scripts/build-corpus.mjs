// build-corpus.mjs
// 从 site/src/templates.ts（唯一数据源）生成 site/server/data/templates.json（服务端 RAG 语料）。
//
// 与旧实现的区别：
//   1. 不再用裸 eval，而是在空的 vm context 里执行数组字面量（无副作用、有超时）；
//   2. 保留 variables 字段（旧实现直接丢弃，导致服务端语料与前端不一致）；
//   3. 生成前做严格校验：占位符 ↔ variables 必须一一对应，章节不得重复，输出规范不得为空；
//   4. 输出稳定顺序，便于 diff。
//
// 用法：node scripts/build-corpus.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); // site/
const SRC = path.join(ROOT, "src", "templates.ts");
const OUT_DIR = path.join(__dirname, "..", "data");
const OUT = path.join(OUT_DIR, "templates.json");

const VALID_TYPES = new Set(["select", "multiselect", "textarea", "text"]);

function fail(msg) {
  console.error(`[build-corpus] ✗ ${msg}`);
  process.exit(1);
}

// 从 TS 源码里截出 `export const TEMPLATES = [...]` 的数组字面量。
export function extractArrayLiteral(source) {
  const startKw = "export const TEMPLATES";
  const sIdx = source.indexOf(startKw);
  if (sIdx < 0) throw new Error("未找到 `export const TEMPLATES`");
  const arrStart = source.indexOf("[", sIdx);
  if (arrStart < 0) throw new Error("未找到数组起始 [");
  let depth = 0;
  for (let i = arrStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return source.slice(arrStart, i + 1);
    }
  }
  throw new Error("未找到与 [ 匹配的 ]");
}

export function parseTemplates(source) {
  const literal = extractArrayLiteral(source);
  const arr = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 2000 });
  if (!Array.isArray(arr)) throw new Error("解析结果不是数组");
  return arr;
}

export function placeholdersOf(prompt) {
  const out = new Set();
  for (const m of String(prompt || "").matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) out.add(m[1]);
  return out;
}

// 校验单条模板；返回错误列表（空数组 = 通过）。
export function validateTemplate(t, index = 0) {
  const errs = [];
  const where = `#${index} ${t?.slug || "(no slug)"}`;
  for (const k of ["slug", "title", "industry", "task", "prompt"]) {
    if (!t || typeof t[k] !== "string" || !t[k].trim()) errs.push(`${where}: 缺少 ${k}`);
  }
  if (!t || typeof t.prompt !== "string") return errs;

  const vars = Array.isArray(t.variables) ? t.variables : [];
  const names = new Set();
  for (const v of vars) {
    if (!v || typeof v.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(v.name)) errs.push(`${where}: 非法变量名 ${JSON.stringify(v?.name)}`);
    if (v && typeof v.label !== "string" || !v?.label?.trim()) errs.push(`${where}: 变量 ${v?.name} 缺少 label`);
    if (v && v.type && !VALID_TYPES.has(v.type)) errs.push(`${where}: 变量 ${v?.name} 类型非法 ${v.type}`);
    if (names.has(v?.name)) errs.push(`${where}: 变量重复 ${v?.name}`);
    names.add(v?.name);
  }

  const ph = placeholdersOf(t.prompt);
  for (const p of ph) if (!names.has(p)) errs.push(`${where}: prompt 使用了 {{${p}}}，但 variables 未声明`);
  for (const n of names) if (!ph.has(n)) errs.push(`${where}: variables 声明了 ${n}，但 prompt 未使用`);

  // 章节不得重复（同一 # 标题出现多次通常是拼接 bug）
  const headers = [...t.prompt.matchAll(/^#\s+(.+)$/gm)].map((m) => m[1].trim());
  const seen = new Set();
  for (const h of headers) {
    if (seen.has(h)) errs.push(`${where}: 章节重复 "# ${h}"`);
    seen.add(h);
  }

  // 输出规范不能为空/以标点开头（真实出现过 `# 输出规范\n。专长于...` 的腐坏数据）
  const spec = t.prompt.match(/^#\s*输出规范\s*\n([\s\S]*?)(?=\n#\s|$)/m);
  if (spec && !spec[1].trim()) errs.push(`${where}: "# 输出规范" 为空`);
  if (spec && /^[，。、；：]/.test(spec[1].trim())) errs.push(`${where}: "# 输出规范" 以标点开头（疑似拼接腐坏）`);

  if (t.prompt.length < 200) errs.push(`${where}: prompt 过短 (${t.prompt.length})`);
  return errs;
}

export function validateAll(arr) {
  const errs = [];
  const slugs = new Set();
  arr.forEach((t, i) => {
    if (t?.slug && slugs.has(t.slug)) errs.push(`#${i}: slug 重复 ${t.slug}`);
    if (t?.slug) slugs.add(t.slug);
    errs.push(...validateTemplate(t, i));
  });
  return errs;
}

// 生成检索正文：结构信息 + 去掉占位符后的 prompt，让向量召回贴近“结构风格”。
export function toCorpusEntry(t) {
  const stripped = String(t.prompt || "").replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, " ");
  return {
    slug: t.slug,
    title: t.title,
    industry: t.industry,
    task: t.task,
    summary: t.summary || "",
    tags: Array.isArray(t.tags) ? t.tags : [],
    model: t.model || undefined,
    variables: Array.isArray(t.variables) ? t.variables : [],
    prompt: t.prompt,
    text: [
      t.title || "",
      t.industry || "",
      t.task || "",
      t.summary || "",
      (Array.isArray(t.tags) ? t.tags : []).join(" "),
      stripped,
    ].join("\n"),
  };
}

export function build(source) {
  const arr = parseTemplates(source);
  const errs = validateAll(arr);
  if (errs.length) {
    for (const e of errs) console.error(`  - ${e}`);
    throw new Error(`数据校验失败：${errs.length} 处问题`);
  }
  return arr.map(toCorpusEntry);
}

// 仅在直接执行时写文件；被 validate-corpus.mjs import 时只导出函数。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const corpus = build(fs.readFileSync(SRC, "utf8"));
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(corpus, null, 2) + "\n", "utf8");
    const vars = corpus.reduce((n, t) => n + t.variables.length, 0);
    console.log(`[build-corpus] ✓ ${corpus.length} 条模板 / ${vars} 个变量 -> ${OUT}`);
  } catch (e) {
    fail(e.message);
  }
}
