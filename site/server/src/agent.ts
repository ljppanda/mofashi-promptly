// agent.ts
// 模板架构师 Agent（M2：LangGraph 状态图）。
// 状态图：clarify → retrieve → draft → validate →（不通过则带 critique 回流 draft）→ finalize。
// 对外契约保持：runAgent(input, events, signal) + 输出模板结构与前端口径一致（title/industry/task/summary/variables/prompt）。

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { chatStream, providerOf, chatWithTools, type Usage } from "./providers.js";
import { retrieve, retrieveToolSpec, type RagRef, type RagResult } from "./rag.js";
import { withTrace, lsEnd } from "./langsmith.js";

export interface AgentInput {
  provider: string;
  model: string;
  apiKey: string;
  apiSecret?: string;
  industry: string;
  sentence: string;
  proxyBase?: string;
  lsParentRunId?: string | null;
}

export interface TemplateDraft {
  title: string;
  industry: string;
  task: string;
  summary: string;
  tags: string[];
  variables: Array<{
    name: string;
    label: string;
    type: "text" | "textarea" | "select" | "multiselect";
    options?: string[];
    required?: boolean;
    placeholder?: string;
  }>;
  prompt: string;
  sources?: RagRef[]; // 生成时 RAG 召回的参考范例（前端展示“依据”）
}

export interface AgentEvents {
  onNode?: (name: string) => void;
  onToken?: (text: string) => void;
  onContext?: (refs: RagRef[]) => void; // RAG 召回的参考范例清单
  onThink?: (text: string) => void; // 模型“思考/产物”文本（如自审意见），前端实时展示
  onResult?: (tpl: TemplateDraft) => void;
  onUsage?: (u: Usage) => void;
  onError?: (msg: string) => void;
}

const MAX_ITER = 2; // 最多 2 轮起草（第 1 轮 + 第 2 轮精炼）
const INDUSTRIES = ["法律", "医疗健康", "职场办公", "教育培训", "电商运营", "金融", "写作创作", "编程开发", "生活/个人效率", "其他"];

// ---------- 状态 ----------
interface AgentState {
  industry: string;
  sentence: string;
  clarification: string; // clarify 节点：结构化需求简述
  retrieved: string;     // retrieve 节点：few-shot 上下文
  retrievedRefs: RagRef[]; // RAG 召回的参考范例（前端“依据”）
  retrievedSnippet: Record<string, string>; // slug -> 截断片段
  draftText: string;     // draft 节点：模型原始输出
  draft: TemplateDraft | null;
  critique: string;      // validate 节点：不通过时的修订意见
  passes: boolean;
  iterations: number;
  finalTpl: TemplateDraft | null;
  error: string | null;
}

const GraphState = Annotation.Root({
  industry: Annotation<string>(),
  sentence: Annotation<string>(),
  clarification: Annotation<string>(),
  retrieved: Annotation<string>(),
  retrievedRefs: Annotation<RagRef[]>(),
  retrievedSnippet: Annotation<Record<string, string>>(),
  draftText: Annotation<string>(),
  draft: Annotation<TemplateDraft | null>(),
  critique: Annotation<string>(),
  passes: Annotation<boolean>(),
  iterations: Annotation<number>(),
  finalTpl: Annotation<TemplateDraft | null>(),
  error: Annotation<string | null>(),
});

// ---------- prompts ----------
const SYS_CLARIFY = `你是需求分析师。把用户一句模糊的「提示词模板需求」，提炼成一句结构化中文简述，明确【行业/场景】【交付物】【目标受众】【关键约束】。
只输出这一句，不要解释、不要换行。`;

