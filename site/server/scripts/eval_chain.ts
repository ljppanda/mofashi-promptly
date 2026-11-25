/**
 * F1→F2 模板实例化 vs 单次直出：盲测成对评测 CLI。
 *
 * 方法论（相对旧版的关键变化）：
 *   1. 盲测：裁判只看到「方案甲/方案乙」，不知道哪条来自实验组；每次重复随机左右顺序。
 *   2. 多裁判 + 重复：默认 3 次重复，可配置多个裁判模型，取多数票。
 *   3. 统计：报告胜率、bootstrap 95% 置信区间、精确二项符号检验 p 值。
 *   4. 可复现：同 seed 下左右顺序与 bootstrap 结果一致。
 *   5. 诚实标注：默认链路不含 RAG；需要 RAG 时显式 EVAL_WITH_RAG=1。
 *
 * 环境变量：
 *   EVAL_PROVIDER / EVAL_MODEL / EVAL_API_KEY        被测模型（必填，dry-run 除外）
 *   EVAL_JUDGE_MODELS="openai:gpt-4o-mini,deepseek:deepseek-chat"  可选，多个裁判
 *   EVAL_JUDGE_API_KEY / EVAL_JUDGE_API_KEY_<PROVIDER>              裁判 Key
 *   EVAL_REPEATS=3            每个场景重复比较次数
 *   EVAL_SPLIT=all|dev|holdout  场景划分（默认 all）
 *   EVAL_WITH_RAG=1           两阶段链路是否注入检索上下文
 *   EVAL_DRY_RUN=1            离线跑通全流程（无需 Key）
 *
 * 用法：
 *   npm run eval:chain
 *   EVAL_DRY_RUN=1 npm run eval:chain
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatStream } from "../src/providers.js";
import { getPrompt } from "../src/prompts.js";
import { runPairwiseEval, splitScenarios, type Scenario, type Verdict } from "../src/eval-chain.js";
import { fmt, fmtCI } from "../src/eval-stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_MD = path.resolve(__dirname, "eval_chain_report.md");
const OUT_JSON = path.resolve(__dirname, "eval_chain_report.json");

const DRY = process.env.EVAL_DRY_RUN === "1" || process.argv.includes("--dry-run");
const PROVIDER = process.env.EVAL_PROVIDER;
const MODEL = process.env.EVAL_MODEL;
const API_KEY = process.env.EVAL_API_KEY;
const REPEATS = Math.max(1, Number(process.env.EVAL_REPEATS ?? 3));
const SPLIT = (process.env.EVAL_SPLIT ?? "all") as "all" | "dev" | "holdout";
const WITH_RAG = process.env.EVAL_WITH_RAG === "1";
const SEED = Number(process.env.EVAL_SEED ?? 20260101);

interface JudgeCfg { provider: string; model: string; apiKey: string; label: string; }

function keyFor(provider?: string): string {
  const p = provider || "";
  return (
    process.env[`EVAL_JUDGE_API_KEY_${p.toUpperCase()}`] ||
    process.env.EVAL_JUDGE_API_KEY ||
    API_KEY ||
    ""
  );
}

function judges(): JudgeCfg[] {
  if (DRY) return [{ provider: "dry", model: "dry", apiKey: "dry", label: "dry-run" }];
  const raw = (process.env.EVAL_JUDGE_MODELS ?? "").trim();
  const list = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        const i = s.indexOf(":");
        const provider = i < 0 ? s : s.slice(0, i);
        const model = i < 0 ? "" : s.slice(i + 1);
        return { provider, model, apiKey: keyFor(provider), label: `${provider}/${model}` };
      })
    : [{ provider: PROVIDER!, model: MODEL!, apiKey: keyFor(PROVIDER!), label: `${PROVIDER}/${MODEL}` }];
  return list.filter((j) => j.provider && j.model && j.apiKey);
}

if (!DRY && (!PROVIDER || !MODEL || !API_KEY)) {
  console.error("✗ 缺少评测所需环境变量。请设置：EVAL_PROVIDER / EVAL_MODEL / EVAL_API_KEY");
  console.error("  或使用 EVAL_DRY_RUN=1 离线跑通流程。");
  process.exit(1);
}

/** 覆盖 9 个行业，共 33 条，用于常态化评测 F1→F2 是否优于单次直出。 */
const SCENARIOS: Scenario[] = [
  { industry: "法律", goal: "我要写一份针对房屋租赁押金纠纷的律师函，语气专业、给租客施压但留和解空间" },
  { industry: "法律", goal: "公司违法解除劳动合同，帮我起草一份劳动仲裁申请书，列清诉求与依据" },
  { industry: "法律", goal: "朋友间借钱，帮我写一份合规的个人借款合同，含利息上限与违约条款" },
  { industry: "法律", goal: "起草一份离婚财产分割协议要点，区分共同财产与个人财产" },
  { industry: "医疗健康", goal: "帮我把体检报告里的甲状腺结节解读清楚，说明何时需要就医" },
  { industry: "医疗健康", goal: "为 2 型糖尿病人群设计一周饮食规划，标注升糖指数注意点" },
  { industry: "医疗健康", goal: "写一份儿童退烧用药与家庭护理须知，强调不可自行诊断" },
  { industry: "医疗健康", goal: "给长期伏案的人一套颈椎病办公室自我康复动作说明" },
  { industry: "职场办公", goal: "帮我写一封给领导的项目延期说明邮件，既要诚恳担责又不能显得无能" },
  { industry: "职场办公", goal: "把本周工作自动生成周报，突出成果、风险与下周计划" },
  { industry: "职场办公", goal: "整理一份跨部门协作会议纪要模板，含决议与待办责任人" },
  { industry: "职场办公", goal: "写一份年度绩效自评，用数据量化贡献并适度展现成长" },
  { industry: "教育培训", goal: "设计一份给小学生的分数加减法练习题，要循序渐进、带答案" },
  { industry: "教育培训", goal: "写一套英语四级写作模板与一篇范文，覆盖利弊/现象两类题型" },
  { industry: "教育培训", goal: "为新员工设计三天入职培训大纲，平衡文化与岗位技能" },
  { industry: "教育培训", goal: "为零基础成人设计一门 Python 入门课程大纲，重实操" },
  { industry: "电商运营", goal: "给我一条小红书风格的护肤品种草文案，面向 25 岁敏感肌女生，带emoji" },
  { industry: "电商运营", goal: "写一段淘宝商品详情页卖点文案，突出材质与适用场景" },
  { industry: "电商运营", goal: "策划一个双十一大促活动方案，含满减机制与节奏" },
  { industry: "电商运营", goal: "给一条差评写挽回话术，先共情再给补偿方案" },
  { industry: "金融", goal: "帮我给客户写一份基金定投的月度回顾，讲清楚收益与风险，别违规承诺" },
  { industry: "金融", goal: "写一份家庭资产配置建议书，先问清风险偏好再给比例" },
  { industry: "金融", goal: "用通俗语言对比信用贷与抵押贷，说明各自适用人群" },
  { industry: "金融", goal: "写一篇通胀对普通家庭储蓄影响的科普说明，给出应对思路" },
  { industry: "写作创作", goal: "写一首关于故乡的抒情散文，意象温暖克制" },
  { industry: "写作创作", goal: "写一个 60 秒短视频口播脚本大纲，节奏快、有钩子" },
  { industry: "写作创作", goal: "为一家初创科技公司写品牌故事软文，突出创始初心" },
  { industry: "编程开发", goal: "写一段 Python 脚本，批量把某个目录下所有图片压缩到 1MB 以内" },
  { industry: "编程开发", goal: "写一份前端表单校验的最佳实践提示词，覆盖必填/格式/异步" },
  { industry: "编程开发", goal: "针对一条慢 SQL 给出优化建议，含索引与执行计划思路" },
  { industry: "生活", goal: "规划一个适合带娃的周末家庭出游计划，兼顾好玩与休息" },
  { industry: "生活", goal: "为减脂期设计一日三餐食谱，标注热量与备餐要点" },
  { industry: "生活", goal: "写一份搬家收拾物品清单与流程，按房间与优先级排序" },
];

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

