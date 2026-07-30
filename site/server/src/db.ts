// db.ts — 持久化层（替代 metrics.ts 的 JSON 文件方案，M12）
// 使用 Node 22 内置 node:sqlite（零依赖、同步、事务安全），单文件落盘 data/app.db。
// 维度：使用人次(uses)、收藏人次(favorites)、评分(rating_sum/rating_count)。
// 启动若表为空：优先从旧 data/metrics.json 迁移；否则从 templates.json 播种确定性演示数据。
// 相比原 JSON「整文件读改写」，SQLite 提供事务与行级更新，消除并发覆盖隐患。

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
// 允许通过 APP_DB_FILE 覆盖数据库路径（便于测试隔离 / 数据目录可移植）；默认仍是 data/app.db。
const FILE = process.env.APP_DB_FILE ? path.resolve(process.env.APP_DB_FILE) : path.join(DATA_DIR, "app.db");
const METRICS_JSON = path.join(DATA_DIR, "metrics.json");
const CORPUS = path.join(DATA_DIR, "templates.json");

fs.mkdirSync(path.dirname(FILE), { recursive: true });

const db = new DatabaseSync(FILE);
// 生产加固（P1-③ 数据可靠性）：WAL 模式让读写不互斥（多读+单写并发），busy_timeout 让并发写
// 遇到锁时等待而非立即报 database is locked。注意 WAL 会产生 .db-wal/.db-shm 伴随文件，
// 备份时需连同这两个文件一起拷，否则会丢最近事务。
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");
// 版本化 schema 迁移（基线 v1 见 migrations.ts）：确保后续改表结构安全、不破坏老库。
runMigrations(db);

export interface MetricEntry {
  title: string;
  industry: string;
  uses: number;
  favorites: number;
  ratingSum: number;
  ratingCount: number;
}
type MetricMap = Record<string, MetricEntry>;

// FNV-1a + LCG 确定性伪随机（与原 metrics.ts 一致，保证演示数据每次启动一致）
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function makeRng(seed: number) {
  let x = seed || 1;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}