const SYS_DRAFT = `你是一名资深的「提示词模板架构师」。
你的任务是把用户的需求，转化为一个结构完整、可直接填空、填完即高质量的提示词模板（框架）。模板不是「最终提示词」，而是「可复用的填空骨架」。

{{retrieved}}

{{critique}}

必须严格输出 JSON，结构如下：
{
  "title": "一句话模板名（中文，含动词，如：简历优化）",
  "industry": "行业（与用户需求最匹配的行业）",
  "task": "任务类型（如：写作辅助）",
  "summary": "一句中文说明这个模板解决什么",
  "tags": ["2-4 个中文标签"],
  "variables": [
    { "name": "英文变量名", "label": "中文填表标签", "type": "text|textarea|select|multiselect", "options": ["选项1","选项2"], "required": true, "placeholder": "示例提示" }
  ],
  "prompt": "模板正文，用 {{变量名}} 作占位；必须包含：角色（你是…）+ 上下文/背景 + 任务与约束 + 输出格式（步骤/表格/结构）。必要时给示例。"
}

要求：
- 只输出 JSON，不要任何解释、不要 markdown 代码块围栏。
- variables 里只放「用户特有、每次不同」的信息；通用结构写死在 prompt 里。
- prompt 用 \\n 表示换行，整体可被 JSON 正确解析。
- 变量 name 用蛇形英文，label 用大白话中文（普通用户也能懂）。
- 行业必须从以下选一：${INDUSTRIES.join("/")}。`;

// ---------- 工具 ----------
// 从模型文本里抽取第一个 JSON 对象（兼容 ```json 围栏、前后多余文本）
function parseJsonObject(text: string): any {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("模型未返回合法 JSON（未找到 {..}）");
  try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { throw new Error("模型未返回合法 JSON（已尝试去除围栏/截断）：" + String(err)); }
}

function extractJSON(text: string, industry: string): TemplateDraft {
  const obj = parseJsonObject(text);
  if (!obj.prompt || !obj.title) throw new Error("返回结构缺字段（title/prompt）");
  if (!Array.isArray(obj.variables)) obj.variables = [];
  if (!obj.tags) obj.tags = [];
  // 规范 industry
  if (!INDUSTRIES.includes(obj.industry)) obj.industry = INDUSTRIES.includes(industry) ? industry : "其他";
  return obj as TemplateDraft;
}

