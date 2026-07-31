// 从 site/src/templates.ts 抽取模板库，生成 site/server/data/templates.json，
// 供 LlamaIndex 构建向量索引（M4 RAG 语料）。
// 把 `export const TEMPLATES = [...]` 这段数组字面量 eval 出来即可。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "src", "templates.ts");
const OUT_DIR = path.join(__dirname, "..", "data");
const OUT = path.join(OUT_DIR, "templates.json");

const txt = fs.readFileSync(SRC, "utf8");
const startKw = "export const TEMPLATES";
const sIdx = txt.indexOf(startKw);
if (sIdx < 0) throw new Error("未找到 window.TEMPLATES");
const arrStart = txt.indexOf("[", sIdx);
if (arrStart < 0) throw new Error("未找到数组起始 [");
// 括号配对，找到与 arrStart 匹配的 ]（支持任意嵌套深度）
let depth = 0;
let end = -1;
for (let i = arrStart; i < txt.length; i++) {
  const ch = txt[i];
  if (ch === "[") depth++;
  else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
}
if (end < 0) throw new Error("未找到匹配的 ]");
const arrText = txt.slice(arrStart, end + 1);
// 在受控作用域里 eval 数组字面量（仅数据，无副作用）
const arr = eval("(" + arrText + ")");
if (!Array.isArray(arr)) throw new Error("解析结果不是数组");

const corpus = arr.map((t) => ({
  slug: t.slug,
  title: t.title,
  industry: t.industry,
  task: t.task,
  summary: t.summary || "",
  tags: Array.isArray(t.tags) ? t.tags : [],
  // 检索正文：把可填结构也纳入，让向量召回更贴近“结构风格”
  text: [
    t.title || "",
    t.industry || "",
    t.task || "",
    t.summary || "",
    (Array.isArray(t.tags) ? t.tags : []).join(" "),
    (t.prompt || "").replace(/\{\{[\w]+\}\}/g, " "),
  ].join("\n"),
  prompt: t.prompt || "",
}));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(corpus, null, 2), "utf8");
console.log(`[build-corpus] 写入 ${corpus.length} 条模板 -> ${OUT}`);
