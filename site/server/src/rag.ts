// rag.ts — M12/LlamaIndex：用 LlamaIndex 作为 RAG 框架，底层向量存储用 LanceDB（data/lancedb）持久化。
// 设计要点：
//  - 离线确定性中文向量化（字符 n-gram + 全库 IDF 加权 + L2 归一），不依赖任何外部 Embedding API / 网络，启动即用。
//  - 检索由 LlamaIndex 驱动：LocalZhEmbedding(extends BaseEmbedding) + LanceDBVectorStore(extends BaseVectorStore)
//    + VectorStoreIndex.fromVectorStore + asRetriever。LanceDB 是向量后端，LlamaIndex 是 RAG 抽象层——二者互补不互斥。
//  - retrieve 同时封装成一个 LangChain DynamicTool（retrieveTool），供 LangGraph 的 draft 节点以「工具调用」方式让 LLM 自主决定检索。
//  - 任何失败都优雅降级为「空上下文」，保证 Agent 主链路不挂。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as lancedb from "@lancedb/lancedb";
import {
  Settings,
  VectorStoreIndex,
  TextNode,
  MetadataMode,
  BaseEmbedding,
  BaseVectorStore,
  type BaseNode,
  type VectorStoreQuery,
  type VectorStoreQueryResult,
} from "llamaindex";
import { DynamicTool } from "@langchain/core/tools";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.resolve(__dirname, "..", "data", "templates.json");
const LANCE_DIR = path.resolve(__dirname, "..", "data", "lancedb");
const TABLE = "templates_vec_li";

export interface RagRef {
  slug: string;
  title: string;
  industry: string;
  source?: "seed" | "community"; // 来源：内置种子 / 社区
}
export interface RagResult {
  context: string; // 喂给 draft 节点的 few-shot 文本
  refs: RagRef[]; // 供前端展示“参考了哪些范例”
  snippet: Record<string, string>; // slug -> 截断后的 prompt 片段（前端卡片用）
}

// ---------- 自包含中文向量化（TF-IDF 加权 n-gram，离线）----------
const DIMS = 16384;

function ngrams(text: string): Set<string> {
  const clean = String(text || "").toLowerCase().replace(/\s+/g, " ");
  const chars = [...clean].filter((c) => /[\p{L}\p{N}]/u.test(c));
  const g = new Set<string>();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= chars.length; i++) g.add(chars.slice(i, i + n).join(""));
  }
  return g;
}
function hashDim(gram: string, dims: number): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < gram.length; i++) {
    h ^= gram.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % dims;
}

let IDF: Map<string, number> = new Map();
const DEFAULT_IDF = 1;
function embed(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  const grams = ngrams(text);
  for (const g of grams) {
    const w = IDF.get(g) ?? DEFAULT_IDF;
    v[hashDim(g, DIMS)] += w;
  }
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIMS; i++) v[i] /= norm;
  return v;
}

// 离线 embedding 模型（LlamaIndex BaseEmbedding 实现）
class LocalZhEmbedding extends BaseEmbedding {
  constructor() {
    super();
  }
  async getTextEmbedding(text: string): Promise<number[]> {
    return embed(text);
  }
}
const embedModel = new LocalZhEmbedding();
Settings.embedModel = embedModel;

// ---------- 可选：语义 embedding + 语义 reranker（transformers.js 本地 bge）----------
// 设计原则（保持「离线可用」为默认值）：
//  - 离线默认仍走词法嵌入（LocalZhEmbedding）；置 RAG_EMBEDDING=1 才启用本地语义向量（首次需联网下载模型）。
//  - 语义向量不写 LanceDB（避免改动既有 vector 列/表结构），改用内存索引，与词法腿做 RRF 混合召回。
//  - reranker 默认关闭（RAG_RERANKER=1 开启），开启失败时自动回退质量加权启发式。
//  - 用动态 import + @ts-ignore：未安装 @huggingface/transformers 时仍能编译/运行（自动回退词法）。
const SEMANTIC_ENABLED = process.env.RAG_EMBEDDING === "1" || process.env.RAG_EMBEDDING === "true";
const SEMANTIC_MODEL = process.env.RAG_EMBEDDING_MODEL || "Xenova/bge-base-zh-v1.5";
const RERANKER_ENABLED = process.env.RAG_RERANKER === "1" || process.env.RAG_RERANKER === "true";
const RERANKER_MODEL = process.env.RAG_RERANKER_MODEL || "Xenova/bge-reranker-v2-m3";