function seedFromCorpus(): MetricMap {
  const out: MetricMap = {};
  let corpus: any[] = [];
  try { corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8")); } catch { /* 无语料则不播种 */ }
  for (const t of corpus) {
    const id = t.slug || t.title;
    if (!id) continue;
    const r = makeRng(hashStr(String(id)));
    const uses = 40 + Math.floor(r() * 1960);
    const favorites = 8 + Math.floor(r() * 380);
    const count = 20 + Math.floor(r() * 580);
    const avg = 3.8 + r() * 1.1;
    out[id] = {
      title: t.title || id,
      industry: t.industry || "其他",
      uses,
      favorites,
      ratingSum: Math.round(avg * count),
      ratingCount: count,
    };
  }
  return out;
}

function importFromJson(): MetricMap {
  const out: MetricMap = {};
  try {
    const raw = JSON.parse(fs.readFileSync(METRICS_JSON, "utf8"));
    if (raw && typeof raw === "object") {
      for (const [id, e] of Object.entries(raw)) {
        const m = e as any;
        out[id] = {
          title: m.title || id,
          industry: m.industry || "其他",
          uses: m.uses || 0,
          favorites: m.favorites || 0,
          ratingSum: m.ratingSum || 0,
          ratingCount: m.ratingCount || 0,
        };
      }
    }
  } catch { /* 无文件/损坏则忽略 */ }
  return out;
}

function rowCount(): number {
  const r = db.prepare("SELECT COUNT(*) AS c FROM metrics").get() as { c: number };
  return r.c;
}

// 首次启动填充：优先迁移旧 metrics.json（保留已有真实数据），否则播种演示数据
function ensureTablePopulated() {
  if (rowCount() > 0) return;
  let data = importFromJson();
  if (Object.keys(data).length === 0) data = seedFromCorpus();
  const insert = db.prepare(
    "INSERT OR REPLACE INTO metrics(id,title,industry,uses,favorites,rating_sum,rating_count) VALUES(?,?,?,?,?,?,?)",
  );
  db.exec("BEGIN");
  try {
    for (const [id, e] of Object.entries(data)) {
      insert.run(id, e.title, e.industry, e.uses, e.favorites, e.ratingSum, e.ratingCount);
    }
    db.exec("COMMIT");
  } catch (err) { db.exec("ROLLBACK"); throw err; }
}
ensureTablePopulated();

export function bump(id: string, type: "use" | "favorite", delta: number, title?: string, industry?: string): MetricEntry {
  db.exec("BEGIN");
  try {
    db.prepare("INSERT OR IGNORE INTO metrics(id,title,industry) VALUES(?,?,?)").run(id, title || id, industry || "其他");
    if (type === "use") db.prepare("UPDATE metrics SET uses = MAX(0, uses + ?) WHERE id = ?").run(delta, id);
    else db.prepare("UPDATE metrics SET favorites = MAX(0, favorites + ?) WHERE id = ?").run(delta, id);
    if (title) db.prepare("UPDATE metrics SET title = ? WHERE id = ? AND (title IS NULL OR title = '')").run(title, id);
    if (industry) db.prepare("UPDATE metrics SET industry = ? WHERE id = ? AND (industry IS NULL OR industry = '' OR industry = '其他')").run(industry, id);
    db.exec("COMMIT");
  } catch (err) { db.exec("ROLLBACK"); throw err; }
  return getOne(id)!;
}

export function rate(id: string, score: number, prev: number | null, title?: string, industry?: string): MetricEntry {
  db.exec("BEGIN");
  try {
    db.prepare("INSERT OR IGNORE INTO metrics(id,title,industry) VALUES(?,?,?)").run(id, title || id, industry || "其他");
    const p = prev && prev > 0 ? prev : 0;
    if (p > 0) {
      db.prepare("UPDATE metrics SET rating_sum = MAX(0, rating_sum + ?) WHERE id = ?").run(score - p, id);
    } else {
      db.prepare("UPDATE metrics SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?").run(score, id);
    }
    db.prepare("UPDATE metrics SET rating_sum = MAX(0, rating_sum), rating_count = MAX(0, rating_count) WHERE id = ? AND rating_count <= 0").run(id);
    if (title) db.prepare("UPDATE metrics SET title = ? WHERE id = ? AND (title IS NULL OR title = '')").run(title, id);
    if (industry) db.prepare("UPDATE metrics SET industry = ? WHERE id = ? AND (industry IS NULL OR industry = '' OR industry = '其他')").run(industry, id);
    db.exec("COMMIT");
  } catch (err) { db.exec("ROLLBACK"); throw err; }
  return getOne(id)!;
}

export function getOne(id: string): MetricEntry | null {
  const r = db.prepare("SELECT id,title,industry,uses,favorites,rating_sum,rating_count FROM metrics WHERE id = ?").get(id) as any;
  if (!r) return null;
  return {
    title: r.title,
    industry: r.industry,
    uses: r.uses,
    favorites: r.favorites,
    ratingSum: r.rating_sum,
    ratingCount: r.rating_count,
  };
}

export function resetAll(): MetricMap {
  db.exec("DELETE FROM metrics");
  const data = seedFromCorpus();
  const insert = db.prepare(
    "INSERT OR REPLACE INTO metrics(id,title,industry,uses,favorites,rating_sum,rating_count) VALUES(?,?,?,?,?,?,?)",
  );
  db.exec("BEGIN");
  try {
    for (const [id, e] of Object.entries(data)) {
      insert.run(id, e.title, e.industry, e.uses, e.favorites, e.ratingSum, e.ratingCount);
    }
    db.exec("COMMIT");
  } catch (err) { db.exec("ROLLBACK"); throw err; }
  const map: MetricMap = {};
  for (const [id, e] of Object.entries(data)) map[id] = e;
  return map;
}

export type BoardSort = "heat" | "uses" | "favorites" | "rating";

export interface BoardRow {
  id: string;
  title: string;
  industry: string;
  uses: number;
  favorites: number;
  ratingSum: number;
  ratingCount: number;
  avgRating: number;
  heat: number;
}

function heatOf(e: { uses: number; favorites: number; ratingSum: number; ratingCount: number }): number {
  const avg = e.ratingCount ? e.ratingSum / e.ratingCount : 0;
  return e.uses + e.favorites * 2 + avg * e.ratingCount;
}

export function board(sort: BoardSort = "heat", limit = 100): BoardRow[] {
  const rows = db.prepare("SELECT id,title,industry,uses,favorites,rating_sum,rating_count FROM metrics").all() as any[];
  const out: BoardRow[] = rows.map((r) => {
    const avg = r.rating_count ? r.rating_sum / r.rating_count : 0;
    return {
      id: r.id,
      title: r.title,
      industry: r.industry,
      uses: r.uses,
      favorites: r.favorites,
      ratingSum: r.rating_sum,
      ratingCount: r.rating_count,
      avgRating: Math.round(avg * 10) / 10,
      heat: heatOf({ uses: r.uses, favorites: r.favorites, ratingSum: r.rating_sum, ratingCount: r.rating_count }),
    };
  });
  out.sort((a, b) => {
    if (sort === "uses") return b.uses - a.uses;
    if (sort === "favorites") return b.favorites - a.favorites;
    if (sort === "rating") return (b.avgRating - a.avgRating) || (b.ratingCount - a.ratingCount);
    return b.heat - a.heat;
  });
  return out.slice(0, Math.max(1, limit));
}

// =====================================================================
// 社区分享（M18）：用户发布 + 软审核（草稿 → 自己点公开 → 社区广场）
// 状态：draft（待公开） | published（社区广场可见）
// 社区 / 用户 / 举报 / 审核日志 等表结构由 migrations.ts 的基线 v1 创建，此处不再内联。
// =====================================================================

export interface CommunityRow {
  id: string;
  title: string;
  industry: string;
  author: string;
  authorId: string | null;
  prompt: string;
  tags: string[];
  note: string;
  status: string;
  createdAt: number;
  publishedAt: number | null;
  uses: number;
  favorites: number;
  ratingSum: number;
  ratingCount: number;
  avgRating: number;
}

function communityFromRow(r: any): CommunityRow {
  const avg = r.rating_count ? r.rating_sum / r.rating_count : 0;
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags || "[]"); } catch { tags = []; }
  return {
    id: r.id, title: r.title, industry: r.industry, author: r.author, authorId: r.author_id ?? null,
    prompt: r.prompt, tags, note: r.note, status: r.status,
    createdAt: r.created_at, publishedAt: r.published_at,
    uses: r.uses, favorites: r.favorites,
    ratingSum: r.rating_sum, ratingCount: r.rating_count,
    avgRating: Math.round(avg * 10) / 10,
  };
}