// 规则自审：结构四段齐 + {{var}} 都有定义 + 行业合法
function ruleValidate(draft: TemplateDraft | null, industry: string): { passes: boolean; critique: string } {
  if (!draft) return { passes: false, critique: "未能生成模板，请重试。" };
  const p = draft.prompt || "";
  const issues: string[] = [];
  if (!draft.title) issues.push("缺标题 title");
  if (!/你是|你是一名|作为|角色[:：]/.test(p)) issues.push("prompt 缺少明确的「角色」设定");
  if (!/(上下文|背景|场景)/.test(p)) issues.push("prompt 缺少「上下文/背景」");
  if (!/(任务|约束|要求|注意)/.test(p)) issues.push("prompt 缺少「任务与约束」");
  if (!/(输出格式|格式|结构|步骤|表格|用以下|请按)/.test(p)) issues.push("prompt 缺少「输出格式/结构」");
  // {{var}} 一致性
  const used = [...p.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  const defined = new Set((draft.variables || []).map((v) => v.name));
  const undef = [...new Set(used)].filter((n) => !defined.has(n));
  if (undef.length) issues.push(`prompt 中使用了未定义的变量：${undef.join(", ")}`);
  const unused = (draft.variables || []).filter((v) => !used.includes(v.name));
  if (unused.length) issues.push(`定义了但未在 prompt 中使用的变量：${unused.map((v) => v.name).join(", ")}`);
  if (!INDUSTRIES.includes(draft.industry)) issues.push(`行业「${draft.industry}」不在允许集合内`);
  if (issues.length === 0) return { passes: true, critique: "" };
  return { passes: false, critique: "请修订：" + issues.join("；") };
}

// ---------- 图构建 ----------
type NodeFn = (s: AgentState) => Promise<Partial<AgentState>>;

function buildGraph(input: AgentInput, events: AgentEvents, signal?: AbortSignal) {
  const clarify: NodeFn = async (s) => {
    events.onNode?.("clarify");
    const res = await chatStream({
      provider: input.provider, model: input.model, apiKey: input.apiKey, apiSecret: input.apiSecret,
      proxyBase: input.proxyBase,
      lsParentRunId: input.lsParentRunId,
      system: SYS_CLARIFY, user: `行业倾向：${s.industry}\n需求：${s.sentence}`, signal,
    });
    events.onUsage?.(res.usage);
    return { clarification: res.text.trim() };
  };

  // 检索：优先让 LLM 通过 retrieveTool 自主决策（openai 兼容系）；否则兜底直查，保证 context 永不空
  const SYS_RETRIEVE_TOOL =
    "你是模板架构师的检索决策助手。当用户起草提示词模板时，判断是否需要从模板库检索相似范例。" +
    "绝大多数情况都应检索以借鉴「角色 + 背景 + 任务 + 格式」四段式结构。若决定检索，调用 retrieve_examples 工具并传入用户需求。";
  async function runRetrieval(s: AgentState): Promise<RagResult> {
    const p = providerOf(input.provider);
    if (p.style !== "openai") return retrieve("", s.sentence, 4); // 非 openai 系无工具调用，直接兜底
    const r = await chatWithTools({
      provider: input.provider, model: input.model, apiKey: input.apiKey, apiSecret: input.apiSecret,
      proxyBase: input.proxyBase, lsParentRunId: input.lsParentRunId, signal,
      system: SYS_RETRIEVE_TOOL, user: `行业倾向：${s.industry}\n需求：${s.sentence}`,
      tools: [retrieveToolSpec()],
    });
    let q = s.sentence;
    if (r.toolCalls && r.toolCalls.length) {
      try { const a = JSON.parse(r.toolCalls[0].arguments || "{}"); if (a.query) q = a.query; } catch { /* 用原需求 */ }
    }
    return retrieve("", q, 4); // 模型调用工具或未调用，统一用检索结果填充
  }

  const draftNode: NodeFn = async (s) => {
    events.onNode?.("retrieve");
    let rag: RagResult;
    try {
      rag = await runRetrieval(s);
    } catch {
      rag = await retrieve("", s.sentence).catch(() => ({ context: "", refs: [], snippet: {} }));
    }
    events.onContext?.(rag.refs);
    events.onThink?.(`已从模板库检索到 ${rag.refs.length} 个相似范例，将借鉴其结构…`);

    events.onNode?.("draft");
    const sysUser = SYS_DRAFT
      .replace("{{retrieved}}", rag.context ? "下面是同行业的高质量结构范例（few-shot），请借鉴其「角色 + 上下文/背景 + 任务与约束 + 输出格式」四段式，但不要照抄：\n" + rag.context : "")
      .replace("{{critique}}", s.critique ? "上一版被自审打回，请重点修正以下意见：" + s.critique : "");
    const userMsg = `需求简述：${s.clarification || s.sentence}\n原始需求：${s.sentence}\n行业倾向：${s.industry}`;
    try {
      const res = await chatStream({
        provider: input.provider, model: input.model, apiKey: input.apiKey, apiSecret: input.apiSecret,
        proxyBase: input.proxyBase,
      lsParentRunId: input.lsParentRunId,
        system: sysUser, user: userMsg, onToken: events.onToken, signal,
      });
      events.onUsage?.(res.usage);
      const parsed = extractJSON(res.text, s.industry);
      return { draftText: res.text, draft: parsed, retrieved: rag.context, retrievedRefs: rag.refs, retrievedSnippet: rag.snippet };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), draftText: "", draft: null };
    }
  };

  const validate: NodeFn = async (s) => {
    events.onNode?.("validate");
    const iter = s.iterations + 1;
    const v = ruleValidate(s.draft, s.industry);
    events.onThink?.(v.passes ? "自审校验通过：角色 / 背景 / 任务 / 格式齐全 ✅" : "自审发现不足，需修正：" + (v.critique || "结构不完整"));
    return { iterations: iter, passes: v.passes, critique: v.critique };
  };

  const finalize: NodeFn = async (s) => {
    events.onNode?.("finalize");
    const tpl = s.draft;
    if (!tpl) return { finalTpl: null };
    // 规范 industry 与变量类型
    const norm: TemplateDraft = {
      ...tpl,
      industry: INDUSTRIES.includes(tpl.industry) ? tpl.industry : (INDUSTRIES.includes(s.industry) ? s.industry : "其他"),
      sources: s.retrievedRefs && s.retrievedRefs.length ? s.retrievedRefs : undefined,
      variables: (tpl.variables || []).map((v) => ({
        ...v,
        type: (["text", "textarea", "select", "multiselect"].includes(v.type) ? v.type : "text") as any,
      })),
    };
    return { finalTpl: norm };
  };

  const routeAfterValidate = (s: AgentState): "finalize" | "draftNode" =>
    s.passes || s.iterations >= MAX_ITER ? "finalize" : "draftNode";

  const graph = new StateGraph(GraphState)
    .addNode("clarify", clarify)
    .addNode("draftNode", draftNode)
    .addNode("validate", validate)
    .addNode("finalize", finalize)
    .addEdge(START, "clarify")
    .addEdge("clarify", "draftNode")
    .addEdge("draftNode", "validate")
    .addConditionalEdges("validate", routeAfterValidate, { finalize: "finalize", draftNode: "draftNode" })
    .addEdge("finalize", END);

  return graph.compile();
}

