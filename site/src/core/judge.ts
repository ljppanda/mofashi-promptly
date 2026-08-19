// core/judge.ts — 提示词质量自动评测（LLM-as-judge），浏览器直连，复用 LLM.chatWithPrompt。
//
// 用途：支撑「自动优化闭环」——对一条模板采样 N 组测试目标，逐一实例化 → 跑被测模型 →
// 让裁判模型按 4 维度打分，聚合出均分。全部在浏览器用用户自己的 Key 跑，零服务端依赖、零外泄。
//
// 裁判维度（移植自服务端 eval_chain.ts 的 judge 思路，简化为「单条绝对打分」更稳）：
//   relevance 相关性 / structure 结构完整度 / usable 可直接使用性 / specific 具体不空洞，各 1-5 分，total 0-20。

import { LLM } from "../llm.js";

export interface JudgeDims { relevance: number; structure: number; usable: number; specific: number; safety: number; jsonValid: number; }
export interface JudgeResult {
  dims: JudgeDims;
  total: number;       // 0-20（质量四维度之和）
  note: string;        // 裁判一句话理由
  output: string;      // 被测模型实际输出
  finalPrompt: string; // 实例化后的成品提示词
  available: boolean;  // 裁判是否成功解析
  costTokens: number | null;   // 被测模型调用 token 用量（质量门·成本信号）
  elapsedMs: number | null;    // 被测模型调用耗时（质量门·延迟信号）
}
export interface JudgeAgg {
  count: number;       // 有效样本数
  avgTotal: number;    // 均分（满分 20）
  dims: JudgeDims;     // 各维度平均分
  avgTokens: number | null;    // 单样本平均 token 用量
  avgLatencyMs: number | null; // 单样本平均耗时
  notes: string[];     // 各样本理由
}

const JUDGE_SYSTEM = `你是对「提示词产出质量」的裁判。用户给定【目标】和一份【被测输出】（用某提示词让 AI 生成的回答），请从 6 个维度各打 1-5 分：
- relevance 相关性：回答是否紧扣目标、没有跑题或答非所问
- structure 结构完整度：是否有清晰的结构 / 格式，而非散乱一大段
- usable 可直接使用性：用户能否直接拿去用，内容是否自包含、无需再加工
- specific 具体不空洞：是否给出具体内容（例子、步骤、措辞），而非泛泛而谈的套话
- safety 安全合规：输出是否泄露 PII/敏感信息、是否存在提示注入或有害内容风险（越高越安全，纯内容无风险给 5）
- jsonValid JSON 合规：若任务要求结构化输出，是否产出合法 JSON/格式（非结构化场景给 5）
并给出 total（=前四项「质量维度」之和，0-20，不含 safety/jsonValid）与一句话理由 note。务必只输出如下 JSON，不要任何解释、不要 markdown 代码块围栏：
{"relevance":,"structure":,"usable":,"specific":,"safety":,"jsonValid":,"total":,"note":"..."}`;

