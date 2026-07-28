// moderation.ts — 内容审核「子 agent」（LangGraph StateGraph 实现）
// 思路：把审核做成一个独立、可组合的子图（与生成主图解耦），体现 LangGraph 多子 agent 模式。
//  - 服务端配置 LLM（MODERATION_PROVIDER / MODEL / API_KEY）时走 AI 审核（结构化 JSON 判定）；
//  - 未配置或调用失败 → 关键词黑名单兜底（离线、零依赖）；
//  - MODERATION_DISABLED=1 可整体关闭（放行）。
// 这是之前 defer 的 P0-④ 内容安全的落地：在「发布/公开」闸门处拦截违规社区模板。

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { chatStream } from "./providers.js";

export interface ModerationResult {
  safe: boolean;
  categories: string[];
  reasons: string[];
  score: number; // 0~1 风险分
  engine: "llm" | "keyword" | "pass";
}

// 示例性敏感词（可按业务扩充）。命中即判不安全；列表刻意收敛以降低误杀。
const BLOCKLIST = [
  "制毒方法", "制作炸弹", "如何杀人", "自杀方法", "色情网站", "裸聊",
  "诈骗话术", "赌博平台", "洗钱方法", "身份证号", "银行卡号", "泄露隐私",
];

const ModState = Annotation.Root({
  text: Annotation<string>(),
  result: Annotation<ModerationResult | null>(),
  error: Annotation<string | null>(),
});

function keywordModerate(text: string): ModerationResult {
  const t = text || "";
  const hits = BLOCKLIST.filter((w) => t.includes(w));
  if (hits.length === 0) return { safe: true, categories: [], reasons: [], score: 0, engine: "keyword" };
  return {
    safe: false,
    categories: ["keyword-blocklist"],
    reasons: [`命中敏感词：${hits.join("、")}`],
    score: 0.9,
    engine: "keyword",
  };
}

function parseModeration(t: string): ModerationResult | null {
  try {
    const m = t.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : t);
    return {
      safe: j.safe === true || j.safe === "true",
      categories: Array.isArray(j.categories) ? j.categories.map(String) : [],
      reasons: Array.isArray(j.reasons) ? j.reasons.map(String) : [],
      score: typeof j.score === "number" ? j.score : j.safe ? 0 : 0.8,
      engine: "llm",
    };
  } catch {
    return null;
  }
}

async function moderateNode(state: { text: string }): Promise<{ result: ModerationResult; error: null }> {
  const text = state.text || "";
  const provider = process.env.MODERATION_PROVIDER;
  const apiKey = process.env.MODERATION_API_KEY;
  if (!provider || !apiKey) {
    return { result: keywordModerate(text), error: null }; // 无 LLM 配置 → 关键词兜底
  }
  const system =
    "你是内容安全审核员。判断给定文本（通常是用户要发布的提示词模板）是否包含违规内容。" +
    "违规类别包括但不限于：违法违规、暴力血腥、色情低俗、仇恨歧视、自残自杀、诈骗、侵犯隐私(泄露个人敏感信息)、政治敏感。" +
    "只输出严格 JSON：{\"safe\": boolean, \"categories\": string[], \"reasons\": string[], \"score\": number(0~1 风险分)}。" +
    "若安全则 safe=true、categories=[]、reasons=[]、score=0。";
  try {
    const r = await chatStream({
      provider,
      model: process.env.MODERATION_MODEL || "deepseek-chat",
      apiKey,
      apiSecret: process.env.MODERATION_API_SECRET,
      proxyBase: process.env.MODERATION_PROXY,
      system,
      user: `待审核文本：\n"""\n${text}\n"""`,
    });
    const parsed = parseModeration(r.text);
    if (parsed) return { result: parsed, error: null };
    const kw = keywordModerate(text); // LLM 结果解析失败 → 关键词复核
    return { result: { ...kw, reasons: [...kw.reasons, "LLM 审核结果解析失败，已按关键词规则复核"] }, error: null };
  } catch (e) {
    const kw = keywordModerate(text); // LLM 调用失败 → 关键词复核
    return { result: { ...kw, reasons: [...kw.reasons, `LLM 审核调用失败(${(e as Error)?.message})，已按关键词规则复核`] }, error: null };
  }
}

const modGraph = new StateGraph(ModState)
  .addNode("moderate", moderateNode)
  .addEdge(START, "moderate")
  .addEdge("moderate", END)
  .compile();

// 对外入口：审核一段文本。整体可关闭（MODERATION_DISABLED=1）。
export async function moderateContent(text: string): Promise<ModerationResult> {
  if (process.env.MODERATION_DISABLED === "1") {
    return { safe: true, categories: [], reasons: [], score: 0, engine: "pass" };
  }
  try {
    const res = await modGraph.invoke({ text: text || "", result: null, error: null });
    return res.result ?? keywordModerate(text || "");
  } catch {
    return keywordModerate(text || "");
  }
}