// 占位：extractJSON 用到的行业提示（保持与输入一致）
export async function runAgent(
  input: AgentInput,
  events: AgentEvents,
  signal?: AbortSignal,
): Promise<void> {
  events.onNode?.("meta");
  try {
    await withTrace("agent:generate", { industry: input.industry, sentence: input.sentence }, async (rootId) => {
      const app = await buildGraph({ ...input, lsParentRunId: rootId }, events, signal).invoke({
        industry: input.industry,
        sentence: input.sentence,
        clarification: "",
        retrieved: "",
        retrievedRefs: [],
        retrievedSnippet: {},
        draftText: "",
        draft: null,
        critique: "",
        passes: false,
        iterations: 0,
        finalTpl: null,
        error: null,
      } as AgentState);

      if (app.error) {
        events.onError?.(app.error);
        await lsEnd(rootId, { error: app.error });
        return;
      }
      if (app.finalTpl) {
        events.onResult?.(app.finalTpl);
        await lsEnd(rootId, { outputs: { title: app.finalTpl.title, industry: app.finalTpl.industry } });
      } else {
        const msg = "Agent 未能产出模板（finalTpl 为空）";
        events.onError?.(msg);
        await lsEnd(rootId, { error: msg });
      }
    });
  } catch (err) {
    events.onError?.(err instanceof Error ? err.message : String(err));
  }
}

// ---------- F2：用模板生成成品提示词（模型代写，用户只给目标）----------
// 设计转向：模板不再是"让用户填空的表单"，而是"可复用的专家提示词生成器"。
// 用户只提供一句话目标，模型在思考中动态把每个维度写成具体内容，产出可直接用的提示词。
export interface AgentUseInput {
  provider: string;
  model: string;
  apiKey: string;
  apiSecret?: string;
  proxyBase?: string;
  industry: string;
  template: {
    title: string;
    industry: string;
    summary: string;
    tags: string[];
    prompt: string;
    variables?: Array<{ name: string; label: string; type?: string; options?: string[] }>;
  };
  goal: string;
}

export interface AgentUseEvents {
  onNode?: (name: string) => void;
  onToken?: (text: string) => void;
  onContext?: (refs: RagRef[]) => void;
  onThink?: (text: string) => void;
  onResult?: (r: { prompt: string; sources: RagRef[] }) => void;
  onUsage?: (u: Usage) => void;
  onError?: (msg: string) => void;
}

const SYS_USE = `你是一名「提示词落地工程师」。用户选了一个提示词模板（一个可复用的"专家提示词生成器"），并给出自己的目标。你的任务是：基于该模板的专长与结构，写出一条【具体、可直接复制粘贴进任意 AI 助手】的成品提示词。

要求：
1. 严格遵循模板骨架的角色设定（"你是…"）与"上下文/背景 → 任务与约束 → 输出格式"的结构，但【不要把任何 {{占位}} 或"请填写"字样留给用户】。
2. 根据"用户目标"，由你（模型）动态写出每个维度下的具体内容：构造有代入感的情境、列出该问的关键点与具体问题、必要时给出示例与边界。用户不需要自己填任何东西——这是模型在思考过程中完成的。
3. 产出必须自包含、可直接使用；语气与模板定位一致（如法律顾问要专业、严谨、标注不确定性）。
4. 只输出最终提示词正文，不要任何解释、不要 markdown 代码块围栏、不要在开头写"以下是…"。`;

