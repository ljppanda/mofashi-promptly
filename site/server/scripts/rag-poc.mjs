import { VectorStoreIndex, Document, Settings, BaseEmbedding, SentenceSplitter } from "llamaindex";

// ---- 自包含中文向量化（字符 n-gram 哈希 + L2 归一）----
const DIMS = 256;
function tokenize(text) {
  const clean = String(text || "").toLowerCase().replace(/\s+/g, " ");
  const chars = [...clean].filter((c) => /[\p{L}\p{N}]/u.test(c));
  const grams = new Set([clean]);
  for (const c of chars) grams.add(c);
  for (let i = 0; i < chars.length - 1; i++) grams.add(chars[i] + chars[i + 1]);
  return [...grams];
}
function hashDim(gram, dims) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < gram.length; i++) { h ^= gram.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % dims;
}
function embed(text) {
  const v = new Array(DIMS).fill(0);
  for (const g of tokenize(text)) v[hashDim(g, DIMS)] += 1;
  let norm = 0; for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}
class LocalZhEmbedding extends BaseEmbedding {
  constructor() { super(); }
  async getTextEmbedding(text) { return embed(text); }
}

Settings.embedModel = new LocalZhEmbedding();
Settings.nodeParser = new SentenceSplitter({ chunkSize: 2048, chunkOverlap: 0, tokenizer: (t) => Array.from(t) });

const docs = [
  new Document({ text: "法律顾问 合同审查 风险 条款 违约责任 保密", metadata: { industry: "法律", title: "合同审查" } }),
  new Document({ text: "营养师 饮食计划 每周食谱 卡路里 蛋白质 减脂", metadata: { industry: "生活/个人效率", title: "每周饮食计划" } }),
  new Document({ text: "代码审查 性能 安全 可读性 单元测试 类型", metadata: { industry: "编程开发", title: "代码审查" } }),
];
const index = await VectorStoreIndex.fromDocuments(docs);
const retriever = index.asRetriever({ similarityTopK: 2 });
const nodes = await retriever.retrieve("帮我做一个让AI当营养师排每周食谱的模板");
console.log("RESULTS:");
for (const n of nodes) {
  console.log("- score:", n.score?.toFixed(4), "| title:", n.node.metadata?.title, "| content:", n.node.getContent?.()?.slice(0, 30));
}
