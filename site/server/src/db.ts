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
// 公开聚合指标（M?）：首页信任条 / 社区新鲜度 / 按行业分布 统一数据源。
// 全部来自真实计数，绝不编造。公开 GET，无需鉴权。
// =====================================================================
export interface CommunitySummary {
  communityPublished: number;   // 社区已公开模板数
  todayPublished: number;       // 今日（本地时区 0 点起）新公开数
  totalUses: number;            // 提示词被使用总次数（社区 uses + 精选模板 metrics.uses）
  totalFavorites: number;       // 收藏总次数（社区 + 精选）
  creators: number;             // 已发布内容的创作者数（DISTINCT author_id）
  industryCounts: { industry: string; count: number }[]; // 已公开按行业分布（降序）
}
export function communitySummary(): CommunitySummary {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const t0 = startOfDay.getTime();
  const pub = db.prepare("SELECT COUNT(*) c FROM community WHERE status='published'").get() as any;
  const today = db.prepare("SELECT COUNT(*) c FROM community WHERE status='published' AND published_at >= ?").get(t0) as any;
  const c = db.prepare("SELECT COALESCE(SUM(uses),0) u, COALESCE(SUM(favorites),0) f FROM community").get() as any;
  const m = db.prepare("SELECT COALESCE(SUM(uses),0) u, COALESCE(SUM(favorites),0) f FROM metrics").get() as any;
  const creators = db.prepare("SELECT COUNT(DISTINCT author_id) c FROM community WHERE author_id IS NOT NULL").get() as any;
  const ind = db.prepare("SELECT industry, COUNT(*) c FROM community WHERE status='published' GROUP BY industry ORDER BY c DESC").all() as any[];
  return {
    communityPublished: pub.c || 0,
    todayPublished: today.c || 0,
    totalUses: (c.u || 0) + (m.u || 0),
    totalFavorites: (c.f || 0) + (m.f || 0),
    creators: creators.c || 0,
    industryCounts: ind.map((r: any) => ({ industry: r.industry, count: r.c })),
  };
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
  cover: string | null;   // 封面图链接 / data URL（轻量版封面方案；空=无封面，前端显示行业占位图）
  version: string | null; // 模板版本徽标（报告 #7，对标 ProBazaar v3.0）；空=未设
  difficulty: string;     // 模板难度（F35-③）：入门 / 进阶 / 专家；空或未知兜底「入门」
  recommendModel: string | null; // 推荐模型（F35-③）：如 "Claude / GPT-4o"；空=未指定
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
    prompt: r.prompt, tags, note: r.note, cover: r.cover ?? null, version: r.version ?? null, status: r.status,
    difficulty: (r.difficulty && ["入门", "进阶", "专家"].includes(r.difficulty)) ? r.difficulty : "入门",
    recommendModel: r.recommend_model ?? null,
    createdAt: r.created_at, publishedAt: r.published_at,
    uses: r.uses, favorites: r.favorites,
    ratingSum: r.rating_sum, ratingCount: r.rating_count,
    avgRating: Math.round(avg * 10) / 10,
  };
}

export function publishCommunity(rec: { id: string; title: string; industry: string; author?: string; authorId?: string | null; prompt: string; tags?: string[]; note?: string; cover?: string; version?: string; difficulty?: string }): CommunityRow {
  const now = Date.now();
  const normPrompt = (rec.prompt || "").trim();
  // 幂等去重（用户体验修复）：同一作者 + 相同标题 + 相同正文，视为重复发布，
  // 更新已有草稿而非新增，避免「反复点发布生成一堆草稿」。匿名(authorId 空)不跨用户去重。
  if (rec.authorId) {
    const existing = db.prepare(
      "SELECT * FROM community WHERE author_id=? AND title=? AND prompt=? AND status='draft'"
    ).get(rec.authorId, rec.title, normPrompt) as any;
    if (existing) {
      db.prepare("UPDATE community SET industry=?, tags=?, note=?, cover=?, created_at=? WHERE id=?")
        .run(rec.industry, JSON.stringify(rec.tags || []), rec.note || "", rec.cover || "", now, existing.id);
      return getCommunity(existing.id)!;
    }
  }
  // 作者名以服务端鉴权身份为准（authorId 绑定），杜绝客户端伪造"李鬼"。
  const version = rec.version || "v1.0"; // 首次发布即 v1.0（报告 #7 版本徽标）
  const difficulty = rec.difficulty || "入门"; // F35-③ 难度，发布默认「入门」
  db.prepare(
    `INSERT INTO community(id,title,industry,author,author_id,prompt,tags,note,cover,version,difficulty,status,created_at,published_at,uses,favorites,rating_sum,rating_count)
     VALUES(?,?,?,?,?,?,?,?,?,?,?, 'draft',?,NULL,0,0,0,0)`,
  ).run(rec.id, rec.title, rec.industry, rec.author || "匿名", rec.authorId ?? null, rec.prompt, JSON.stringify(rec.tags || []), rec.note || "", rec.cover || "", version, difficulty, now);
  return getCommunity(rec.id)!;
}

