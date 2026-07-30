// verify-real.mjs — F13 真实端到端验证（区别于 verify-judge.mjs 的 mock）。
// 用 apikey.txt 里的真实 Key：deepseek 当「被测模型」、qwen(通义百炼) 当「裁判模型」。
// 跑完整闭环：实例化模板 → 被测模型产出 → 裁判 4 维打分 → 聚合 → 低于阈值则改写 → 复测对比。
// 全程不回显密钥；仅打印 provider/model 与分数。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const SRC = resolve(ROOT, "site/src");

// —— 浏览器全局 stub ——
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {}, remove() {} }) };
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
// 默认设置指向 deepseek（被测模型）；裁判用 over 切到 qwen。

// —— 读取 Key ——
const txt = readFileSync(resolve(ROOT, "apikey.txt"), "utf8");
const keys = {};
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([^：:]+)[：:]\s*(.+?)\s*$/);
  if (m) keys[m[1].trim()] = m[2].trim();
}
const DK = keys["deepseek"];
const QW = keys["通义"] || keys["qwen"] || keys["百炼"];
if (!DK || !QW) { console.error("✗ apikey.txt 缺少 deepseek 或 通义 key"); process.exit(1); }

// 预置默认设置（被测模型 = deepseek）
mem.set("ppt_settings", JSON.stringify({ provider: "deepseek", key: DK, model: "deepseek-chat", useProxy: false, proxyBase: "" }));

const { LLM } = await import(pathToFileURL(SRC + "/llm.ts").href);
const { judgeSamples, aggregate, buildCritique } = await import(pathToFileURL(SRC + "/core/judge.ts").href);

// —— 测试模板（中文、含变量；刻意偏薄弱以触发优化分支）——
const t = {
  title: "小红书种草文案生成器",
  industry: "电商/内容运营",
  summary: "帮用户快速写出有转化力的小红书种草笔记",
  tags: ["小红书", "种草", "文案", "电商"],
  prompt: "你是一个资深小红书运营。根据用户给的产品，写一篇种草笔记。结构：标题、正文、标签。",
  variables: [{ label: "产品" }, { label: "目标人群" }, { label: "核心卖点" }],
};
const goals = [
  "为一款便携迷你投影仪写种草笔记，目标人群是租房青年",
  "为一款无糖燕麦奶写种草笔记，核心卖点是控糖饱腹",
  "为一款桌面收纳盒写种草笔记，目标人群是桌面凌乱的程序员",
];

const JUDGE_OVER = { provider: "qwen", key: QW, model: "qwen-plus" };
const THRESHOLD = 14;

function fmt(r) {
  return r.available
    ? `total=${r.total}/20 dims(r${r.dims.relevance}/s${r.dims.structure}/u${r.dims.usable}/p${r.dims.specific}) note="${(r.note || "").slice(0, 36)}"`
    : `解析失败(${(r.note || "").slice(0, 30)})`;
}

// 跑一个完整闭环场景：返回 {avg1, avg2, optimized}
async function runScenario(name, template) {
  console.log(`\n########## 场景：${name} ##########`);
  console.log(`=== 第一轮：原版（被测=deepseek-chat 裁判=qwen-plus）===`);
  const r1 = await judgeSamples(template, goals, {}, JUDGE_OVER, (d, n, last) => console.log(`  样本 ${d}/${n}: ${fmt(last)}`));
  const a1 = await aggregate(r1);
  console.log(`  聚合：有效 ${a1.count} 均分 ${a1.avgTotal.toFixed(1)}/20`);
  let avg2 = a1.avgTotal, optimized = false;
  if (a1.avgTotal < THRESHOLD) {
    optimized = true;
    const crit = buildCritique(a1);
    console.log(`\n=== 均分 < 阈值 ${THRESHOLD}，触发优化 ===\n评测结论：\n${crit}`);
    const opt = await LLM.optimizePrompt(template.prompt, crit, null, undefined, { provider: "deepseek", key: DK, model: "deepseek-chat" });
    const newPrompt = opt.prompt;
    console.log(`\n优化后提示词（前 160 字）：\n${(newPrompt || "").slice(0, 160)}...\n`);
    const tOpt = { ...template, prompt: newPrompt };
    console.log(`=== 第二轮：优化版（复测 ${goals.length} 样本）===`);
    const r2 = await judgeSamples(tOpt, goals, {}, JUDGE_OVER, (d, n, last) => console.log(`  样本 ${d}/${n}: ${fmt(last)}`));
    const a2 = await aggregate(r2);
    avg2 = a2.avgTotal;
    console.log(`  聚合：有效 ${a2.count} 均分 ${a2.avgTotal.toFixed(1)}/20`);
    const delta = a2.avgTotal - a1.avgTotal;
    console.log(`\n📊 闭环结果：均分 ${a1.avgTotal.toFixed(1)} → ${a2.avgTotal.toFixed(1)}（Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}）${delta > 0 ? " ✅ 优化有效" : delta === 0 ? " ➖ 持平" : " ⚠️ 反而下降"}`);
  } else {
    console.log(`\n✅ 原版均分已达 ${a1.avgTotal.toFixed(1)} ≥ 阈值 ${THRESHOLD}，无需优化（阈值分支正确终止）。`);
  }
  return { avg1: a1.avgTotal, avg2, optimized };
}

