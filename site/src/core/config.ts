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

// F2 用模板生成提示词的三步状态机
export const GEN_STEPS_3 = [
  { k: "retrieve", label: "① 检索范例" },
  { k: "draft", label: "② 撰写提示词" },
  { k: "finalize", label: "③ 精炼定稿" },
];

// F5 动态改写提示词的两步状态机
export const REFINE_STEPS = [
  { k: "analyze", label: "① 分析不足" },
  { k: "rewrite", label: "② 改写提示词" },
];

// 各步骤的实时提示文案
export const STEP_HINT: Record<string, string> = {
  clarify: "分析你的需求，判断还缺哪些关键信息；必要时会主动追问你确认",
  retrieve: "在模板库与社区广场里做向量检索，找出语义最相似的范例作为参考",
  draft: "结合参考范例与你的需求，起草模板骨架、变量与约束",
  validate: "对照规则自审：角色 / 背景 / 任务 / 格式 四段是否齐全",
  finalize: "精炼措辞、统一格式，输出最终成果",
  analyze: "对照你的反馈与实际测试表现，定位原提示词的具体不足与改写方向",
  rewrite: "保留好的部分，针对反馈逐条改写，输出完整新版提示词",
};

// 交互式访谈（F3）最多追问轮数
export const MAX_CLARIFY_ROUNDS = 3;