export function publishCommunity(rec: { id: string; title: string; industry: string; author?: string; authorId?: string | null; prompt: string; tags?: string[]; note?: string }): CommunityRow {
  const now = Date.now();
  // 作者名以服务端鉴权身份为准（authorId 绑定），杜绝客户端伪造"李鬼"。
  db.prepare(
    `INSERT INTO community(id,title,industry,author,author_id,prompt,tags,note,status,created_at,published_at,uses,favorites,rating_sum,rating_count)
     VALUES(?,?,?,?,?,?,?,?,'draft',?,NULL,0,0,0,0)`,
  ).run(rec.id, rec.title, rec.industry, rec.author || "匿名", rec.authorId ?? null, rec.prompt, JSON.stringify(rec.tags || []), rec.note || "", now);
  return getCommunity(rec.id)!;
}

// 社区冷启动种子（官方精选模板）。当 community 表无「已公开」记录时注入，
// 让社区首页 / 热度榜 / sitemap 有真实可展示内容；已有内容则不重复注入（幂等）。
type SeedTpl = { id: string; title: string; industry: string; prompt: string; tags: string[]; note: string; uses: number; favorites: number; ratingSum: number; ratingCount: number };
const COMMUNITY_SEED: SeedTpl[] = [
  { id: "seed-xhs-note", industry: "写作创作", title: "爆款小红书种草笔记生成器", tags: ["小红书", "种草", "营销文案"], note: "输入产品与卖点，生成带钩子标题+正文+话题标签的小红书笔记。", uses: 320, favorites: 88, ratingSum: 270, ratingCount: 32, prompt: "你是资深小红书操盘手。产品：{{product}}；核心卖点：{{selling_point}}；目标人群：{{audience}}。\n请生成一篇种草笔记：① 吸引点击的标题（含 emoji 与悬念）；② 300 字内正文（场景代入+痛点+卖点+使用体验）；③ 5 个 #话题标签。语气真实、有网感，避免硬广感。" },
  { id: "seed-code-review", industry: "编程开发", title: "代码评审与优化建议助手", tags: ["Code Review", "重构", "最佳实践"], note: "粘贴代码片段，给出问题点、风险与可落地的优化建议。", uses: 540, favorites: 150, ratingSum: 460, ratingCount: 55, prompt: "你是资深技术 Lead。请评审以下 {{language}} 代码：\n```\n{{code}}\n```\n输出：① 严重问题（正确性/安全/性能，按优先级）；② 可优化点（可读性/健壮性）；③ 给出关键改动后的代码片段。结论先讲风险，再给方案。" },
  { id: "seed-weekly-report", industry: "职场办公", title: "结构化周报/日报生成器", tags: ["周报", "职场", "效率"], note: "把零散工作流水整理成上级爱看的结构化周报。", uses: 410, favorites: 95, ratingSum: 360, ratingCount: 44, prompt: "你是职场写作教练。本周完成的事件（要点列表）：{{tasks}}；下周期望推进：{{next}}。\n生成一份周报：分「本周进展（结果导向，量化成果）」「风险与阻塞」「下周计划」三部分，每条用动词开头，控制在 200 字内，专业克制。" },
  { id: "seed-lesson-plan", industry: "教育培训", title: "互动式教案设计器", tags: ["教案", "教学", "互动"], note: "按知识点与学情生成可落地的互动教案。", uses: 180, favorites: 60, ratingSum: 150, ratingCount: 20, prompt: "你是教研专家。主题：{{topic}}；学段：{{grade}}；课时：{{duration}}；学生基础：{{level}}。\n设计教案：① 教学目标（知识/能力/素养）；② 导入（3 分钟情境问题）；③ 核心活动（含师生互动提问）；④ 巩固练习；⑤ 分层作业。突出互动与探究。" },
  { id: "seed-product-detail", industry: "电商运营", title: "商品详情页卖点提炼", tags: ["电商", "详情页", "转化"], note: "从产品参数提炼打动人的购买理由与详情结构。", uses: 260, favorites: 70, ratingSum: 210, ratingCount: 26, prompt: "你是电商转化率专家。商品：{{product}}；参数/功能：{{features}}；目标客群：{{audience}}。\n输出详情页结构：① 首屏价值主张一句话；② 3 个核心卖点（每个配「场景痛点→利益」）；③ 信任背书建议；④ 催单话术。围绕「用户得到什么」而非「产品有什么」。" },
  { id: "seed-finance-plan", industry: "金融", title: "个人理财规划建议顾问", tags: ["理财", "规划", "个人金融"], note: "基于收支与目标给出可执行的理财配置建议（科普，提示风险）。", uses: 150, favorites: 40, ratingSum: 120, ratingCount: 16, prompt: "你是持牌理财规划师（仅作科普，不构成投资建议）。月收入：{{income}}；月支出：{{expense}}；可投资资产：{{asset}}；目标：{{goal}}；风险偏好：{{risk}}。\n给出：① 应急备用金建议；② 资产配置比例框架（现金/固收/权益）；③ 下一步行动清单。强调分散与长期，提示风险自担。" },
  { id: "seed-health-article", industry: "医疗健康", title: "健康科普文章通俗化改写", tags: ["科普", "健康", "改写"], note: "把专业医学内容改写成易懂、准确、无误导的科普文。", uses: 200, favorites: 66, ratingSum: 165, ratingCount: 22, prompt: "你是医学科普编辑。原始内容：{{content}}；受众：{{audience}}（非专业）。\n改写为通俗科普：① 用生活化类比解释机制；② 去除黑话，必要处加括号注释；③ 标注「如有症状请就医」免责提示；④ 不夸大疗效、不荐药。确保科学准确、可读性强。" },
  { id: "seed-contract-review", industry: "法律", title: "合同条款风险点审查清单", tags: ["合同", "法律", "风控"], note: "扫描合同关键条款，提示常见风险与修改建议（非法律意见）。", uses: 130, favorites: 50, ratingSum: 110, ratingCount: 15, prompt: "你是企业法务（提示：本输出不构成正式法律意见）。合同类型：{{type}}；相对方：{{party}}；核心条款文本：{{clause}}。\n输出风险审查清单：① 每条风险（权责不对等/模糊表述/违约救济缺失等）；② 修改建议（指明应补充/删除的内容）；③ 必须保留的护城河条款。聚焦可执行。" },
];
export function seedCommunityIfEmpty(): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM community WHERE status='published'").get() as any;
  if (row && row.c > 0) return 0;
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO community(id,title,industry,author,author_id,prompt,tags,note,status,created_at,published_at,uses,favorites,rating_sum,rating_count)
     VALUES(?,?,?,?,?,?,?,?,'published',?,?,?,?,?,?)`,
  );
  let n = 0;
  for (const s of COMMUNITY_SEED) {
    const ts = now - n * 3600_000; // 每小时一篇，拉开发布时间，使「最新」排序有梯度
    stmt.run(s.id, s.title, s.industry, "模法师官方", null, s.prompt, JSON.stringify(s.tags), s.note, ts, ts, s.uses, s.favorites, s.ratingSum, s.ratingCount);
    n++;
  }
  return n;
}
// 在常量定义之后调用（避免 TDZ）：公开模板为空时注入官方精选，避免社区/热度榜/sitemap 空状态。幂等。
seedCommunityIfEmpty();

export interface CommunityListOpts {
  status?: string;
  sort?: "heat" | "new" | "rating";
  q?: string;
  industry?: string;
  limit?: number;
  offset?: number;
}
export function listCommunity(opts: CommunityListOpts = {}): CommunityRow[] {
  const status = opts.status || "published";
  const sort = opts.sort || "heat";
  const q = (opts.q || "").trim();
  const industry = (opts.industry || "").trim();
  const limit = Math.min(500, Math.max(1, opts.limit || 100));
  const offset = Math.max(0, opts.offset || 0);
  let sql = "SELECT * FROM community WHERE status = ?";
  const params: any[] = [status];
  if (industry && industry !== "全部") {
    sql += " AND industry = ?";
    params.push(industry);
  }
  if (q) {
    const like = "%" + q + "%";
    sql += " AND (title LIKE ? OR prompt LIKE ? OR tags LIKE ? OR industry LIKE ?)";
    params.push(like, like, like, like);
  }
  if (sort === "new") sql += " ORDER BY COALESCE(published_at, created_at) DESC";
  else if (sort === "rating") sql += " ORDER BY (CASE WHEN rating_count>0 THEN rating_sum*1.0/rating_count ELSE 0 END) DESC, rating_count DESC";
  else sql += " ORDER BY (uses + favorites*2 + CASE WHEN rating_count>0 THEN rating_sum*1.0/rating_count*rating_count ELSE 0 END) DESC";
  sql += " LIMIT ? OFFSET ?";
  params.push(limit, offset);
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(communityFromRow);
}

export function draftsCommunity(): CommunityRow[] {
  const rows = db.prepare("SELECT * FROM community WHERE status = 'draft' ORDER BY created_at DESC").all() as any[];
  return rows.map(communityFromRow);
}

// 仅本人草稿（按 author_id 过滤），供已登录用户的「我的草稿」使用。
// 公网必须过滤：裸 draftsCommunity() 会暴露所有用户草稿，绝不对普通用户返回。
export function draftsCommunityMine(authorId: string): CommunityRow[] {
  if (!authorId) return [];
  const rows = db.prepare("SELECT * FROM community WHERE status = 'draft' AND author_id = ? ORDER BY created_at DESC").all(authorId) as any[];
  return rows.map(communityFromRow);
}

export function getCommunity(id: string): CommunityRow | null {
  const r = db.prepare("SELECT * FROM community WHERE id = ?").get(id) as any;
  return r ? communityFromRow(r) : null;
}

export function publishNowCommunity(id: string): CommunityRow | null {
  db.prepare("UPDATE community SET status='published', published_at=COALESCE(published_at, ?) WHERE id=?").run(Date.now(), id);
  return getCommunity(id);
}

export function unpublishCommunity(id: string): CommunityRow | null {
  db.prepare("UPDATE community SET status='draft' WHERE id=?").run(id);
  return getCommunity(id);
}

export function deleteCommunity(id: string): void {
  db.prepare("DELETE FROM community WHERE id=?").run(id);
}

export function communityRate(id: string, score: number, prev: number | null): CommunityRow | null {
  db.exec("BEGIN");
  try {
    const p = prev && prev > 0 ? prev : 0;
    if (p > 0) db.prepare("UPDATE community SET rating_sum = MAX(0, rating_sum + ?) WHERE id = ?").run(score - p, id);
    else db.prepare("UPDATE community SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?").run(score, id);
    db.prepare("UPDATE community SET rating_sum = MAX(0, rating_sum), rating_count = MAX(0, rating_count) WHERE id = ? AND rating_count <= 0").run(id);
    db.exec("COMMIT");
  } catch (err) { db.exec("ROLLBACK"); throw err; }
  return getCommunity(id);
}

export function communityUse(id: string, delta: number): CommunityRow | null {
  db.prepare("UPDATE community SET uses = MAX(0, uses + ?) WHERE id = ?").run(delta, id);
  return getCommunity(id);
}

export function communityFavorite(id: string, delta: number): CommunityRow | null {
  db.prepare("UPDATE community SET favorites = MAX(0, favorites + ?) WHERE id = ?").run(delta, id);
  return getCommunity(id);
}

// 我的发布：作者本人可见的草稿 + 已公开（按 author_id 过滤），供前端「我的模板/我的发布」使用。
export function listCommunityMine(authorId: string): CommunityRow[] {
  if (!authorId) return [];
  const rows = db.prepare("SELECT * FROM community WHERE author_id = ? ORDER BY COALESCE(published_at, created_at) DESC").all(authorId) as any[];
  return rows.map(communityFromRow);
}

// 社区评论（C1）：模板/实例讨论区。作者名以服务端鉴权身份为准（authorId 绑定）。
export interface CommentRow {
  id: string;
  itemId: string;
  author: string;
  authorId: string | null;
  content: string;
  createdAt: number;
}
export function addComment(itemId: string, authorId: string | null, author: string, content: string): CommentRow {
  const id = "cm" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare(
    `INSERT INTO comments(id,item_id,author_id,author,content,created_at,status)
     VALUES(?,?,?,?,?,?,'visible')`,
  ).run(id, itemId, authorId ?? null, author || "匿名", content.slice(0, 2000), Date.now());
  return getComment(id)!;
}
export function getComment(id: string): CommentRow | null {
  const r = db.prepare("SELECT * FROM comments WHERE id = ?").get(id) as any;
  if (!r) return null;
  return { id: r.id, itemId: r.item_id, author: r.author, authorId: r.author_id ?? null, content: r.content, createdAt: r.created_at };
}
export function listComments(itemId: string): CommentRow[] {
  const rows = db.prepare("SELECT * FROM comments WHERE item_id = ? AND status = 'visible' ORDER BY created_at ASC").all(itemId) as any[];
  return rows.map((r: any) => ({ id: r.id, itemId: r.item_id, author: r.author, authorId: r.author_id ?? null, content: r.content, createdAt: r.created_at }));
}
// 仅作者本人或管理员可删；软删除（status='deleted'）保留审计痕迹。
export function deleteComment(id: string, actorId: string | null, isAdmin: boolean): boolean {
  const r = db.prepare("SELECT * FROM comments WHERE id = ?").get(id) as any;
  if (!r) return false;
  if (!(isAdmin || (actorId && r.author_id && r.author_id === actorId))) return false;
  db.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?").run(id);
  return true;
}
// 作者主页（C2）：列出某作者已公开模板（按 author_id 过滤，仅 published）。
// 匿名发布（author_id 为 null）无主页，前端对 authorId 为空不生成链接。
export function listCommunityByAuthor(authorId: string): CommunityRow[] {
  if (!authorId) return [];
  const rows = db.prepare("SELECT * FROM community WHERE author_id = ? AND status = 'published' ORDER BY COALESCE(published_at, created_at) DESC").all(authorId) as any[];
  return rows.map(communityFromRow);
}
// 发布去重（C3）：在已公开模板里找与待发布内容相似的，返回 top（bigram 相似度）。
function bigramSim(a: string, b: string): number {
  if (!a || !b) return 0;
  const bg = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
  const A = bg(a), B = bg(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
export function findSimilarCommunity(title: string, prompt: string, limit = 3): { id: string; title: string; similarity: number }[] {
  const all = db.prepare("SELECT id,title,prompt FROM community WHERE status='published'").all() as any[];
  if (!all.length) return [];
  const norm = (s: string) => (s || "").toLowerCase().replace(/[\s\p{P}]+/gu, "");
  const nt = norm(title);
  const np = norm(prompt).slice(0, 400);
  return all.map((r: any) => {
    const rt = norm(r.title);
    const rp = norm(r.prompt).slice(0, 400);
    let tSim = 0;
    if (nt && rt) {
      if (nt.includes(rt) || rt.includes(nt)) tSim = 0.9;
      else tSim = bigramSim(nt, rt);
    }
    const pSim = (np && rp) ? bigramSim(np, rp) : 0;
    const sim = Math.max(tSim, pSim * 0.8);
    return { id: r.id, title: r.title, similarity: Math.round(sim * 100) / 100 };
  }).filter((x: any) => x.similarity >= 0.6)
    .sort((a: any, b: any) => b.similarity - a.similarity)
    .slice(0, limit);
}

// =====================================================================
// 用户账号（真实多用户体系）：注册 / 登录 / 角色 / 管理
// =====================================================================
export interface UserRow {
  id: string;
  username: string;
  role: string;
  createdAt: number;
  status: string;
}

export function createUser(username: string, passHash: string, salt: string, role = "user"): UserRow {
  const id = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare("INSERT INTO users(id,username,pass_hash,salt,role,created_at,status) VALUES(?,?,?,?,?,?,'active')")
    .run(id, username, passHash, salt, role, Date.now());
  return getUserById(id)!;
}
export function getUserByUsername(username: string): (UserRow & { passHash: string; salt: string }) | null {
  const r = db.prepare("SELECT id,username,pass_hash,salt,role,created_at,status FROM users WHERE username = ?").get(username) as any;
  if (!r) return null;
  return { id: r.id, username: r.username, role: r.role, createdAt: r.created_at, status: r.status, passHash: r.pass_hash, salt: r.salt };
}
export function getUserById(id: string): UserRow | null {
  const r = db.prepare("SELECT id,username,role,created_at,status FROM users WHERE id = ?").get(id) as any;
  if (!r) return null;
  return { id: r.id, username: r.username, role: r.role, createdAt: r.created_at, status: r.status };
}
export function userExists(username: string): boolean {
  return !!db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
}
export function listUsers(limit = 200): UserRow[] {
  const rows = db.prepare("SELECT id,username,role,created_at,status FROM users ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(1000, limit))) as any[];
  return rows.map((r: any) => ({ id: r.id, username: r.username, role: r.role, createdAt: r.created_at, status: r.status }));
}
export function deleteUser(id: string): void {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}
export function setUserRole(id: string, role: string): void {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

// =====================================================================
// 社区举报 + 审核日志（M18 补完）：举报提交 / 管理 / 审核动作留痕
// =====================================================================
export function reportCommunity(itemId: string, reason: string, detail: string): void {
  const id = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare("INSERT INTO reports(id,item_id,reason,detail,created_at,status) VALUES(?,?,?,?,?,'pending')")
    .run(id, itemId, (reason || "未说明").slice(0, 100), (detail || "").slice(0, 2000), Date.now());
}

export interface ReportRow {
  id: string;
  itemId: string;
  title: string;
  reason: string;
  detail: string;
  createdAt: number;
  status: string;
}
export function listReports(status = "pending"): ReportRow[] {
  const rows = db.prepare(
    `SELECT r.id, r.item_id, r.reason, r.detail, r.created_at, r.status,
            COALESCE(c.title, '(已删除)') AS item_title
     FROM reports r LEFT JOIN community c ON c.id = r.item_id
     WHERE r.status = ? ORDER BY r.created_at DESC`,
  ).all(status) as any[];
  return rows.map((r: any) => ({
    id: r.id, itemId: r.item_id, title: r.item_title, reason: r.reason,
    detail: r.detail || "", createdAt: r.created_at, status: r.status,
  }));
}
export function resolveReport(id: string, action: "resolved" | "dismissed"): void {
  db.prepare("UPDATE reports SET status = ? WHERE id = ?").run(action, id);
}

export function logModeration(itemId: string | null, itemTitle: string, action: string, safe: boolean, engine: string | null, reasons: string[]): void {
  const id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare(
    `INSERT INTO moderation_log(id,item_id,item_title,action,safe,engine,reasons,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(id, itemId, (itemTitle || "").slice(0, 200), action, safe ? 1 : 0, engine,
    JSON.stringify(reasons || []), Date.now());
}