async function callLLM(provider: string, model: string, apiKey: string, system: string, user: string, temperature = 0.7): Promise<string> {
  const r = await chatStream({ provider, model, apiKey, system, user, temperature, maxRetries: 2 });
  return r.text || "";
}

// —— 条件 A：两阶段（F1 骨架 → F2 实例化）——
async function produceTwoStage(s: Scenario): Promise<string> {
  if (DRY) return `【两阶段·${s.industry}】角色：专家\n目标：${s.goal}\n输出：结构化步骤与自检清单。`;

  let retrieved = "";
  if (WITH_RAG) {
    const { retrieve } = await import("../src/rag.js");
    const r = await retrieve(s.industry, s.goal, 4);
    retrieved = r.context || "";
  }
  const draftSys = getPrompt("draft").replace("{{retrieved}}", retrieved).replace("{{critique}}", "");
  const draftUser = `行业倾向：${s.industry}\n需求：${s.goal}`;
  const raw = extractJson(await callLLM(PROVIDER!, MODEL!, API_KEY!, draftSys, draftUser));
  if (!raw || !raw.prompt) throw new Error("F1 未返回可用模板");

  const useSys =
    getPrompt("use") +
    `\n\n【模板专长】\n标题：${raw.title || ""}\n行业：${raw.industry || s.industry}\n定位：${raw.summary || ""}\n标签：${(raw.tags || []).join("、")}\n` +
    `\n【模板结构骨架】\n${raw.prompt}`;
  return callLLM(PROVIDER!, MODEL!, API_KEY!, useSys, s.goal);
}

