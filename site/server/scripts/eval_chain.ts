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
 *   # 一键（离线 RAG + 有 Key 时附带 F1→F2 链路）
 *   npm run eval
 *   # 仅跑 F1→F2 链路（需 Key）
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

/** 覆盖 9 个行业，共 33 条，用于常态化评测 F1→F2 是否优于单次直出。 */
const SCENARIOS: Scenario[] = [
  // —— 法律 ——
  { industry: "法律", goal: "我要写一份针对房屋租赁押金纠纷的律师函，语气专业、给租客施压但留和解空间" },
  { industry: "法律", goal: "公司违法解除劳动合同，帮我起草一份劳动仲裁申请书，列清诉求与依据" },
  { industry: "法律", goal: "朋友间借钱，帮我写一份合规的个人借款合同，含利息上限与违约条款" },
  { industry: "法律", goal: "起草一份离婚财产分割协议要点，区分共同财产与个人财产" },
  // —— 医疗健康 ——
  { industry: "医疗健康", goal: "帮我把体检报告里的甲状腺结节解读清楚，说明何时需要就医" },
  { industry: "医疗健康", goal: "为 2 型糖尿病人群设计一周饮食规划，标注升糖指数注意点" },
  { industry: "医疗健康", goal: "写一份儿童退烧用药与家庭护理须知，强调不可自行诊断" },
  { industry: "医疗健康", goal: "给长期伏案的人一套颈椎病办公室自我康复动作说明" },
  // —— 职场办公 ——
  { industry: "职场办公", goal: "帮我写一封给领导的项目延期说明邮件，既要诚恳担责又不能显得无能" },
  { industry: "职场办公", goal: "把本周工作自动生成周报，突出成果、风险与下周计划" },
  { industry: "职场办公", goal: "整理一份跨部门协作会议纪要模板，含决议与待办责任人" },
  { industry: "职场办公", goal: "写一份年度绩效自评，用数据量化贡献并适度展现成长" },
  // —— 教育培训 ——
  { industry: "教育培训", goal: "设计一份给小学生的分数加减法练习题，要循序渐进、带答案" },
  { industry: "教育培训", goal: "写一套英语四级写作模板与一篇范文，覆盖利弊/现象两类题型" },
  { industry: "教育培训", goal: "为新员工设计三天入职培训大纲，平衡文化与岗位技能" },
  { industry: "教育培训", goal: "为零基础成人设计一门 Python 入门课程大纲，重实操" },
  // —— 电商运营 ——
  { industry: "电商运营", goal: "给我一条小红书风格的护肤品种草文案，面向 25 岁敏感肌女生，带emoji" },
  { industry: "电商运营", goal: "写一段淘宝商品详情页卖点文案，突出材质与适用场景" },
  { industry: "电商运营", goal: "策划一个双十一大促活动方案，含满减机制与节奏" },
  { industry: "电商运营", goal: "给一条差评写挽回话术，先共情再给补偿方案" },
  // —— 金融 ——
  { industry: "金融", goal: "帮我给客户写一份基金定投的月度回顾，讲清楚收益与风险，别违规承诺" },
  { industry: "金融", goal: "写一份家庭资产配置建议书，先问清风险偏好再给比例" },
  { industry: "金融", goal: "用通俗语言对比信用贷与抵押贷，说明各自适用人群" },
  { industry: "金融", goal: "写一篇通胀对普通家庭储蓄影响的科普说明，给出应对思路" },
  // —— 写作创作 ——
  { industry: "写作创作", goal: "写一首关于故乡的抒情散文，意象温暖克制" },
  { industry: "写作创作", goal: "写一个 60 秒短视频口播脚本大纲，节奏快、有钩子" },
  { industry: "写作创作", goal: "为一家初创科技公司写品牌故事软文，突出创始初心" },
  // —— 编程开发 ——
  { industry: "编程开发", goal: "写一段 Python 脚本，批量把某个目录下所有图片压缩到 1MB 以内" },
  { industry: "编程开发", goal: "写一份前端表单校验的最佳实践提示词，覆盖必填/格式/异步" },
  { industry: "编程开发", goal: "针对一条慢 SQL 给出优化建议，含索引与执行计划思路" },
  // —— 生活 / 个人效率 ——
  { industry: "生活", goal: "规划一个适合带娃的周末家庭出游计划，兼顾好玩与休息" },
  { industry: "生活", goal: "为减脂期设计一日三餐食谱，标注热量与备餐要点" },
  { industry: "生活", goal: "写一份搬家收拾物品清单与流程，按房间与优先级排序" },
];

// —— 数值解析容错 ——
function coerceNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface Dim { relevance?: number; structure?: number; usable?: number; specific?: number; total?: number; }
interface Judge { A: Dim; B: Dim; winner: "A" | "B" | "平" | "?"; note: string; available: boolean; }

function totalOf(d: Dim): number | null {
  const parts = [d.relevance, d.structure, d.usable, d.specific].map(coerceNum);
  if (parts.every((p) => p !== null)) return (parts[0]! + parts[1]! + parts[2]! + parts[3]!) as number;
  return coerceNum(d.total);
}

/** 从模型输出里尽量抠出 JSON 对象：先去 markdown 围栏，再整体解析，最后大括号截取。 */
function extractJson(text: string): any | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fence ? fence[1] : null, text];
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c.trim()); } catch { /* ignore */ }
    const m = c.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  }
  return null;
}

async function callLLM(provider: string, model: string, apiKey: string, system: string, user: string): Promise<string> {
  const r = await chatStream({ provider, model, apiKey, system, user, maxRetries: 2 });
  return r.text || "";
}