// 社区冷启动种子（官方精选模板）。当 community 表无「已公开」记录时注入，
// 让社区首页 / 热度榜 / sitemap 有真实可展示内容；已有内容则不重复注入（幂等）。
// 生成行业封面（内联 SVG data URI，无外链、防 XSS、视觉差异化）。列表不再千篇一律占位图。
function coverDataUri(industry: string, title: string): string {
  const palette: Record<string, [string, string]> = {
    "写作创作": ["#ff6b9d", "#ffb86b"],
    "编程开发": ["#4f8cff", "#36d1c4"],
    "职场办公": ["#6a5cff", "#9b6bff"],
    "教育培训": ["#ff9a3c", "#ffd56b"],
    "电商运营": ["#ff5e62", "#ff9966"],
    "金融": ["#2bb673", "#36c5b0"],
    "医疗健康": ["#36c5f0", "#5b86e5"],
    "法律": ["#8e54e9", "#4776e6"],
  };
  const [c1, c2] = palette[industry] || ["#7a7a7a", "#b0b0b0"];
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" } as Record<string, string>)[c] || c);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='320'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient></defs><rect width='600' height='320' fill='url(#g)'/><text x='40' y='170' font-family='sans-serif' font-size='40' font-weight='700' fill='rgba(255,255,255,0.96)'>${esc(industry)}</text><text x='40' y='232' font-family='sans-serif' font-size='22' fill='rgba(255,255,255,0.88)'>${esc(title)}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

import { COMMUNITY_SEED } from "./seedCommunity.js"; // 官方精选种子（生产级 prompt，见 seedCommunity.ts）
export function seedCommunityIfEmpty(): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM community WHERE status='published'").get() as any;
  const now = Date.now();
  if (row && row.c > 0) {
    // 已存在：补足封面（历史种子封面为空串，导致列表视觉同质化）。仅对 cover 为空者更新，避免覆盖用户后来设置的真实封面。
    const up = db.prepare("UPDATE community SET cover = ? WHERE id = ? AND (cover IS NULL OR cover = '')");
    let m = 0;
    for (const s of COMMUNITY_SEED) { up.run(coverDataUri(s.industry, s.title), s.id); m++; }
    // 回填版本徽标（报告 #7）：仅对 version 为空者，避免覆盖用户/官方后来设置的版本号。
    const upv = db.prepare("UPDATE community SET version='v1.0' WHERE id = ? AND (version IS NULL OR version='')");
    for (const s of COMMUNITY_SEED) { upv.run(s.id); }
    // 内容升级（本轮）：官方种子正文/标签/备注同步刷新为生产级骨架；仅作用于官方保留 ID，不触碰用户发布内容。
    const upc = db.prepare("UPDATE community SET prompt = ?, tags = ?, note = ?, difficulty = ?, recommend_model = ? WHERE id = ? AND author = '模法师官方'");
    for (const s of COMMUNITY_SEED) { upc.run(s.prompt, JSON.stringify(s.tags), s.note, s.difficulty || "入门", s.recommendModel || null, s.id); }
    return m;
  }
  const stmt = db.prepare(
    `INSERT INTO community(id,title,industry,author,author_id,prompt,tags,note,cover,version,difficulty,recommend_model,status,created_at,published_at,uses,favorites,rating_sum,rating_count)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'published',?,?,?,?,?,?)`,
  );
  let n = 0;
  for (const s of COMMUNITY_SEED) {
    const ts = now - n * 3600_000; // 每小时一篇，拉开发布时间，使「最新」排序有梯度
    stmt.run(s.id, s.title, s.industry, "模法师官方", null, s.prompt, JSON.stringify(s.tags), s.note, coverDataUri(s.industry, s.title), "v1.0", s.difficulty || "入门", s.recommendModel || null, ts, ts, s.uses, s.favorites, s.ratingSum, s.ratingCount);
    n++;
  }
  return n;
}
// 在常量定义之后调用（避免 TDZ）：公开模板为空时注入官方精选，避免社区/热度榜/sitemap 空状态。幂等。
seedCommunityIfEmpty();