// —— 条件 B：单次直出（对照）——
const DIRECT_SYS =
  `你是一名顶尖的「提示词工程师」。用户会给出自己的目标，请你直接写出一条【具体、可直接复制粘贴进任意 AI 助手使用】的成品提示词。` +
  `要求：角色设定清晰、上下文/背景明确、任务与约束具体、输出格式结构化；只输出最终提示词正文，不要解释、不要 markdown 围栏。`;

async function produceDirect(s: Scenario): Promise<string> {
  if (DRY) return `【直出·${s.industry}】请扮演专家完成：${s.goal}`;
  return callLLM(PROVIDER!, MODEL!, API_KEY!, DIRECT_SYS, `行业：${s.industry}\n目标：${s.goal}`);
}

const JUDGE_SYS =
  `你是严格的对比评测裁判。用户给定「目标」，并给出两条成品提示词（方案甲 / 方案乙）。` +
  `请综合判断哪一条更能帮用户达成目标：相关性、结构完整度、可直接使用性、具体不空洞。` +
  `不要因为长度更长就给高分。只输出 JSON，不要解释、不要 markdown 围栏：\n` +
  `{"winner":"甲"|"乙"|"平","reason":"一句话理由"}`;

async function judgeOne(j: JudgeCfg, s: Scenario, x: string, y: string): Promise<Verdict> {
  if (DRY) {
    // 离线桩：确定性地让「两阶段」赢 70%，用于验证随机化/统计/报告链路。
    let h = 0;
    for (const ch of x + y + s.goal) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const aIsX = x.includes("两阶段");
    const aWins = h % 10 < 7;
    if (aIsX === aWins) return { winner: "X", reason: "dry-run" };
    return { winner: "Y", reason: "dry-run" };
  }

  const user = `目标（${s.industry}）：${s.goal}\n\n=== 方案甲 ===\n${x}\n\n=== 方案乙 ===\n${y}`;
  let obj = extractJson(await callLLM(j.provider, j.model, j.apiKey, JUDGE_SYS, user, 0));
  if (!obj || !obj.winner) {
    obj = extractJson(await callLLM(
      j.provider, j.model, j.apiKey,
      JUDGE_SYS + "\n\n【重申】只输出纯 JSON，否则判为无效。",
      user, 0,
    ));
  }
  if (!obj || !obj.winner) throw new Error(`${j.label} 裁判输出无法解析`);
  const w = String(obj.winner);
  const winner: Verdict["winner"] = w === "甲" || w === "X" ? "X" : w === "乙" || w === "Y" ? "Y" : "tie";
  return { winner, reason: typeof obj.reason === "string" ? obj.reason : "" };
}

// 裁判团：多裁判取多数票；无多数则记平局。
async function judgePanel(s: Scenario, x: string, y: string): Promise<Verdict> {
  const panel = judges();
  if (!panel.length) throw new Error("没有可用的裁判模型（检查 EVAL_JUDGE_MODELS / Key）");
  const verdicts = await Promise.all(panel.map((j) => judgeOne(j, s, x, y)));
  const xw = verdicts.filter((v) => v.winner === "X").length;
  const yw = verdicts.filter((v) => v.winner === "Y").length;
  const tie = verdicts.length - xw - yw;
  const winner: Verdict["winner"] = xw > yw && xw > tie ? "X" : yw > xw && yw > tie ? "Y" : "tie";
  const reason = verdicts.map((v) => `${v.winner}:${v.reason}`).join(" | ");
  return { winner, reason };
}

function verdictText(rep: Awaited<ReturnType<typeof runPairwiseEval>>): string {
  if (!Number.isFinite(rep.winRateA)) return "无有效比较，无法判断。";
  const significant = rep.pValue < 0.05 && (rep.winRateCI.lo > 0.5 || rep.winRateCI.hi < 0.5);
  if (!significant) return "**未观察到统计显著差异**：当前样本下不能宣称两阶段更优。";
  return rep.winRateA > 0.5
    ? "**两阶段（A）显著优于单次直出（B）**。"
    : "**单次直出（B）显著优于两阶段（A）**：需要反思两阶段是否过度设计。";
}