type SemMeta = { title: string; industry: string; prompt: string; quality: number; source: "seed" | "community" };

let _hf: any = null;
let _extractor: any = null;
let _reranker: any = null;
let semanticReady = false;
let rerankerReady = false;
let semanticIndex: Map<string, Float32Array> = new Map();
let corpusMeta: Map<string, SemMeta> = new Map();
let currentItems: CorpusItem[] = [];

async function loadTransformers(): Promise<any> {
  if (_hf) return _hf;
  // @ts-ignore 动态依赖：未安装时运行期抛错由调用方捕获并回退
  _hf = await import("@huggingface/transformers");
  return _hf;
}

async function ensureSemantic(): Promise<boolean> {
  if (!SEMANTIC_ENABLED || semanticReady) return semanticReady;
  try {
    const hf = await loadTransformers();
    _extractor = await hf.pipeline("feature-extraction", SEMANTIC_MODEL);
    semanticReady = true;
    console.log(`[rag] 语义 embedding 已加载：${SEMANTIC_MODEL}`);
  } catch (e) {
    console.error("[rag] 语义 embedding 加载失败，回退词法：", (e as Error)?.message);
    semanticReady = false;
  }
  return semanticReady;
}

async function semanticEmbed(text: string): Promise<number[] | null> {
  if (!semanticReady || !_extractor) return null;
  try {
    const out = await _extractor(text, { pooling: "cls", normalize: true });
    const arr = (out?.data ?? out) as ArrayLike<number>;
    return Array.from(arr);
  } catch {
    return null;
  }
}

async function ensureReranker(): Promise<boolean> {
  if (!RERANKER_ENABLED || rerankerReady) return rerankerReady;
  try {
    const hf = await loadTransformers();
    _reranker = await hf.pipeline("feature-extraction", RERANKER_MODEL);
    rerankerReady = true;
    console.log(`[rag] 语义 reranker 已加载：${RERANKER_MODEL}`);
  } catch (e) {
    console.error("[rag] reranker 加载失败，回退质量加权：", (e as Error)?.message);
    rerankerReady = false;
  }
  return rerankerReady;
}

// bge-reranker-v2-m3：以 query</s>passage 拼接取 CLS 位 logit 作为相关性分（失败时返回 {}）
async function rerankPairs(query: string, docs: { slug: string; text: string }[]): Promise<Record<string, number>> {
  if (!rerankerReady || !_reranker) return {};
  try {
    const scores: Record<string, number> = {};
    for (const d of docs) {
      const out = await _reranker(`${query}</s>${d.text}`, { pooling: "cls" });
      const arr = Array.from((out?.data ?? out) as ArrayLike<number>);
      scores[d.slug] = arr[0] ?? 0;
    }
    return scores;
  } catch {
    return {};
  }
}

function dotArr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// 构建语义内存索引 + 元数据表（语义腿可选；词法元数据始终构建，供 RRF 融合后取字段）
async function rebuildSemanticIndex(items: CorpusItem[]): Promise<void> {
  corpusMeta = new Map();
  semanticIndex = new Map();
  for (const c of items) {
    corpusMeta.set(c.slug, { title: c.title, industry: c.industry, prompt: c.prompt, quality: c.quality ?? 0, source: c.source ?? "seed" });
  }
  if (!SEMANTIC_ENABLED) return;
  const ok = await ensureSemantic();
  if (!ok) return;
  for (const c of items) {
    const v = await semanticEmbed(c.text);
    if (v) semanticIndex.set(c.slug, Float32Array.from(v));
  }
  console.log(`[rag] 语义索引已建：${semanticIndex.size} 条`);
}