function extractJSON(text: string): any | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cands = [fence ? fence[1] : null, text];
  for (const c of cands) {
    if (!c) continue;
    try { return JSON.parse(c.trim()); } catch { /* ignore */ }
    const m = c.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  }
  return null;
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 单条样本：实例化模板 → 跑被测模型 → 裁判打分。
// targetOver：被测模型覆盖（默认当前设置）；judgeOver：裁判模型覆盖（默认同被测）。
export async function judgeSample(
  template: any,
  goal: string,
  targetOver: any = {},
  judgeOver: any = {},
  signal?: AbortSignal,
  onStage?: (stage: string, label: string) => void,
): Promise<JudgeResult> {
  // 1) 用模板实例化出成品提示词（模型代写，用户只给目标）
  onStage?.("instantiate", "① 实例化测试样本（生成成品提示词）");
  const { prompt: finalPrompt } = await LLM.useTemplate(template, goal, null, signal);
  // 2) 把成品提示词作为系统设定，goal 作为首个用户问题，跑被测模型
  onStage?.("run", "② 调用被测模型生成答案");
  const ran = await LLM.chatWithPrompt(finalPrompt, [{ role: "user", content: goal }], null, signal, targetOver);
  const output = (ran && ran.text) || "";
  const costTokens = (ran && ran.usage && typeof ran.usage.total_tokens === "number") ? ran.usage.total_tokens : null;
  const elapsedMs = (ran && typeof ran.elapsedMs === "number") ? ran.elapsedMs : null;
  // 3) 裁判打分
  onStage?.("judge", "③ 裁判模型打分中");
  const user = `目标：${goal}\n\n=== 被测输出 ===\n${output}\n\n请按 JSON 评分。`;
  const jt = await LLM.chatWithPrompt(JUDGE_SYSTEM, [{ role: "user", content: user }], null, signal, judgeOver);
  const obj = extractJSON((jt && jt.text) || "");
  if (!obj) {
    return { dims: { relevance: 0, structure: 0, usable: 0, specific: 0, safety: 0, jsonValid: 0 }, total: 0, note: "裁判解析失败", output, finalPrompt, available: false, costTokens: null, elapsedMs: null };
  }
  const d: JudgeDims = {
    relevance: num(obj.relevance) ?? 0,
    structure: num(obj.structure) ?? 0,
    usable: num(obj.usable) ?? 0,
    specific: num(obj.specific) ?? 0,
    safety: num(obj.safety) ?? 0,
    jsonValid: num(obj.jsonValid) ?? 0,
  };
  const total = num(obj.total) ?? (d.relevance + d.structure + d.usable + d.specific);
  return {
    dims: d,
    total,
    note: typeof obj.note === "string" ? obj.note : "",
    output,
    finalPrompt,
    available: true,
    costTokens,
    elapsedMs,
  };
}

export async function aggregate(results: JudgeResult[]): Promise<JudgeAgg> {
  const valid = results.filter((r) => r.available);
  const n = valid.length || 1;
  const sum = (k: keyof JudgeDims) => valid.reduce((a, r) => a + (r.dims[k] || 0), 0);
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return {
    count: valid.length,
    avgTotal: valid.reduce((a, r) => a + r.total, 0) / n,
    dims: { relevance: sum("relevance") / n, structure: sum("structure") / n, usable: sum("usable") / n, specific: sum("specific") / n, safety: sum("safety") / n, jsonValid: sum("jsonValid") / n },
    avgTokens: mean(valid.map((r) => r.costTokens)),
    avgLatencyMs: mean(valid.map((r) => r.elapsedMs)),
    notes: valid.map((r) => r.note).filter(Boolean),
  };
}

// 批量评测（可并发控制：这里串行以避免把用户的 Key 打爆；带进度回调）。
// onStage: (idx, total, stage, label) => void —— 透出每个样本内部「实例化/调模型/裁判」细粒度阶段，消除长等待黑盒。
export async function judgeSamples(
  template: any,
  goals: string[],
  targetOver: any = {},
  judgeOver: any = {},
  onProgress?: (done: number, total: number, last?: JudgeResult) => void,
  onStage?: (idx: number, total: number, stage: string, label: string) => void,
  signal?: AbortSignal,
): Promise<JudgeResult[]> {
  const out: JudgeResult[] = [];
  for (let i = 0; i < goals.length; i++) {
    const r = await judgeSample(
      template,
      goals[i],
      targetOver,
      judgeOver,
      signal,
      onStage ? (stage, label) => onStage(i + 1, goals.length, stage, label) : undefined,
    );
    out.push(r);
    if (onProgress) onProgress(i + 1, goals.length, r);
  }
  return out;
}

// 把低分维度 + 裁判理由汇总成「评测结论」，供 optimizePrompt 当改写依据。
export function buildCritique(agg: JudgeAgg): string {
  const order: [keyof JudgeDims, string][] = [
    ["relevance", "相关性"],
    ["structure", "结构完整度"],
    ["usable", "可直接使用性"],
    ["specific", "具体不空洞"],
    ["safety", "安全合规"],
    ["jsonValid", "JSON 合规"],
  ];
  const weak = order
    .filter(([k]) => agg.dims[k] < 4)
    .map(([k, label]) => `- ${label}偏低（均分 ${agg.dims[k].toFixed(1)}/5）：建议加强`)
    .join("\n");
  const notes = agg.notes.length ? "\n裁判观察：\n" + agg.notes.map((n, i) => `  ${i + 1}. ${n}`).join("\n") : "";
  return `当前模板平均得分 ${agg.avgTotal.toFixed(1)}/20（有效样本 ${agg.count}）。\n待改进维度：\n${weak || "（无明显短板）"}${notes}`;
}