export interface CommunityListOpts {
  status?: string;
  sort?: "heat" | "new" | "rating" | "favorites" | "uses";
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
  else if (sort === "favorites") sql += " ORDER BY favorites DESC, uses DESC";
  else if (sort === "uses") sql += " ORDER BY uses DESC, favorites DESC";
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
export function listCommunityByAuthor(authorId: string): { author: string; items: CommunityRow[]; totals: { uses: number; favorites: number; joinedAt: number | null } } {
  if (!authorId) return { author: "", items: [], totals: { uses: 0, favorites: 0, joinedAt: null } };
  const rows = db.prepare("SELECT * FROM community WHERE author_id = ? AND status = 'published' ORDER BY COALESCE(published_at, created_at) DESC").all(authorId) as any[];
  const items = rows.map(communityFromRow);
  let uses = 0, favorites = 0;
  let joinedAt: number | null = null;
  for (const r of rows) {
    uses += r.uses || 0;
    favorites += r.favorites || 0;
    const t = r.published_at || r.created_at;
    if (typeof t === "number" && (joinedAt === null || t < joinedAt)) joinedAt = t;
  }
  const author = items.length ? items[0].author : "";
  return { author, items, totals: { uses, favorites, joinedAt } };
}

// =====================================================================
// 合集/专辑（C4，报告 #2）：用户把已公开社区模板收进命名合集，提升 UGC 组织与留存。
// 仅作者本人（或管理员）可改自己的合集（author_id 绑定，杜绝伪造）；合集本身公开可见。
// =====================================================================
export interface CollectionRow {
  id: string;
  authorId: string | null;
  author: string;
  title: string;
  description: string;
  createdAt: number;
  itemCount?: number;
}
export interface CollectionDetail extends CollectionRow {
  items: CommunityRow[];
}

function collectionFromRow(r: any): CollectionRow {
  return {
    id: r.id, authorId: r.author_id ?? null, author: r.author,
    title: r.title, description: r.description, createdAt: r.created_at,
  };
}

export function createCollection(rec: { authorId: string | null; author: string; title: string; description?: string }): CollectionRow {
  const id = "col" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = Date.now();
  db.prepare(
    `INSERT INTO collections(id,author_id,author,title,description,created_at) VALUES(?,?,?,?,?,?)`,
  ).run(id, rec.authorId ?? null, rec.author || "匿名", String(rec.title).slice(0, 120), String(rec.description || "").slice(0, 500), now);
  return getCollection(id)!;
}

export function getCollection(id: string): CollectionRow | null {
  const r = db.prepare("SELECT * FROM collections WHERE id = ?").get(id) as any;
  return r ? collectionFromRow(r) : null;
}

// 公开合集列表（按创建时间倒序，带成员数）
export function listCollections(opts: { limit?: number; offset?: number } = {}): CollectionRow[] {
  const limit = Math.min(200, Math.max(1, opts.limit || 50));
  const offset = Math.max(0, opts.offset || 0);
  const rows = db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
     FROM collections c ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
  ).all(limit, offset) as any[];
  return rows.map((r) => ({ ...collectionFromRow(r), itemCount: r.item_count || 0 }));
}