async function main() {
  const all = splitScenarios(SCENARIOS, SPLIT);
  const panel = judges();
  if (!all.length) {
    console.error(`✗ 划分 ${SPLIT} 后没有场景，请检查 EVAL_SPLIT。`);
    process.exit(1);
  }

  console.log(`▶ 评测开始：${all.length} 个场景 × ${REPEATS} 次重复；裁判 ${panel.length} 个；RAG=${WITH_RAG ? "on" : "off"}；split=${SPLIT}${DRY ? "（DRY RUN）" : ""}`);

  const rep = await runPairwiseEval(
    all,
    { produce: (c, s) => (c === "A" ? produceTwoStage(s) : produceDirect(s)), judge: judgePanel },
    {
      repeats: REPEATS,
      seed: SEED,
      onProgress: (done, total, msg) => console.log(`  [${done}/${total}] ${msg}`),
    },
  );

  const meta = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY,
    evalModel: DRY ? "dry-run" : `${PROVIDER}/${MODEL}`,
    judges: panel.map((j) => j.label),
    repeats: REPEATS,
    split: SPLIT,
    withRag: WITH_RAG,
    seed: SEED,
    scenarios: all.length,
  };

  const rows = rep.perScenario.map((p, i) => {
    const label = p.majority === "A" ? "两阶段" : p.majority === "B" ? "直出" : p.majority === "tie" ? "平" : "无效";
    return `| ${i + 1} | ${p.scenario.industry} | ${p.scenario.goal.slice(0, 22)}… | ${p.aWins} | ${p.bWins} | ${p.ties} | ${p.invalid} | ${label} |`;
  }).join("\n");

  const md = `# F1→F2 vs 单次直出：盲测成对评测报告

> 生成时间：${meta.generatedAt}${DRY ? "（DRY RUN：数据为桩，仅验证流程）" : ""}
> 被测模型：${meta.evalModel}
> 裁判：${meta.judges.join("、") || "（无）"}
> 场景：${meta.scenarios} 条（split=${meta.split}）× 重复 ${meta.repeats} 次
> 两阶段链路 RAG：${meta.withRag ? "开启" : "关闭（默认）"}
> 随机种子：${meta.seed}

## 方法

- **盲测**：裁判只看到「方案甲 / 方案乙」，不知道哪条来自实验组；每次重复重新随机左右顺序。
- **多裁判**：${meta.judges.length} 个裁判独立投票，取多数；无多数记平局。
- **统计口径**：排除平局后的胜率，bootstrap 95% 置信区间；配对符号检验（H₀: 胜率 = 0.5）。
- **可复现**：同 seed 下顺序与区间可复现。

## 结果

| 指标 | 值 |
|---|---|
| 有效比较 | ${rep.aWins + rep.bWins + rep.ties} / ${rep.nComparisons} |
| 两阶段（A）胜 | ${rep.aWins} |
| 单次直出（B）胜 | ${rep.bWins} |
| 平局 | ${rep.ties} |
| 无效（生成/裁判失败） | ${rep.invalid} |
| A 胜率（排除平局） | ${fmt(rep.winRateA)} |
| 胜率 95% CI | ${fmtCI(rep.winRateCI)} |
| 符号检验 p 值 | ${fmt(rep.pValue, 4)} |
| 平均分差（A=+1/B=-1） | ${fmt(rep.meanScore)} |

**结论：** ${verdictText(rep)}

## 逐场景

| # | 行业 | 目标 | A胜 | B胜 | 平 | 无效 | 多数结论 |
|---|---|---|---|---|---|---|---|
${rows}

## 解释边界（必须一起读）

- 裁判本身是 LLM，存在模型偏好；本报告只能说明「在该裁判/该模型/该场景集下」的相对表现。
- 默认链路**不含 RAG**；如需验证检索增益，请设 \`EVAL_WITH_RAG=1\` 单独跑一次，不要与默认结果混为一谈。
- 33 条场景是小样本。置信区间与 p 值已给出；若区间跨 0.5，不应宣称优劣。
- 该评测衡量「成品提示词的质量」，不等价于终端用户任务成功率；后者需要人工或任务级指标。
`;

  fs.writeFileSync(OUT_MD, md, "utf8");
  fs.writeFileSync(OUT_JSON, JSON.stringify({ meta, report: rep }, null, 2) + "\n", "utf8");
  console.log("\n" + md);
  console.log(`\n报告已写入：\n  ${OUT_MD}\n  ${OUT_JSON}`);
}

main().catch((e) => {
  console.error("评测失败：", e);
  process.exit(1);
});