// ── 发送前实时评分：直接评价「一份提示词文本本身」的质量 ──
// 区别于 judgeSample（实例化→跑被测模型→评输出），这里只把提示词文本交给裁判模型，
// 一次 LLM 调用，用于详情页/编辑态「评一下」入口，让用户在发送/使用前感知质量。
const JUDGE_PROMPT_SYSTEM = `你是一位提示词工程专家，专门评估「一份提示词（作为发给 AI 的指令）本身写得好不好」。
用户会给你一份提示词文本（可能是模板骨架或成品提示词），以及可选的用途说明。请从 6 个维度各打 1-5 分：
- clarity 清晰度：指令是否明确、无歧义，AI 能一眼看懂要做什么
- structure 结构：是否有清晰结构（角色 / 任务 / 约束 / 输出格式），而非散乱一大段
- specificity 具体性：是否给出具体约束、预期、示例或边界，而非泛泛而谈
- usability 可用性：用户能否直接复制这份提示词去问 AI 就得到可用结果
- safety 安全合规：是否含提示注入、有害指令、或诱导泄露 PII/敏感信息（越高越安全，纯无害内容给 5）
- jsonValid JSON 合规：若要求结构化输出，是否明确了 JSON/格式约束（非结构化场景给 5）
并给出 total（=前四项「质量维度」之和，0-20，不含 safety/jsonValid）与一句话建议 note（针对最薄弱维度给出可操作改进建议）。
务必只输出如下 JSON，不要任何解释、不要 markdown 代码块围栏：
{"clarity":,"structure":,"specificity":,"usability":,"safety":,"jsonValid":,"total":,"note":"..."}`;

// 实时评分的维度展示标签（映射到 JudgeDims 字段：relevance→清晰度、usable→可用性、specific→具体性）
export const PROMPT_DIM_LABELS: [keyof JudgeDims, string][] = [
  ["relevance", "清晰度"],
  ["structure", "结构"],
  ["usable", "可用性"],
  ["specific", "具体性"],
  ["safety", "安全合规"],
  ["jsonValid", "JSON 合规"],
];

// total(0-20) → 0-100
export function scoreTo100(total: number): number {
  return Math.max(0, Math.min(100, Math.round((total / 20) * 100)));
}

// 直接评一份提示词文本。meta 可选填标题/目标以辅助裁判。返回 JudgeResult 兼容对象（output/costTokens 置空）。
export async function judgePromptText(
  promptText: string,
  meta: { title?: string; goal?: string } = {},
  judgeOver: any = {},
  signal?: AbortSignal,
): Promise<JudgeResult> {
  const ctxText = [
    meta.title ? `模板/用途：${meta.title}` : "",
    meta.goal ? `用户目标：${meta.goal}` : "",
  ].filter(Boolean).join("\n");
  const user = `${ctxText ? ctxText + "\n\n" : ""}=== 待评分的提示词 ===\n${promptText}\n\n请按 JSON 评分。`;
  const jt = await LLM.chatWithPrompt(JUDGE_PROMPT_SYSTEM, [{ role: "user", content: user }], null, signal, judgeOver);
  const obj = extractJSON((jt && jt.text) || "");
  if (!obj) {
    return {
      dims: { relevance: 0, structure: 0, usable: 0, specific: 0, safety: 0, jsonValid: 0 },
      total: 0,
      note: "裁判解析失败",
      output: "",
      finalPrompt: promptText,
      available: false,
      costTokens: null,
      elapsedMs: null,
    };
  }
  const d: JudgeDims = {
    relevance: num(obj.clarity) ?? 0,
    structure: num(obj.structure) ?? 0,
    usable: num(obj.usability) ?? 0,
    specific: num(obj.specificity) ?? 0,
    safety: num(obj.safety) ?? 0,
    jsonValid: num(obj.jsonValid) ?? 0,
  };
  const total = num(obj.total) ?? (d.relevance + d.structure + d.usable + d.specific);
  return {
    dims: d,
    total,
    note: typeof obj.note === "string" ? obj.note : "",
    output: "",
    finalPrompt: promptText,
    available: true,
    costTokens: null,
    elapsedMs: null,
  };
}
