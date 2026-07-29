/**
 * F1→F2 模板实例化 vs 单次直出 对比评测框架。
 *
 * 目的：验证产品核心主张——「先生成模板骨架(F1)再实例化(F2)」是否真的优于
 * 「一句话需求直接生成成品提示词（单次直出）」。用 LLM-as-judge 对两条产物打分对比。
 *
 * ⚠️ 需要 LLM 调用，必须提供环境变量（本项目模型 Key 在浏览器，服务端评测需显式传入）：
 *   EVAL_PROVIDER  例如 openai / deepseek / moonshot
 *   EVAL_MODEL     例如 gpt-4o-mini / deepseek-chat
 *   EVAL_API_KEY   对应服务商 Key
 *   可选 EVAL_JUDGE_PROVIDER / EVAL_JUDGE_MODEL / EVAL_JUDGE_API_KEY（默认复用上面三者）
 *
 * 用法：
 *   EVAL_PROVIDER=deepseek EVAL_MODEL=deepseek-chat EVAL_API_KEY=sk-xxx npm run eval:chain
 *
 * 报告写入 scripts/eval_chain_report.md。无 Key 时打印指引并退出 1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatStream } from "../src/providers.js";
import { getPrompt } from "../src/prompts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "eval_chain_report.md");

const PROVIDER = process.env.EVAL_PROVIDER;
const MODEL = process.env.EVAL_MODEL;
const API_KEY = process.env.EVAL_API_KEY;
const J_PROVIDER = process.env.EVAL_JUDGE_PROVIDER || PROVIDER;
const J_MODEL = process.env.EVAL_JUDGE_MODEL || MODEL;
const J_API_KEY = process.env.EVAL_JUDGE_API_KEY || API_KEY;

if (!PROVIDER || !MODEL || !API_KEY) {
  console.error("✗ 缺少评测所需环境变量。请设置：EVAL_PROVIDER / EVAL_MODEL / EVAL_API_KEY");
  console.error("  示例：EVAL_PROVIDER=deepseek EVAL_MODEL=deepseek-chat EVAL_API_KEY=sk-xxx npm run eval:chain");
  process.exit(1);
}

interface Scenario { industry: string; goal: string; }
const SCENARIOS: Scenario[] = [
  { industry: "法律", goal: "我要写一份针对房屋租赁押金纠纷的律师函，语气专业、给租客施压但留和解空间" },
  { industry: "职场办公", goal: "帮我写一封给领导的项目延期说明邮件，既要诚恳担责又不能显得无能" },
  { industry: "电商运营", goal: "给我一条小红书风格的护肤品种草文案，面向 25 岁敏感肌女生，带emoji" },
  { industry: "教育培训", goal: "设计一份给小学生的分数加减法练习题，要循序渐进、带答案" },
  { industry: "编程开发", goal: "写一段 Python 脚本，批量把某个目录下所有图片压缩到 1MB 以内" },
  { industry: "金融", goal: "帮我给客户写一份基金定投的月度回顾，讲清楚收益与风险，别违规承诺" },
];

function stripFence(s: string): string {
  let t = (s || "").trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) t = m[1].trim();
  return t;
}

async function callLLM(provider: string, model: string, apiKey: string, system: string, user: string): Promise<string> {
  const r = await chatStream({ provider, model, apiKey, system, user, maxRetries: 2 });
  return r.text || "";
}

async function runScenario(s: Scenario) {
  // —— F1：生成模板骨架 ——
  const draftSys = getPrompt("draft").replace("{{retrieved}}", "").replace("{{critique}}", "");
  const draftUser = `行业倾向：${s.industry}\n需求：${s.goal}`;
  let template: any = null;
  try {
    template = JSON.parse(stripFence(await callLLM(PROVIDER!, MODEL!, API_KEY!, draftSys, draftUser)));
  } catch {
    template = null;
  }
  // —— F2：模板实例化（成品提示词）——
  let templated = "";
  if (template && template.prompt) {
    const useSys =
      getPrompt("use") +
      `\n\n【模板专长】\n标题：${template.title || ""}\n行业：${template.industry || s.industry}\n定位：${template.summary || ""}\n标签：${(template.tags || []).join("、")}\n` +
      `\n【模板结构骨架】\n${template.prompt}`;
    templated = await callLLM(PROVIDER!, MODEL!, API_KEY!, useSys, s.goal);
  } else {
    templated = "（F1 模板生成失败，无法实例化）";
  }

  // —— 单次直出（对照）——
  const directSys = `你是一名顶尖的「提示词工程师」。用户会给出自己的目标，请你直接写出一条【具体、可直接复制粘贴进任意 AI 助手使用】的成品提示词。要求：角色设定清晰、上下文/背景明确、任务与约束具体、输出格式结构化；只输出最终提示词正文，不要解释、不要 markdown 围栏。`;
  const direct = await callLLM(PROVIDER!, MODEL!, API_KEY!, directSys, `行业：${s.industry}\n目标：${s.goal}`);

  // —— LLM 裁判打分 ——
  const judgeSys = `你是对比评测裁判。用户给定「目标」，我们产出两条成品提示词：A（基于模板骨架实例化）与 B（单次直出）。请从 4 个维度各打 1-5 分：相关性(贴合目标)、结构完整度、可直接使用性、 specificity(具体不空洞)。最后给出谁更好(winner: A/B/平)与一句话理由。只输出 JSON：{"A":{relevance,structure,usable,specific,total},"B":{...},"winner":"A|B|平","note":"..."}`;
  const judgeUser = `目标（${s.industry}）：${s.goal}\n\n=== A（模板实例化）===\n${templated}\n\n=== B（单次直出）===\n${direct}`;
  let judge: any = { A: {}, B: {}, winner: "平", note: "" };
  try {
    judge = JSON.parse(stripFence(await callLLM(J_PROVIDER!, J_MODEL!, J_API_KEY!, judgeSys, judgeUser)));
  } catch {
    judge = { A: { total: "?" }, B: { total: "?" }, winner: "?", note: "裁判解析失败" };
  }

  return { s, template, templated, direct, judge };
}

async function main() {
  const results = [];
  for (const s of SCENARIOS) {
    console.log(`▶ 评测场景：${s.industry} — ${s.goal.slice(0, 20)}…`);
    results.push(await runScenario(s));
  }

  let aWins = 0, bWins = 0, ties = 0, aTotal = 0, bTotal = 0;
  for (const r of results) {
    const w = r.judge.winner;
    if (w === "A") aWins++;
    else if (w === "B") bWins++;
    else ties++;
    const at = Number(r.judge.A?.total ?? 0), bt = Number(r.judge.B?.total ?? 0);
    aTotal += at; bTotal += bt;
  }
  const n = results.length;

  const rows = results.map((r, i) => {
    const at = Number(r.judge.A?.total ?? "?"), bt = Number(r.judge.B?.total ?? "?");
    return `| ${i + 1} | ${r.s.industry} | ${r.s.goal.slice(0, 24)}… | ${at} | ${bt} | ${r.judge.winner || "?"} | ${(r.judge.note || "").slice(0, 40)} |`;
  }).join("\n");

  const report = `# F1→F2 vs 单次直出 对比评测报告

> 生成时间：${new Date().toISOString()}
> 评测模型：${PROVIDER}/${MODEL}；裁判：${J_PROVIDER}/${J_MODEL}
> 样本数：${n}

## 汇总

| 维度 | 模板实例化(A) | 单次直出(B) |
|---|---|---|
| 平均总分(满分20) | ${(aTotal / n).toFixed(2)} | ${(bTotal / n).toFixed(2)} |
| 胜场 | ${aWins} | ${bWins} |
| 平局 | ${ties} | — |

## 逐场景

| # | 行业 | 目标 | A总分 | B总分 | 胜者 | 备注 |
|---|---|---|---|---|---|---|
${rows}

## 结论

- 若 A 平均总分 ≥ B 且 aWins ≥ bWins：模板化(F1→F2)链路相对单次直出**有优势**，是产品核心主张的有效支撑；建议把评测集扩充到 30+ 场景后常态化跑。
- 若相反：需反思 F1→F2 是否过度设计，或模板实例化 prompt 仍需调优（可在 prompts.ts 追加 use 的 v2 对比）。
- 注意：本评测受裁判模型与样本影响，单次结果仅供方向性参考。
`;
  fs.writeFileSync(OUT, report, "utf8");
  console.log("\n" + report);
  console.log(`\n报告已写入：${OUT}`);
}

main().catch((e) => {
  console.error("评测失败：", e);
  process.exit(1);
});