export interface ModerationLogRow {
  id: string;
  itemId: string | null;
  itemTitle: string;
  action: string;
  safe: boolean;
  engine: string | null;
  reasons: string[];
  createdAt: number;
}
export function listModerationLog(limit = 50): ModerationLogRow[] {
  const rows = db.prepare("SELECT * FROM moderation_log ORDER BY created_at DESC LIMIT ?")
    .all(Math.max(1, Math.min(500, limit))) as any[];
  return rows.map((r: any) => ({
    id: r.id, itemId: r.item_id, itemTitle: r.item_title, action: r.action,
    safe: !!r.safe, engine: r.engine,
    reasons: (() => { try { return JSON.parse(r.reasons || "[]"); } catch { return []; } })(),
    createdAt: r.created_at,
  }));
}

// =====================================================================
// 本地可观测（M18）：把每次 Agent 调用的 trace 落盘，应用内「可观测」页可见。
// 与 LangSmith 云端上报互不冲突：LangSmith 走 langsmith.ts（需设 Key），这里走本地表。
// traces 表由 migrations.ts 基线 v1 创建。
// =====================================================================

export interface TraceEntry {
  id: string;
  createdAt: number;
  type: string;
  provider?: string;
  model?: string;
  preview?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  status?: string;
  error?: string;
  steps: string[];
  userId?: string | null;
}

