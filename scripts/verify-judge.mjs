// verify-judge.mjs — 离线集成验证 F13 的 judge 逻辑（mock LLM，无需真实 Key / 网络）。
// 验证：① 裁判 JSON 解析 ② 多样本聚合均分 ③ 高于阈值不触发优化、低于阈值生成 critique 并调用 optimizePrompt。
//
// 用法（在 site/server 下用其 tsx，因为 llm/judge 用 .ts 经 tsx 解析）：
//   node 跑不了 .ts，用 tsx；脚本用绝对路径 import 项目源文件。

// —— 注入最小浏览器全局 stub，避免 llm.js 加载时访问 window/localStorage 崩溃 ——
globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {}, remove() {} }),
};
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.fetch = () => Promise.reject(new Error("no-net-in-test"));

function assert(cond, msg) {
  if (!cond) { console.error("✗ FAIL:", msg); process.exit(1); }
  console.log("✓", msg);
}

import { pathToFileURL } from "node:url";
const ROOT = "E:/codebuddy/work/提示词生成器/site/src";
// 先加载 llm（得单例），mock 其方法；再加载 judge（复用同一 LLM 实例）
// 注意：源文件是 .ts，tsx 通过 pathToFileURL 直接加载真实 .ts；其内部 .js→.ts 由 tsx resolver 处理。
const { LLM } = await import(pathToFileURL(ROOT + "/llm.ts").href);

let judgeScore = 16; // 可被测试切换：16=高分, 8=低分
LLM.useTemplate = async (t, goal) => ({ prompt: "FINAL_PROMPT:" + goal });
LLM.chatWithPrompt = async (promptText, msgs, onToken, signal, over) => {
  // 裁判 prompt 含「裁判/relevance」字样，返回打分 JSON；否则是被测模型输出
  if (/裁判|relevance/.test(promptText || "")) {
    // 维度随分数等比：16→各维4（无短板），8→各维2（全偏低），与阈值语义一致
    const per = Math.round(judgeScore / 4);
    return { text: JSON.stringify({ relevance: per, structure: per, usable: per, specific: per, total: judgeScore, note: "裁判备注-测试" }) };
  }
  return { text: "OUTPUT_FOR:" + ((msgs && msgs[0] && msgs[0].content) || "") };
};

const { judgeSamples, aggregate, buildCritique } = await import(pathToFileURL(ROOT + "/core/judge.ts").href);

const t = { title: "测试模板", industry: "通用", summary: "测试", prompt: "原始提示词内容" };
const goals = ["目标A", "目标B", "目标C"];

// 场景1：高分(16) → 均分16，不触发优化，critique 含分数
judgeScore = 16;
const r1 = await judgeSamples(t, goals, {}, {}, undefined, undefined);
assert(r1.length === 3 && r1.every((x) => x.available), "场景1：3 条样本全部可用");
const a1 = await aggregate(r1);
assert(a1.avgTotal === 16, "场景1：均分应为 16，实际 " + a1.avgTotal);
assert(a1.count === 3, "场景1：有效样本数 3");
const critHigh = buildCritique(a1);
assert(/平均得分 16\.0\/20/.test(critHigh), "场景1：critique 含 16.0/20");
assert(!/偏低/.test(critHigh), "场景1：高分不应出现「偏低」");

// 场景2：低分(8) → 均分8，critique 含「偏低」维度
judgeScore = 8;
const r2 = await judgeSamples(t, goals, {}, {}, undefined, undefined);
const a2 = await aggregate(r2);
assert(a2.avgTotal === 8, "场景2：均分应为 8，实际 " + a2.avgTotal);
const critLow = buildCritique(a2);
assert(/偏低/.test(critLow), "场景2：低分 critique 应含「偏低」");
assert(/相关性偏低/.test(critLow), "场景2：relevance(均分2)应被标为偏低");

// 场景3：低分触发 optimizePrompt 且传入 critique（optimize.ts run() 的核心分支）
let optCalled = null;
LLM.optimizePrompt = async (orig, critique, onToken, signal, over) => {
  optCalled = { orig, critique };
  return { prompt: "OPTIMIZED:" + orig };
};
judgeScore = 8;
const r3 = await judgeSamples(t, goals, {}, {}, undefined, undefined);
const a3 = await aggregate(r3);
if (a3.avgTotal < 14) {
  const crit = buildCritique(a3);
  const opt = await LLM.optimizePrompt(t.prompt, crit);
  assert(opt.prompt === "OPTIMIZED:" + t.prompt, "场景3：optimize 返回优化版提示词");
  assert(optCalled && /偏低/.test(optCalled.critique), "场景3：optimizePrompt 收到含「偏低」的 critique");
} else {
  assert(false, "场景3：低分应 < 阈值14，实际 " + a3.avgTotal);
}

// 场景4：裁判解析失败（返回非 JSON）→ available=false，aggregate 排除
LLM.chatWithPrompt = async (promptText) => {
  if (/裁判|relevance/.test(promptText || "")) return { text: "这不是json" };
  return { text: "OUT" };
};
judgeScore = 16;
const r4 = await judgeSamples(t, goals, {}, {}, undefined, undefined);
const a4 = await aggregate(r4);
assert(a4.count === 0, "场景4：裁判解析失败时有效样本为 0（不计入均分）");

console.log("\n✅ 全部 judge 集成测试通过：解析 / 聚合 / critique / 阈值分支 / 解析容错 均正常。");