export async function runAgentUse(
  input: AgentUseInput,
  events: AgentUseEvents,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await withTrace("agent:use", { template: input.template.title, goal: input.goal }, async (rootId) => {
      // ① 检索范例：让模型代写有依据
      events.onNode?.("retrieve");
      const rag = await retrieve(input.industry, input.goal || input.template.title);
      events.onContext?.(rag.refs);
      events.onThink?.(`已检索到 ${rag.refs.length} 个范例作为参考，将借鉴其写法…`);

      // ② 撰写：模板骨架 + 用户目标 -> 成品提示词（模型代写全部具体内容）
      events.onNode?.("draft");
      const dims = (input.template.variables || [])
        .map((v) => "- " + v.label + (v.options && v.options.length ? `（可覆盖维度：${v.options.join("、")}）` : ""))
        .join("\n");
      const sys =
        SYS_USE +
        `\n\n【模板专长】\n标题：${input.template.title}\n行业：${input.template.industry}\n定位：${input.template.summary}\n标签：${(input.template.tags || []).join("、")}\n` +
        `\n【模板结构骨架（沿用其角色与四段式，把 {{占位}} 换成真实内容）】\n${input.template.prompt}\n` +
        (dims ? `\n【该模板要覆盖的维度（由你动态写具体）】\n${dims}\n` : "") +
        (rag.context ? `\n【参考范例（借鉴写法，不要照抄）】\n${rag.context}\n` : "");
      const userMsg = `用户目标：${input.goal}\n\n请基于以上模板，写出可直接使用的成品提示词。`;
      const res = await chatStream({
        provider: input.provider,
        model: input.model,
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        proxyBase: input.proxyBase,
        lsParentRunId: rootId,
        system: sys,
        user: userMsg,
        onToken: events.onToken,
        signal,
      });
      events.onUsage?.(res.usage);

      // ③ 定稿
      events.onNode?.("finalize");
      const prompt = (res.text || "").trim();
      if (!prompt) {
        const msg = "模型未返回提示词正文";
        events.onError?.(msg);
        await lsEnd(rootId, { error: msg });
        return;
      }
      events.onResult?.({ prompt, sources: rag.refs });
      await lsEnd(rootId, { outputs: { promptLength: prompt.length } });
    });
  } catch (err) {
    events.onError?.(err instanceof Error ? err.message : String(err));
  }
}

// ---------- F3：交互式访谈澄清（模型反问、用户点选确认，直到信息完整）----------
// 设计：一句话目标往往说不清。模型站在模板专长角度，主动追问最关键缺失的维度，
// 每个问题给 2-4 个贴合领域的选项让用户点选（也允许自由补充），多轮直到信息足够，
// 再把"目标 + 已确认问答"交给 runAgentUse 代写成品提示词。追问由模型动态生成，
// 不是模板固定字段——与"模板不该让用户手填"的初衷一致。
const SYS_CLARIFY_INTERVIEW = `你是一个「提示词需求访谈助手」。用户选了一个提示词模板（一个可复用的专家提示词生成器），并给出自己的目标。你的任务：判断要写出高质量、具体的成品提示词还缺哪些关键信息，并【像专家顾问一样主动追问】，让用户通过「点选选项」即可确认。

访谈原则：
- 站在模板的专长角度思考：要产出好提示词，最该搞清的是受众/对象、输出形式、语气风格、关键约束/边界、是否有示例或素材。
- 每次最多提 3 个问题；每个问题给 2-4 个贴合该领域的具体选项（用户可直接点选）；同时允许自由补充文字。
- 不要问历史里已经回答过的问题；不要问废话（如"还有什么要补充的吗"）。
- 只有当信息已足够写出具体提示词时，才返回 complete:true，并给出整合了所有回答的 enrichedGoal（一句话清晰 brief，包含受众、形式、约束等关键决策）。

只输出 JSON，不要任何解释、不要 markdown 围栏：
{"complete": false, "questions":[{"id":"q1","question":"问题（中文）","options":["选项1","选项2","选项3"]}]}
或
{"complete": true, "enrichedGoal":"整合后的目标描述"}`;

