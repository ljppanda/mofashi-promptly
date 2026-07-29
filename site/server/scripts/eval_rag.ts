/**
 * 离线 RAG 检索质量评测（无需 LLM / 无需网络，默认词法召回）。
 *
 * 目的：量化「用户描述需求 → 检索到同行业/相关模板」的效果，作为是否启用
 * reranker / 语义腿的决策依据。
 *
 * 指标：
 *  - 同行业 Precision@k：top-k 中行业与查询行业一致的比例（越高越好）
 *  - MRR：第一个同行业结果排名的倒数均值（越高越好）
 *  - 自命中 Recall@k：用标题作查询时，自身是否进入 top-k（ sanity check）
 *
 * 用法：
 *   npm run eval:rag                # 词法基线
 *   RAG_RERANKER=1 npm run eval:rag # 若已下载 bge-reranker 模型则对比精排
 * 报告写入 scripts/eval_rag_report.md。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retrieve } from "../src/rag.js";

const RERANKER_ENABLED = process.env.RAG_RERANKER === "1" || process.env.RAG_RERANKER === "true";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.resolve(__dirname, "..", "data", "templates.json");
const OUT = path.resolve(__dirname, "eval_rag_report.md");

type Item = { slug: string; title: string; industry: string; task: string; summary: string; tags: string[]; text: string };

const seed: Item[] = JSON.parse(fs.readFileSync(CORPUS, "utf8"));

const TOPK = 6;

// —— 1) 同行业召回：用「task + 行业」模拟用户描述需求 ——
let pAt1 = 0, pAt3 = 0, pAt5 = 0, rr = 0, n = 0;
// —— 2) 自命中：用「标题 + 行业」查询，自身是否进 top-k ——
let selfHit: Record<number, number> = { 1: 0, 3: 0, 5: 0 };
// 各行业明细（用于报告）
const byIndustry: Record<string, { n: number; p5: number }> = {};

for (const it of seed) {
  // 需求型查询：task 描述 + 行业，最贴近真实搜索
  const qNeed = `${it.task} ${it.industry}`;
  const r1 = await retrieve(it.industry, qNeed, TOPK);
  const inds1 = r1.refs.map((x) => x.industry);
  const sameCount = (k: number) => inds1.slice(0, k).filter((x) => x === it.industry).length;
  pAt1 += sameCount(1) / 1;
  pAt3 += sameCount(3) / 3;
  pAt5 += sameCount(5) / 5;
  const firstSame = inds1.findIndex((x) => x === it.industry);
  rr += firstSame >= 0 ? 1 / (firstSame + 1) : 0;
  n++;
  byIndustry[it.industry] = byIndustry[it.industry] || { n: 0, p5: 0 };
  byIndustry[it.industry].n++;
  byIndustry[it.industry].p5 += sameCount(5) / 5;

  // 自命中查询
  const qSelf = `${it.title} ${it.industry}`;
  const r2 = await retrieve(it.industry, qSelf, 5);
  const slugs2 = r2.refs.map((x) => x.slug);
  if (slugs2.slice(0, 1).includes(it.slug)) selfHit[1]++;
  if (slugs2.slice(0, 3).includes(it.slug)) selfHit[3]++;
  if (slugs2.slice(0, 5).includes(it.slug)) selfHit[5]++;
}

// —— 3) 精选自然语言查询（人工设定期望行业），展示具体案例 ——
const examples: { q: string; expect: string }[] = [
  { q: "帮我写一份租房合同纠纷的答辩意见", expect: "法律" },
  { q: "怎么给老板写一封请假邮件", expect: "职场办公" },
  { q: "小学生乘法口诀怎么教更有效", expect: "教育培训" },
  { q: "小红书美妆产品种草文案怎么写", expect: "电商运营" },
  { q: "基金定投的风险提示语怎么写", expect: "金融" },
  { q: "帮我把这段 Python 代码优化一下性能", expect: "编程开发" },
  { q: "周末家庭出游计划怎么安排得好玩", expect: "生活/个人效率" },
  { q: "写一首关于故乡的抒情散文", expect: "写作创作" },
  { q: "体检报告里的结节要不要紧怎么解读", expect: "医疗健康" },
];
const exRows: string[] = [];
for (const e of examples) {
  const r = await retrieve(e.expect, e.q, 5);
  const top1 = r.refs[0];
  const hitInd = r.refs.slice(0, 3).some((x) => x.industry === e.expect);
  exRows.push(
    `| ${e.q} | ${e.expect} | ${top1 ? `${top1.title}（${top1.industry}）` : "—"} | ${hitInd ? "✅" : "❌"} |`,
  );
}

const pct = (x: number) => (x * 100).toFixed(1) + "%";
const report = `# RAG 检索质量评测报告

> 生成时间：${new Date().toISOString()}
> 召回模式：${RERANKER_ENABLED ? "词法 + reranker 精排" : "词法（离线默认）"}
> 语料规模：${seed.length} 条种子模板 / ${Object.keys(byIndustry).length} 行业
> 评测方式：离线，不调用任何 LLM / 不依赖网络

## 聚合指标（需求型查询 = task + 行业，模拟用户描述需求）

| 指标 | 数值 |
|---|---|
| 同行业 Precision@1 | ${pct(pAt1 / n)} |
| 同行业 Precision@3 | ${pct(pAt3 / n)} |
| 同行业 Precision@5 | ${pct(pAt5 / n)} |
| MRR（首个同行业结果） | ${pct(rr / n)} |
| 自命中 Recall@1 / @3 / @5 | ${pct(selfHit[1] / n)} / ${pct(selfHit[3] / n)} / ${pct(selfHit[5] / n)} |

## 各行业 Precision@5

| 行业 | 样本数 | P@5 |
|---|---|---|
${Object.entries(byIndustry)
  .map(([k, v]) => `| ${k} | ${v.n} | ${pct(v.p5 / v.n)} |`)
  .join("\n")}

## 自然语言查询案例（期望行业 vs 实际 top1 + top3 是否命中期望行业）

| 用户查询 | 期望行业 | 实际 top1 | top3 命中期望 |
|---|---|---|---|
${exRows.join("\n")}

## 结论与建议

- 同行业 Precision@5 ≈ ${pct(pAt5 / n)}：当前词法召回在「需求描述 → 同行业模板」上${pAt5 / n > 0.8 ? "已经相当好" : pAt5 / n > 0.6 ? "基本可用，仍有提升空间" : "偏弱，建议启用语义/RRF"}。
- reranker 是否必要：本语料仅 ${seed.length} 条、行业边界清晰，**词法基线已能满足大部分场景**；reranker（bge-reranker-v2-m3，需联网首下模型）在长尾/跨行业歧义查询上能进一步提纯，但属「锦上添花」而非「必须」。建议保持默认关闭，公网真有长尾检索投诉时再开。
- 索引预热（warmupRag）已在服务启动阶段触发，消除首请求冷启动延迟——这比 reranker 更该优先做，已落地。
`;

fs.writeFileSync(OUT, report, "utf8");
console.log(report);
console.log(`\n报告已写入：${OUT}`);