export function recordTrace(e: {
  type: string;
  provider?: string;
  model?: string;
  preview?: string;
  latencyMs?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  status?: string;
  error?: string;
  steps?: string[];
  userId?: string | null;
}): void {
  const id = (globalThis.crypto?.randomUUID?.() || ("t" + Date.now() + Math.random().toString(16).slice(2)));
  const u = e.usage || {};
  db.prepare(
    `INSERT INTO traces(id,created_at,type,provider,model,preview,latency_ms,prompt_tokens,completion_tokens,total_tokens,status,error,steps,user_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, Date.now(), e.type, e.provider || null, e.model || null,
    ((e.preview || "").slice(0, 200) || null),
    e.latencyMs ?? null, u.prompt_tokens ?? null, u.completion_tokens ?? null, u.total_tokens ?? null,
    e.status || "ok", e.error || null, JSON.stringify(e.steps || []),
    e.userId ?? null,
  );
}

export function listTraces(limit = 200, userId?: string | null): TraceEntry[] {
  const lim = Math.max(1, Math.min(1000, limit));
  // 不传 userId（管理员）→ 全部；传入 → 仅该用户本人（匿名 trace 的 user_id 为 NULL，普通用户看不见）
  const rows = userId
    ? (db.prepare("SELECT * FROM traces WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, lim) as any[])
    : (db.prepare("SELECT * FROM traces ORDER BY created_at DESC LIMIT ?").all(lim) as any[]);
  return rows.map((r: any) => {
    let steps: string[] = [];
    try { steps = JSON.parse(r.steps || "[]"); } catch { steps = []; }
    return {
      id: r.id, createdAt: r.created_at, type: r.type, provider: r.provider, model: r.model,
      preview: r.preview, latencyMs: r.latency_ms, promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens, totalTokens: r.total_tokens, status: r.status,
      error: r.error, steps, userId: r.user_id ?? null,
    };
  });
}

// 优雅关闭：释放 SQLite 文件句柄（进程退出前调用）。
export function closeDb(): void {
  try { db.close(); } catch { /* 已关闭或无需关闭 */ }
}