export interface ClarifyQuestion {
  id: string;
  question: string;
  options: string[];
}
export interface AgentClarifyInput {
  provider: string;
  model: string;
  apiKey: string;
  apiSecret?: string;
  proxyBase?: string;
  industry: string;
  template: {
    title: string;
    industry: string;
    summary: string;
    tags: string[];
    prompt: string;
    variables?: Array<{ name: string; label: string; type?: string; options?: string[] }>;
  };
  goal: string;
  history: Array<{ question: string; answer: string }>;
}
export interface AgentClarifyResult {
  complete: boolean;
  questions?: ClarifyQuestion[];
  enrichedGoal?: string;
  note?: string;
}

// 把"原始目标 + 已确认问答"拼成一份完整 brief（模型不可用时的兜底整合）
function buildEnriched(goal: string, history: Array<{ question: string; answer: string }>): string {
  const parts = [goal];
  if (history && history.length) {
    parts.push("用户确认的关键信息：" + history.map((h, i) => `${i + 1}) ${h.question} → ${h.answer}`).join("；"));
  }
  return parts.join("\n");
}

// 模型 JSON 解析失败 / 无 Key 时的兜底追问（不依赖模型，保证访谈体验可用）
function fallbackQuestions(tpl: { industry?: string }): ClarifyQuestion[] {
  const ind = (tpl && tpl.industry) || "通用";
  return [
    { id: "f1", question: "这条提示词主要给谁用 / 面向什么对象？", options: ["我自己直接使用", "给团队或同事", "面向客户或外部用户", "面向不熟悉该领域的新手"] },
    { id: "f2", question: "你希望最终产出是什么形式？", options: ["一段可直接发的文字", "结构化的清单或步骤", "带示例的完整方案", "可复用的模板或框架"] },
    { id: "f3", question: "语气风格更偏哪种？", options: ["专业严谨", "通俗易懂、友好", "简洁高效", "有创意、有感染力"] },
  ].map((q, i) => ({ ...q, id: "f" + (i + 1) }));
}

// 访谈澄清阶段的前端可观察事件（思考过程流式展示）
export interface AgentClarifyEvents {
  onNode?: (name: string) => void;
  onThink?: (text: string) => void;
  onResult?: (r: AgentClarifyResult) => void;
  onError?: (msg: string) => void;
}

