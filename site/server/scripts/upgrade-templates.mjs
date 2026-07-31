// 统一把 templates.ts 的 prompt 字段升级为「生产级骨架」（角色/背景/目标/约束/工作流/输出规范/边界/自检）。
// 保留各模板原有的具体写法要求，仅补上缺失的生产级章节并统一结构。
// 运行：node site/server/scripts/upgrade-templates.mjs
// 产物：① 原地重写 site/src/templates.ts  ② 重生 site/server/data/templates.json（RAG 语料） ③ 重生 site/samples/*.json（下载样例）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SRC_TS = path.join(ROOT, "src", "templates.ts");
const CORPUS_OUT = path.join(__dirname, "..", "data", "templates.json");
const SAMPLES_DIR = path.join(ROOT, "samples");

const txt = fs.readFileSync(SRC_TS, "utf8");
const marker = "export const TEMPLATES";
const sIdx = txt.indexOf(marker);
if (sIdx < 0) throw new Error("未找到 export const TEMPLATES");
const arrStart = txt.indexOf("[", sIdx);
let depth = 0, end = -1;
for (let i = arrStart; i < txt.length; i++) {
  const ch = txt[i];
  if (ch === "[") depth++;
  else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
}
if (end < 0) throw new Error("未找到匹配的 ]");
const arr = eval("(" + txt.slice(arrStart, end + 1) + ")");
if (!Array.isArray(arr)) throw new Error("解析结果不是数组");

// 从原 prompt 抽取「角色」行与其余「具体写法要求」
function splitRole(p) {
  const m = p.match(/你是[^\n。]*[。\n]/);
  if (m) {
    const role = m[0].replace(/\n$/, "").trim();
    const rest = p.slice(m.index + m[0].length).trim();
    return { role, rest };
  }
  return { role: "", rest: p.trim() };
}

function upgradePrompt(t) {
  const p = t.prompt || "";
  const { role, rest } = splitRole(p);
  const inputs = (t.variables || []).map((v) => `{{${v.name}}}`).join("、");
  const ind = t.industry || "该";
  const roleLine = (role || `你是${t.title || t.task}专家`).replace(/[。.\s]+$/, "");
  const fmt = (rest || `按任务要求的结构输出；语气专业、贴合${ind}场景；必要时给出示例。`).trim();
  return [
    "# 角色与背景",
    `${roleLine}。专长于${ind}领域的${(t.task || t.title)}，立场专业、输出可信。`,
    "",
    "# 目标",
    `- 基于用户输入（${inputs || "用户目标"}）产出：${t.summary || t.title}。`,
    `- 成功标准：结果具体、可操作、贴合${ind}场景。`,
    "",
    "# 核心约束与禁止项",
    `- 必须：紧扣用户提供的信息、输出具体可执行、保持${ind}语境与专业边界。`,
    `- 禁止：编造未提供的 Facts、偏离专业边界、输出与任务无关内容。`,
    "",
    "# 工作流",
    `1. 接收并理解输入（${inputs || "用户目标"}）。`,
    `2. 按「${t.task || t.title}」的分析/组织逻辑处理关键信息。`,
    `3. 产出符合下方规范的成果。`,
    "",
    "# 输出规范",
    fmt,
    "",
    "# 边界与兜底",
    `- 信息不足时声明假设或提示补充，不臆造。`,
    `- 超出专业能力时，给出边界说明并建议咨询相关专家。`,
    "",
    "# 自检",
    `- 是否覆盖目标？是否遵守约束？格式是否正确？变量是否都用上？`,
  ].join("\n");
}

const upgraded = arr.map((t) => ({ ...t, prompt: upgradePrompt(t) }));

// ① 重写 templates.ts
const header = `// 提示词模板数据（等价于 Markdown + frontmatter）。
// 字段：slug, title, industry, task, summary, tags[], model, variables[], prompt
// variable: { name, label, type: textarea|text|select|multiselect, options?, required?, placeholder? }
// 注：prompt 已统一升级为生产级骨架（角色/背景/目标/约束/工作流/输出规范/边界/自检）。

`;
fs.writeFileSync(SRC_TS, header + "export const TEMPLATES = " + JSON.stringify(upgraded, null, 2) + ";\n", "utf8");
console.log(`[upgrade] 重写 templates.ts：${upgraded.length} 条`);

// ② 重生 RAG 语料
const corpus = upgraded.map((t) => ({
  slug: t.slug,
  title: t.title,
  industry: t.industry,
  task: t.task,
  summary: t.summary || "",
  tags: Array.isArray(t.tags) ? t.tags : [],
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
fs.mkdirSync(path.dirname(CORPUS_OUT), { recursive: true });
fs.writeFileSync(CORPUS_OUT, JSON.stringify(corpus, null, 2), "utf8");
console.log(`[upgrade] 重生语料：${CORPUS_OUT}（${corpus.length} 条）`);

// ③ 重生下载样例
fs.mkdirSync(SAMPLES_DIR, { recursive: true });
for (const t of upgraded) {
  const sample = {
    title: t.title,
    industry: t.industry,
    task: t.task,
    summary: t.summary,
    tags: t.tags,
    variables: t.variables,
    prompt: t.prompt,
  };
  fs.writeFileSync(path.join(SAMPLES_DIR, `${t.slug}.json`), JSON.stringify(sample, null, 2) + "\n", "utf8");
}
console.log(`[upgrade] 重生样例：${SAMPLES_DIR}（${upgraded.length} 个）`);