/** 裁判：首轮解析失败则加重语气重试一次，仍失败返回 available:false。 */
async function judge(system: string, user: string): Promise<Judge> {
  let obj = extractJson(await callLLM(J_PROVIDER!, J_MODEL!, J_API_KEY!, system, user));
  if (!obj || !obj.A || !obj.B) {
    obj = extractJson(
      await callLLM(
        J_PROVIDER!, J_MODEL!, J_API_KEY!,
        system + "\n\n【重申】只输出纯 JSON，严禁任何解释或 markdown 围栏，否则判为无效。",
        user,
      ),
    );
  }
  if (!obj || !obj.A || !obj.B) return { A: {}, B: {}, winner: "?", note: "裁判解析失败", available: false };

  const A = obj.A as Dim, B = obj.B as Dim;
  const at = totalOf(A), bt = totalOf(B);
  let winner: Judge["winner"] = "?";
  if (at !== null && bt !== null) winner = at > bt ? "A" : bt > at ? "B" : "平";
  else if (obj.winner === "A" || obj.winner === "B" || obj.winner === "平") winner = obj.winner;
  return { A, B, winner, note: typeof obj.note === "string" ? obj.note : "", available: true };
}

async function runScenario(s: Scenario) {
  // —— F1：生成模板骨架 ——
  const draftSys = getPrompt("draft").replace("{{retrieved}}", "").replace("{{critique}}", "");
  const draftUser = `行业倾向：${s.industry}\n需求：${s.goal}`;
  let template: any = null;
  try {
    const raw = extractJson(await callLLM(PROVIDER!, MODEL!, API_KEY!, draftSys, draftUser));
    template = raw && typeof raw === "object" ? raw : null;
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
  const judgeSys = `你是对比评测裁判。用户给定「目标」，我们产出两条成品提示词：A（基于模板骨架实例化）与 B（单次直出）。请从 4 个维度各打 1-5 分：相关性(relevance)、结构完整度(structure)、可直接使用性(usable)、具体不空洞(specific)。可选给出 total（=四项之和，0-20）。最后给出谁更好(winner:"A"/"B"/"平")与一句话理由(note)。务必只输出如下 JSON，不要任何解释、不要 markdown 围栏：\n{"A":{"relevance":,"structure":,"usable":,"specific":,"total":},"B":{...},"winner":"A|B|平","note":"..."}`;
  const judgeUser = `目标（${s.industry}）：${s.goal}\n\n=== A（模板实例化）===\n${templated}\n\n=== B（单次直出）===\n${direct}`;
  const j = await judge(judgeSys, judgeUser);

  return { s, template, templated, direct, judge: j };
}

async function main() {
  const results = [];
  for (const s of SCENARIOS) {
    console.log(`▶ 评测场景：${s.industry} — ${s.goal.slice(0, 20)}…`);
    results.push(await runScenario(s));
  }

  let aWins = 0, bWins = 0, ties = 0, aTotal = 0, bTotal = 0, valid = 0;
  for (const r of results) {
    const j = r.judge;
    if (!j.available) continue;
    valid++;
    const at = totalOf(j.A), bt = totalOf(j.B);
    if (j.winner === "A") aWins++;
    else if (j.winner === "B") bWins++;
    else ties++;
    if (at !== null) aTotal += at;
    if (bt !== null) bTotal += bt;
  }
  const n = results.length;
  const avgA = valid ? (aTotal / valid).toFixed(2) : "—";
  const avgB = valid ? (bTotal / valid).toFixed(2) : "—";
  const unavailable = n - valid;

  const rows = results.map((r, i) => {
    const at = totalOf(r.judge.A), bt = totalOf(r.judge.B);
    const aStr = at === null ? "—" : at;
    const bStr = bt === null ? "—" : bt;
    return `| ${i + 1} | ${r.s.industry} | ${r.s.goal.slice(0, 24)}… | ${aStr} | ${bStr} | ${r.judge.winner || "?"} | ${(r.judge.note || "").slice(0, 40)} |`;
  }).join("\n");

  const report = `# F1→F2 vs 单次直出 对比评测报告

> 生成时间：${new Date().toISOString()}
> 评测模型：${PROVIDER}/${MODEL}；裁判：${J_PROVIDER}/${J_MODEL}
> 样本数：${n}（裁判有效 ${valid} / 判不可用 ${unavailable}）

## 汇总

| 维度 | 模板实例化(A) | 单次直出(B) |
|---|---|---|
| 平均总分(满分20，仅计有效样本) | ${avgA} | ${avgB} |
| 胜场 | ${aWins} | ${bWins} |
| 平局 | ${ties} | — |
| 判不可用 | ${unavailable} | — |

## 逐场景

| # | 行业 | 目标 | A总分 | B总分 | 胜者 | 备注 |
|---|---|---|---|---|---|---|
${rows}

## 结论

- 若 A 平均总分 ≥ B 且 aWins ≥ bWins：模板化(F1→F2)链路相对单次直出**有优势**，是产品核心主张的有效支撑。
- 若相反：需反思 F1→F2 是否过度设计，或模板实例化 prompt 仍需调优（可在 prompts.ts 追加 use 的 v2 对比）。
- 本评测受裁判模型与样本影响，单次结果仅供方向性参考；判不可用样本已排除出均分，不影响整体判断。
- 常态化运行：\`npm run eval\`（离线 RAG + 有 Key 时附带本链路）。
`;
  fs.writeFileSync(OUT, report, "utf8");
  console.log("\n" + report);
  console.log(`\n报告已写入：${OUT}`);
}

main().catch((e) => {
  console.error("评测失败：", e);
  process.exit(1);
});