// 单轮访谈：返回"还需追问"或"已完成"。无 Key / JSON 异常时降级（首轮给兜底问题，后续按已有信息继续）。
// 通过 events 把"模型在想什么"流式推给前端，避免访谈阶段黑屏卡顿。
export async function runAgentClarify(input: AgentClarifyInput, events?: AgentClarifyEvents, signal?: AbortSignal): Promise<AgentClarifyResult> {
  const historyText = (input.history || []).map((h, i) => `${i + 1}. ${h.question}\n   用户回答：${h.answer}`).join("\n");
  const sys = SYS_CLARIFY_INTERVIEW
    + `\n\n【模板专长】\n标题：${input.template.title}\n行业：${input.template.industry}\n定位：${input.template.summary}\n标签：${(input.template.tags || []).join("、")}\n`
    + `\n【模板结构骨架】\n${input.template.prompt}`;
  const userMsg = `用户原始目标：${input.goal}\n\n已确认的问答历史：\n${historyText || "（无）"}\n\n请判断信息是否足够，并给出下一轮追问或判定完成（只输出 JSON）。`;

  events?.onNode?.("clarify");
  events?.onThink?.("🔍 正在分析你的目标，并结合模板定位，识别还缺哪些关键信息（受众 / 形式 / 约束 / 语气等）…");

  return withTrace("agent:clarify", { template: input.template.title, goal: input.goal, historyLen: (input.history || []).length }, async (rootId) => {
    try {
      const res = await chatStream({
        provider: input.provider, model: input.model, apiKey: input.apiKey, apiSecret: input.apiSecret,
        proxyBase: input.proxyBase,
        lsParentRunId: rootId,
        system: sys, user: userMsg, signal,
      });
      const obj = parseJsonObject(res.text);
      if (obj.complete === true) {
        const enriched = (obj.enrichedGoal && String(obj.enrichedGoal).trim()) || buildEnriched(input.goal, input.history);
        events?.onThink?.("✅ 信息已足够，正在整合为你写提示词所需的完整需求…");
        const r: AgentClarifyResult = { complete: true, enrichedGoal: enriched };
        events?.onResult?.(r);
        await lsEnd(rootId, { outputs: { complete: true } });
        return r;
      }
      const qs: ClarifyQuestion[] = Array.isArray(obj.questions)
        ? obj.questions
            .slice(0, 3)
            .map((q: any, i: number) => ({
              id: "q" + (input.history.length + 1) + "_" + i,
              question: String(q.question || "").slice(0, 200),
              options: Array.isArray(q.options)
                ? q.options.slice(0, 4).map((o: any) => String(o)).filter(Boolean)
                : [],
            }))
            .filter((q: ClarifyQuestion) => q.question && q.options.length)
        : [];
      if (qs.length) {
        events?.onThink?.(`🧩 已识别出 ${qs.length} 个待确认的关键点：${qs.map((q) => q.question).join("、")} —— 正在生成可点选的选项…`);
        const r: AgentClarifyResult = { complete: false, questions: qs };
        events?.onResult?.(r);
        await lsEnd(rootId, { outputs: { complete: false, questionCount: qs.length } });
        return r;
      }
      // 模型说没完成但没给新问题 -> 视为完成，按已有信息继续
      events?.onThink?.("ℹ️ 未给出新的追问，按已有信息继续生成…");
      const r: AgentClarifyResult = { complete: true, enrichedGoal: buildEnriched(input.goal, input.history), note: "模型未给出新问题，按已有信息继续" };
      events?.onResult?.(r);
      await lsEnd(rootId, { outputs: { complete: true, note: r.note } });
      return r;
    } catch (err) {
      // 无 Key / 网络 / 解析失败：首轮给兜底问题（点选即可），有历史则直接判定完成
      const reason = String((err as any)?.message || err);
      await lsEnd(rootId, { error: reason });
      events?.onError?.(reason);
      if (!input.history || !input.history.length) {
        events?.onThink?.("🤖 未接入模型（缺 Key / 无网络），改用内置推荐追问，点选即可…");
        const r: AgentClarifyResult = { complete: false, questions: fallbackQuestions(input.template), note: "已给出推荐追问，点选即可" };
        events?.onResult?.(r);
        return r;
      }
      const r: AgentClarifyResult = { complete: true, enrichedGoal: buildEnriched(input.goal, input.history), note: "已按已有信息继续" };
      events?.onResult?.(r);
      return r;
    }
  });
}

// ---------- F5：根据测试反馈动态改写提示词 ----------
// 设计：用户在测试沙盒里发现提示词不好用，描述问题（反馈）。我们结合「原提示词 + 反馈 + 实际测试对话」，
// 先让模型分析不足（思考流可见），再针对性改写，输出【完整新版提示词全文】供用户审阅后采用。
// 两阶段：① analyze（非流式，整段分析一次性展示）② rewrite（流式输出新版提示词）。
export interface AgentRefineInput {
  provider: string;
  model: string;
  apiKey: string;
  apiSecret?: string;
  proxyBase?: string;
  prompt: string;                 // 当前正在测试的提示词全文
  feedback: string;               // 用户不满意的点 / 希望改进的地方
  conversation?: Array<{ role: string; content: string }>; // 测试对话（可选，供模型理解实际表现）
}
export interface AgentRefineEvents {
  onNode?: (name: string) => void;
  onToken?: (text: string) => void;
  onThink?: (text: string) => void;
  onResult?: (r: { prompt: string }) => void;
  onUsage?: (u: Usage) => void;
  onError?: (msg: string) => void;
}