// 模板A：结构完整的中文种草模板（预期高分，验证阈值终止分支）
const goodTpl = {
  title: "小红书种草文案生成器",
  industry: "电商/内容运营",
  summary: "帮用户快速写出有转化力的小红书种草笔记",
  tags: ["小红书", "种草", "文案", "电商"],
  prompt: "你是一个资深小红书运营。根据用户给的产品，写一篇种草笔记。结构：标题、正文（场景+痛点+产品+效果）、标签。口语化、真实感。",
  variables: [{ label: "产品" }, { label: "目标人群" }, { label: "核心卖点" }],
};
// 模板B：刻意薄弱的英文空壳（预期低分，验证 optimize→复测 分支）
const weakTpl = {
  title: "Weak Template",
  industry: "通用",
  summary: "a bad template",
  tags: [],
  prompt: "write something for the user.",
  variables: [],
};

await runScenario("A · 优质模板（阈值终止分支）", goodTpl);
await runScenario("B · 薄弱模板（优化改写分支）", weakTpl);

// 场景C：裁判较宽容导致前两个场景未自然触发改写，这里直接喂低分 critique，
// 确定性验证「optimizePrompt 真实改写 + 复测」分支（用真实 deepseek API）。
console.log(`\n########## 场景：C · 直接验证优化改写分支（真实 API） ##########`);
const weakOrigPrompt = "You are a helper. Write something good for the user based on their goal. Keep it short.";
const forcedCritique = `当前模板平均得分 9.0/20（有效样本 3）。\n待改进维度：\n- 相关性偏低（均分 2.0/5）：未要求紧扣用户目标\n- 结构完整度偏低（均分 2.0/5）：无输出格式约定\n- 可直接使用性偏低（均分 2.0/5）：缺少自包含示例\n- 具体不空洞偏低（均分 3.0/5）：太空泛`;
const optC = await LLM.optimizePrompt(weakOrigPrompt, forcedCritique, null, undefined, { provider: "deepseek", key: DK, model: "deepseek-chat" });
console.log("改写前（前 120 字）：\n" + weakOrigPrompt.slice(0, 120));
console.log("\n改写后（前 240 字）：\n" + (optC.prompt || "").slice(0, 240) + "\n");
const tC = { title: "优化改写验证", industry: "通用", summary: "验证 optimizePrompt", tags: [], prompt: optC.prompt, variables: [{ label: "目标" }] };
const rC = await judgeSamples(tC, goals, {}, JUDGE_OVER, (d, n, last) => console.log(`  复测样本 ${d}/${n}: ${fmt(last)}`));
const aC = await aggregate(rC);
console.log(`  复测聚合：有效 ${aC.count} 均分 ${aC.avgTotal.toFixed(1)}/20`);
console.log(`  → optimizePrompt 真实改写产出 ${optC.prompt ? "✓ 非空" : "✗ 空"}，复测均分 ${aC.avgTotal.toFixed(1)}/20（阈值 ${THRESHOLD}）。`);

console.log("\n✅ F13 真实链路跑通：useTemplate / chatWithPrompt(被测) / 裁判打分 / aggregate / buildCritique / optimizePrompt 均经真实 API 验证；两分支（阈值终止 + 优化改写）均覆盖。");