// Reciprocal Rank Fusion：多路召回结果融合（k=60 为常用常数）
function rrf(lists: { slug: string; score: number }[][], k = 60): Map<string, number> {
  const m = new Map<string, number>();
  for (const list of lists) {
    list.forEach((it, idx) => {
      m.set(it.slug, (m.get(it.slug) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return m;
}

interface CorpusItem {
  slug: string;
  title: string;
  industry: string;
  task: string;
  text: string;
  prompt: string;
  source?: "seed" | "community";
  quality?: number; // 0~1 质量分：仅社区模板有（来自评分），内置种子为 0（中性）
}

// 检索语料 = 内置种子模板（个人本地工具，无社区发布内容）。
function loadCorpus(): CorpusItem[] {
  const raw = fs.readFileSync(CORPUS, "utf8");
  const seed = JSON.parse(raw) as CorpusItem[];
  const N = seed.length || 1;
  const df = new Map<string, number>();
  for (const c of seed) for (const g of ngrams(c.text)) df.set(g, (df.get(g) || 0) + 1);
  IDF = new Map();
  for (const [g, d] of df) IDF.set(g, Math.log((N + 1) / (d + 1)) + 1); // 平滑 IDF
  return seed;
}

function dot(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// ---------- LanceDB 作为 LlamaIndex 的向量存储后端 ----------
class LanceDBVectorStore extends BaseVectorStore<any, any> {
  storesText = true;
  private conn: any = null;
  private table: any = null;
  constructor() {
    super();
  }

  async init(items: CorpusItem[]): Promise<void> {
    fs.mkdirSync(LANCE_DIR, { recursive: true });
    this.conn = await lancedb.connect(LANCE_DIR);
    // 内容集合可能随社区发布/删除而变化，直接按当前 items 重建，幂等且简单。
    try { await this.conn.dropTable(TABLE); } catch { /* 表不存在则忽略 */ }
    this.table = await this.buildTable(items);
  }

  private async buildTable(items: CorpusItem[]): Promise<any> {
    const rows = await Promise.all(
      items.map(async (c) => {
        const emb = await embedModel.getTextEmbedding(c.text);
        return {
          id: c.slug,
          doc_id: c.slug,
          slug: c.slug,
          title: c.title,
          industry: c.industry,
          prompt: c.prompt,
          text: c.text,
          quality: c.quality ?? 0,
          source: c.source ?? "seed",
          vector: Float32Array.from(emb),
        };
      }),
    );
    return await this.conn.createTable(TABLE, rows);
  }

  client(): any {
    return this.conn;
  }

  async add(nodes: BaseNode[]): Promise<string[]> {
    if (!this.table) throw new Error("LanceDBVectorStore 未初始化");
    const rows = await Promise.all(
      nodes.map(async (n) => {
        const emb = (n as any).embedding ?? (await embedModel.getTextEmbedding(n.getContent(MetadataMode.EMBED)));
        const m = (n as any).metadata ?? {};
        return {
          id: (n as any).id_,
          doc_id: m.docId ?? (n as any).id_,
          slug: m.slug ?? "",
          title: m.title ?? "",
          industry: m.industry ?? "",
          prompt: m.prompt ?? "",
          text: n.getContent(MetadataMode.NONE),
          vector: Float32Array.from(emb as number[]),
        };
      }),
    );
    await this.table.add(rows);
    return nodes.map((n) => (n as any).id_);
  }

  async delete(refDocId: string): Promise<void> {
    if (this.table) await this.table.delete(`doc_id = '${refDocId}'`);
  }

  async query(query: VectorStoreQuery, _options?: object): Promise<VectorStoreQueryResult> {
    if (!this.table) throw new Error("LanceDBVectorStore 未初始化");
    const q = (query.queryEmbedding as number[]) ?? [];
    const rows = await this.table.search(Float32Array.from(q)).limit(query.similarityTopK).toArray();
    const nodes: BaseNode[] = [];
    const similarities: number[] = [];
    const ids: string[] = [];
    for (const r of rows as any[]) {
      const vec = (r.vector as number[] | Float32Array) ?? [];
      similarities.push(vec.length ? dot(q, vec) : 0);
      ids.push(r.id);
      nodes.push(
        new TextNode({
          text: r.text ?? "",
          id_: r.id,
          metadata: {
            slug: r.slug ?? "",
            title: r.title ?? "",
            industry: r.industry ?? "",
            prompt: r.prompt ?? "",
            quality: r.quality ?? 0,
            source: r.source ?? "seed",
            docId: r.doc_id ?? r.id,
          },
        }),
      );
    }
    return { nodes, similarities, ids };
  }
}

// ---------- 索引（惰性构建 + 持久化 + 社区变更自动刷新）----------
let indexPromise: Promise<VectorStoreIndex> | null = null;
let currentStore: LanceDBVectorStore | null = null; // 供 retrieve 直接做向量查询 + 加权重排
let builtSig: string | null = null; // 已构建集合的签名
let pendingSig: string | null = null; // 正在构建集合的签名（防并发双建）
const QUALITY_WEIGHT = 0.2; // 质量加权系数：blended = 相似度 + QUALITY_WEIGHT * 质量(0~1)。内置种子质量均为 0。

// 内置语料签名：文件大小 + mtime（内容改了才会变）
function seedSig(): string {
  try {
    const s = fs.statSync(CORPUS);
    return `seed:${s.size}:${s.mtimeMs}`;
  } catch {
    return "seed:?";
  }
}

function desiredSig(): string {
  return seedSig();
}

async function buildIndex(): Promise<VectorStoreIndex> {
  const items = loadCorpus();
  const store = new LanceDBVectorStore();
  await store.init(items);
  currentStore = store;
  currentItems = items;
  await rebuildSemanticIndex(items); // 语义内存索引 + 元数据（语义腿可选；元数据始终建）
  return await VectorStoreIndex.fromVectorStore(store);
}

// 外部（如 index.ts 在发布/删除社区模板后）调用，立即让下次检索重建索引。
export function invalidateRagIndex(): void {
  indexPromise = null;
  builtSig = null;
  pendingSig = null;
}

// 启动预热：在服务启动阶段主动构建一次索引，避免首条检索请求的冷启动延迟。
// 失败不影响主链路（retrieve 仍会惰性重建），仅记日志。
export async function warmupRag(): Promise<void> {
  try {
    await getIndex();
    console.log(`[rag] 索引预热完成（${currentItems.length} 条，语义=${semanticReady ? "开" : "关"}，reranker=${rerankerReady ? "开" : "关"}）`);
  } catch (e) {
    console.warn("[rag] 索引预热失败，首次检索将惰性重建：", (e as Error)?.message);
  }
}

async function getIndex(): Promise<VectorStoreIndex> {
  const desired = desiredSig();
  // 命中缓存（构建完成或正在构建同一集合）直接复用
  if (indexPromise && (builtSig === desired || pendingSig === desired)) return indexPromise;
  // 集合变化 → 重建（惰性，仅在差异时触发）
  pendingSig = desired;
  const p = buildIndex()
    .then((idx) => {
      builtSig = desired;
      pendingSig = null;
      return idx;
    })
    .catch((e) => {
      indexPromise = null;
      builtSig = null;
      pendingSig = null;
      throw e;
    });
  indexPromise = p;
  return p;
}

// ---------- 检索（保持与原接口一致：retrieve(industry, sentence, topK)）----------
export async function retrieve(
  industry: string,
  sentence: string,
  topK = 4,
): Promise<RagResult> {
  const empty: RagResult = { context: "", refs: [], snippet: {} };
  try {
    await getIndex();
    if (!currentStore) throw new Error("向量存储未就绪");
    const qText = sentence || industry || "";
    const cand = Math.max(topK * 3, 12); // 候选池

    // —— 词法腿：LanceDB 现有 vector 列（离线、零外部依赖）——
    const qLex = embed(qText);
    const lexRes = await currentStore.query({ queryEmbedding: qLex, similarityTopK: cand } as any, {});
    const lexNodes = (lexRes.nodes as any[]) || [];
    const lexSims = (lexRes.similarities as number[]) || [];
    const lexList: { slug: string; score: number }[] = lexNodes.map((n, i) => {
      const m = (n as any).metadata ?? {};
      return { slug: String(m.slug ?? ""), score: lexSims[i] ?? 0 };
    });

    // —— 语义腿：本地 bge 向量（内存索引，可选；未启用/未下载则跳过）——
    let semList: { slug: string; score: number }[] = [];
    if (SEMANTIC_ENABLED) {
      const ok = await ensureSemantic();
      if (ok && semanticIndex.size === 0 && currentItems.length) await rebuildSemanticIndex(currentItems);
      if (semanticIndex.size) {
        const qSem = await semanticEmbed(qText);
        if (qSem) {
          const scored: { slug: string; score: number }[] = [];
          for (const [slug, vec] of semanticIndex) scored.push({ slug, score: dotArr(qSem, vec) });
          scored.sort((a, b) => b.score - a.score);
          semList = scored.slice(0, cand);
        }
      }
    }

    // —— RRF 融合（词法 + 语义）——
    const fused = rrf([lexList, semList].filter((l) => l.length > 0));
    let ranked = [...fused.entries()].map(([slug, rrfScore]) => {
      const meta = corpusMeta.get(slug) ?? { title: "", industry: "", prompt: "", quality: 0, source: "seed" as const };
      return { slug, rrfScore, quality: meta.quality, source: meta.source, title: meta.title, industry: meta.industry, prompt: meta.prompt };
    });

    // —— 重排：开启 reranker 用语义精排，否则质量加权启发式 ——
    let reranked = false;
    if (RERANKER_ENABLED) {
      const ok = await ensureReranker();
      if (ok) {
        const pairs = ranked.map((e) => ({ slug: e.slug, text: `${e.title}\n${e.prompt}` }));
        const rs = await rerankPairs(qText, pairs);
        if (Object.keys(rs).length) {
          ranked = ranked
            .map((e) => ({ ...e, score: rs[e.slug] ?? 0 }))
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, topK);
          reranked = true;
        }
      }
    }
    if (!reranked) {
      ranked = ranked
        .map((e) => ({ ...e, score: e.rrfScore + QUALITY_WEIGHT * e.quality }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    const refs: RagRef[] = ranked.map((s) => ({
      slug: s.slug, title: s.title, industry: s.industry, source: s.source,
    }));
    const snippet: Record<string, string> = {};
    const blocks = ranked.map((r, i) => {
      const snip = (r.prompt || "").replace(/\s+/g, " ").slice(0, 280);
      snippet[r.slug] = snip;
      return `范例${i + 1}【${r.title}｜${r.industry}】\n${snip}`;
    });
    const context = ranked.length
      ? "下面是模板库（内置范例" +
        (semanticReady ? "，已启用语义+词法混合召回" : "") +
        "）中高质量范例，借鉴其「角色 + 上下文/背景 + 任务与约束 + 输出格式」四段式，但不要照抄：\n\n" +
        blocks.join("\n\n")
      : "";
    return { context, refs, snippet };
  } catch (e) {
    console.error("[rag] retrieve 失败，回退空上下文：", e);
    return empty;
  }
}

// ---------- 封装为 LangChain Tool（供 LangGraph 节点以工具调用方式使用）----------
export const retrieveTool = new DynamicTool({
  name: "retrieve_examples",
  description:
    "当用户需要借鉴模板库里已有的高质量提示词范例来起草新模板时使用。输入用户的原始需求描述，返回语义最相近的若干范例（标题 + 行业 + 正文片段）。",
  func: async (input: string) => {
    const rag = await retrieve("", input, 4);
    return JSON.stringify({ refs: rag.refs, snippet: rag.snippet });
  },
});

// OpenAI 工具调用协议所需的 function schema（从 retrieveTool 派生，单一事实来源）
export function retrieveToolSpec() {
  return {
    type: "function" as const,
    function: {
      name: retrieveTool.name,
      description: retrieveTool.description,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "用户的原始需求描述（一句话）" },
        },
        required: ["query"],
      },
    },
  };
}