const SYS_REFINE_ANALYZE = `你是一名「提示词体检医生」。用户已经写了一条提示词，并在实际测试（把这条提示词当作系统设定去对话）中发现了不满意的地方。请结合【原提示词】【用户反馈】【实际测试对话】，指出原提示词具体的、可操作的不足，给出 3-6 条改写要点（每条一句话，说明"哪里不足 + 该怎么改"）。只输出要点列表，不要改写提示词本身。`;

const SYS_REFINE_REWRITE = `你是一名「提示词优化器」。根据用户指出的问题与改写要点，对提示词做【针对性改写】，输出改进后的【完整提示词全文】。

改写原则：
1. 保留原提示词中好的部分（角色设定、有用结构、有效约束），不要推倒重来。
2. 针对用户的每条反馈逐一改进：如"回答太啰嗦"就加强"只输出要点、避免铺垫"；"没按格式输出"就强化输出格式并给示例；"没抓住重点"就明确任务优先级与目标；"语气不对"就调整角色语气设定。
3. 改进要可操作、具体到措辞，而非空泛建议。
4. 只输出改进后的【完整提示词正文】，不要任何解释、不要 markdown 代码块围栏、不要在开头写"以下是…"。`;

function convToText(conv?: Array<{ role: string; content: string }>): string {
  if (!conv || !conv.length) return "";
  return conv.slice(-8).map((m) => `${m.role === "assistant" ? "提示词(模型)回答" : "用户"}：${m.content}`).join("\n\n");
}

export async function runAgentRefine(input: AgentRefineInput, events?: AgentRefineEvents, signal?: AbortSignal): Promise<string> {
  const conv = convToText(input.conversation);
  const baseUser =
    `【当前提示词全文】\n${input.prompt}\n\n【用户不满意的地方 / 希望改进的点】\n${input.feedback}` +
    (conv ? `\n\n【实际测试对话（模型按上面提示词作答，对照看看问题出在哪）】\n${conv}` : "");

  // ① 分析不足（非流式，整段一次性展示为思考）
  events?.onNode?.("analyze");
  events?.onThink?.("🧐 正在对照你的反馈与实际测试表现，定位原提示词的具体不足…");
  let analysis = "";
  try {
    const aRes = await chatStream({
      provider: input.provider, model: input.model, apiKey: input.apiKey, apiSecret: input.apiSecret,
      proxyBase: input.proxyBase, system: SYS_REFINE_ANALYZE, user: baseUser, signal,
    });
    events?.onUsage?.(aRes.usage);
    analysis = (aRes.text || "").trim();
    events?.onThink?.(analysis || "（未给出明确分析，直接进入改写）");
  } catch (err) {
    events?.onThink?.("⚠️ 分析阶段异常，直接进入改写：" + String((err as any)?.message || err));
  }

  // ② 改写提示词（流式输出新版全文）
  events?.onNode?.("rewrite");
  events?.onThink?.("✍️ 根据分析要点，正在改写提示词…");
  const sysRewrite = SYS_REFINE_REWRITE +
    (analysis ? `\n\n【改写要点（已分析得出，请逐条落实）】\n${analysis}` : "");
  const res = await chatStream({
    provider: input.provider, model: input.model, apiKey: input.apiKey, apiSecret: input.apiSecret,
    proxyBase: input.proxyBase, system: sysRewrite, user: baseUser + `\n\n请输出改写后的完整提示词全文。`, onToken: events?.onToken, signal,
  });
  events?.onUsage?.(res.usage);
  const prompt = (res.text || "").trim();
  if (!prompt) {
    const msg = "模型未返回改写后的提示词";
    events?.onError?.(msg);
    return "";
  }
  events?.onThink?.("✅ 已生成改写版提示词，请在下方审阅并决定是否采用。");
  events?.onResult?.({ prompt });
  return prompt;
}