// 我的合集（按作者），供「加入合集」弹窗选择
export function listMyCollections(authorId: string): CollectionRow[] {
  if (!authorId) return [];
  const rows = db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
     FROM collections c WHERE c.author_id = ? ORDER BY c.created_at DESC`,
  ).all(authorId) as any[];
  return rows.map((r) => ({ ...collectionFromRow(r), itemCount: r.item_count || 0 }));
}

// 合集详情：元信息 + 成员模板（按 position）。仅返回已公开模板（下架的不展示）。
export function getCollectionWithItems(id: string): CollectionDetail | null {
  const col = getCollection(id);
  if (!col) return null;
  const itemRows = db.prepare(
    `SELECT cm.* FROM collection_items ci
     JOIN community cm ON cm.id = ci.item_id
     WHERE ci.collection_id = ? AND cm.status = 'published'
     ORDER BY ci.position ASC, ci.added_at ASC`,
  ).all(id) as any[];
  return { ...col, items: itemRows.map(communityFromRow) };
}

export function addCollectionItem(collectionId: string, itemId: string): boolean {
  const exists = db.prepare("SELECT 1 FROM collection_items WHERE collection_id = ? AND item_id = ?").get(collectionId, itemId);
  if (exists) return false;
  const pos = (db.prepare("SELECT COALESCE(MAX(position),0)+1 AS p FROM collection_items WHERE collection_id = ?").get(collectionId) as any).p;
  db.prepare("INSERT INTO collection_items(collection_id,item_id,position,added_at) VALUES(?,?,?,?)").run(collectionId, itemId, pos, Date.now());
  return true;
}

export function removeCollectionItem(collectionId: string, itemId: string): boolean {
  const r = db.prepare("DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?").run(collectionId, itemId);
  return (r as any).changes > 0;
}

// 校验合集归属：管理员或作者本人可改
export function isCollectionOwner(collectionId: string, authorId: string | null, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (!authorId) return false;
  const r = db.prepare("SELECT author_id FROM collections WHERE id = ?").get(collectionId) as any;
  return !!(r && r.author_id === authorId);
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
  email: string | null;
  createdAt: number;
  status: string;
}

export function createUser(username: string, passHash: string, salt: string, role = "user", email: string | null = null): UserRow {
  const id = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare("INSERT INTO users(id,username,pass_hash,salt,role,email,created_at,status) VALUES(?,?,?,?,?,?,?,'active')")
    .run(id, username, passHash, salt, role, email, Date.now());
  return getUserById(id)!;
}
export function getUserByUsername(username: string): (UserRow & { passHash: string; salt: string }) | null {
  const r = db.prepare("SELECT id,username,pass_hash,salt,role,email,created_at,status FROM users WHERE username = ?").get(username) as any;
  if (!r) return null;
  return { id: r.id, username: r.username, role: r.role, email: r.email ?? null, createdAt: r.created_at, status: r.status, passHash: r.pass_hash, salt: r.salt };
}
export function getUserByEmail(email: string): UserRow | null {
  const r = db.prepare("SELECT id,username,role,email,created_at,status FROM users WHERE email = ?").get(email.toLowerCase()) as any;
  if (!r) return null;
  return { id: r.id, username: r.username, role: r.role, email: r.email ?? null, createdAt: r.created_at, status: r.status };
}
export function emailExists(email: string): boolean {
  return !!db.prepare("SELECT 1 FROM users WHERE email = ?").get(email.toLowerCase());
}
export function getUserById(id: string): UserRow | null {
  const r = db.prepare("SELECT id,username,role,email,created_at,status FROM users WHERE id = ?").get(id) as any;
  if (!r) return null;
  return { id: r.id, username: r.username, role: r.role, email: r.email ?? null, createdAt: r.created_at, status: r.status };
}
export function userExists(username: string): boolean {
  return !!db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
}
export function listUsers(limit = 200): UserRow[] {
  const rows = db.prepare("SELECT id,username,role,email,created_at,status FROM users ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(1000, limit))) as any[];
  return rows.map((r: any) => ({ id: r.id, username: r.username, role: r.role, email: r.email ?? null, createdAt: r.created_at, status: r.status }));
}
export function deleteUser(id: string): void {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}
export function setUserRole(id: string, role: string): void {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}
export function updateUserPassword(id: string, passHash: string, salt: string): void {
  db.prepare("UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?").run(passHash, salt, id);
}

// 密码重置令牌：单次使用 + 时效。原始令牌只出现在邮件链接里，库里只存 SHA-256。
export function createResetToken(userId: string, tokenHash: string, expiresAt: number): void {
  const id = "pr" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.prepare("INSERT INTO password_resets(id,user_id,token_hash,expires_at,used,created_at) VALUES(?,?,?,?,0,?)")
    .run(id, userId, tokenHash, expiresAt, Date.now());
}
// 取一条「有效」令牌：存在 + 未使用 + 未过期。无效返回 null（不泄露是否存在）。
export function getValidResetToken(tokenHash: string): { userId: string } | null {
  const r = db.prepare("SELECT user_id, expires_at, used FROM password_resets WHERE token_hash = ?").get(tokenHash) as any;
  if (!r) return null;
  if (r.used) return null;
  if (Date.now() > r.expires_at) return null;
  return { userId: r.user_id };
}
export function consumeResetToken(tokenHash: string): void {
  db.prepare("UPDATE password_resets SET used = 1 WHERE token_hash = ?").run(tokenHash);
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
