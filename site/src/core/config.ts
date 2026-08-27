// core/config.ts — 静态配置（Configuration/Registry 模式）：跨视图共享的常量集中于此。
export const ICON: Record<string, string> = {
  "法律": "⚖️", "医疗健康": "🩺", "职场办公": "💼", "教育培训": "🎓",
  "电商运营": "🛒", "金融": "💰", "写作创作": "✍️", "编程开发": "💻"
};

export const ALL_INDUSTRIES = [
  "法律", "医疗健康", "职场办公", "教育培训", "电商运营", "金融", "写作创作", "编程开发", "其他"
];

// F1 模板生成的五步状态机
export const GEN_STEPS_5 = [
  { k: "clarify", label: "① 澄清意图" },
  { k: "retrieve", label: "② 检索范例" },
  { k: "draft", label: "③ 起草模板" },
  { k: "validate", label: "④ 自审校验" },
  { k: "finalize", label: "⑤ 精炼产出" },
];

// F2 用模板生成提示词的四步状态机（含「自检优化」步，消除黑盒）
export const GEN_STEPS_3 = [
  { k: "retrieve", label: "① 检索范例" },
  { k: "draft", label: "② 撰写提示词" },
  { k: "selfcheck", label: "③ 自检优化" },
  { k: "finalize", label: "④ 精炼定稿" },
];

// F5 动态改写提示词的两步状态机
export const REFINE_STEPS = [
  { k: "analyze", label: "① 分析不足" },
  { k: "rewrite", label: "② 改写提示词" },
];

// 各步骤的实时提示文案
export const STEP_HINT: Record<string, string> = {
  clarify: "分析你的需求，判断还缺哪些关键信息；必要时会主动追问你确认",
  retrieve: "在模板库里做向量检索，找出语义最相似的范例作为参考",
  draft: "结合参考范例与你的需求，起草模板骨架、变量与约束",
  validate: "对照规则自审：角色 / 背景 / 任务 / 格式 四段是否齐全",
  selfcheck: "对照生产级清单审查草稿，补齐缺失的角色具体性 / 约束 / 工作流 / 输出规范 / 边界兜底，输出更可靠的版本",
  finalize: "精炼措辞、统一格式，输出最终成品提示词",
  analyze: "对照你的反馈与实际测试表现，定位原提示词的具体不足与改写方向",
  rewrite: "保留好的部分，针对反馈逐条改写，输出完整新版提示词",
};

// 交互式访谈（F3）最多追问轮数
export const MAX_CLARIFY_ROUNDS = 3;

// 跨模型对比的成本估算表（单位：USD / 1M tokens，取各厂商公开价目近似，以实际账单为准）
export const MODEL_PRICE: Record<string, { in: number; out: number }> = {
  openai:    { in: 2.5,  out: 10 },
  deepseek:  { in: 0.5,  out: 1.2 },
  moonshot:  { in: 0.8,  out: 2.4 },
  zhipu:     { in: 0.6,  out: 1.8 },
  qwen:      { in: 0.8,  out: 2.4 },
  doubao:    { in: 0.5,  out: 1.5 },
  hunyuan:   { in: 0.5,  out: 1.5 },
  baichuan:  { in: 0.6,  out: 1.8 },
  yi:        { in: 0.5,  out: 1.5 },
  grok:      { in: 3,    out: 15 },
  mistral:   { in: 2,    out: 6 },
  ollama:    { in: 0,    out: 0 },
  openrouter:{ in: 3,    out: 12 },
  groq:      { in: 0.5,  out: 1.5 },
  perplexity:{ in: 1,    out: 1 },
  together:  { in: 1.2,  out: 3.6 },
  claude:    { in: 3,    out: 15 },
  gemini:    { in: 1.2,  out: 4.8 },
  ernie:     { in: 0.5,  out: 1.5 },
};

// 按 provider 估算一次调用的成本（美元）；usage 为归一化结构 {inputTokens, outputTokens, ...}
export function estimateCost(provider: string, usage: any): number {
  const p = MODEL_PRICE[provider];
  if (!p) return 0;
  const inT = (usage && usage.inputTokens) || 0;
  const outT = (usage && usage.outputTokens) || 0;
  return (inT / 1_000_000) * p.in + (outT / 1_000_000) * p.out;
}
