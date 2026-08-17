// migrations.ts — 版本化 schema 迁移 runner（数据可靠性，P1 收尾）。
// 设计原则：
//  - 把所有建表 DDL 收敛到「基线 v1」迁移里（含兼容旧库的 ALTER），不再在 db.ts 散落 CREATE TABLE。
//  - 后续任何表结构变更，只需在此追加 v2 / v3 ... 的 up()，启动时自动按版本号补齐，绝不破坏老库。
//  - schema_migrations 表自身用 IF NOT EXISTS 自建，记录已应用的最高版本；幂等（重复运行安全）。

import { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "baseline_2026_07_29",
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS metrics(
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '其他',
        uses INTEGER NOT NULL DEFAULT 0,
        favorites INTEGER NOT NULL DEFAULT 0,
        rating_sum INTEGER NOT NULL DEFAULT 0,
        rating_count INTEGER NOT NULL DEFAULT 0
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS community(
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '其他',
        author TEXT NOT NULL DEFAULT '匿名',
        prompt TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at INTEGER NOT NULL,
        published_at INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        favorites INTEGER NOT NULL DEFAULT 0,
        rating_sum INTEGER NOT NULL DEFAULT 0,
        rating_count INTEGER NOT NULL DEFAULT 0
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      )`);
      // 兼容旧库：给 community 补 author_id 列（绑定发布者，杜绝作者名伪造 + 支持「我的发布」按用户过滤）
      try { db.exec("ALTER TABLE community ADD COLUMN author_id TEXT"); } catch { /* 已存在则忽略 */ }
      // 兼容旧库：给 community 补 cover 列（封面图链接 / data URL，轻量版封面方案，空串=无封面）
      try { db.exec("ALTER TABLE community ADD COLUMN cover TEXT"); } catch { /* 已存在则忽略 */ }
      db.exec(`CREATE TABLE IF NOT EXISTS reports(
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'   -- pending(待处理) | resolved(已下架) | dismissed(已忽略)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS moderation_log(
        id TEXT PRIMARY KEY,
        item_id TEXT,
        item_title TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,                    -- publish_draft | publish_public | publish_blocked | takedown
        safe INTEGER NOT NULL DEFAULT 1,
        engine TEXT,
        reasons TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS traces(
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        type TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        preview TEXT,
        latency_ms INTEGER,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        status TEXT,
        error TEXT,
        steps TEXT
      )`);
    },
  },
  {
    version: 2,
    name: "comments_2026_07_29",
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS comments(
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '匿名',
        author_id TEXT,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'visible'   -- visible | deleted
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_id, created_at)`);
    },
  },
  {
    version: 3,
    name: "traces_user_id_2026_07_30",
    up: (db) => {
      // 给 traces 补 user_id 列：记录调用者身份，支撑「用户只看自己的调用记录」（匿名留 NULL，仅管理员可见）
      try { db.exec("ALTER TABLE traces ADD COLUMN user_id TEXT"); } catch { /* 列已存在则忽略（幂等） */ }
    },
  },
  {
    version: 4,
    name: "email_and_password_reset_2026_07_30",
    up: (db) => {
      // 用户表加邮箱（用于标准邮箱重置密码链路）
      try { db.exec("ALTER TABLE users ADD COLUMN email TEXT"); } catch { /* 列已存在则忽略（幂等） */ }
      // 密码重置令牌表：单次使用 + 时效。token_hash 存 SHA-256，原始令牌只在邮件链接里出现一次。
      db.exec(`CREATE TABLE IF NOT EXISTS password_resets(
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pwreset_hash ON password_resets(token_hash)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_resets(user_id, created_at)`);
    },
  },
  // 未来变更在此追加，例如：
  // {
  //   version: 4,
  //   name: "add_community_flag",
  //   up: (db) => { db.exec("ALTER TABLE community ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0"); },
  // },
  {
    version: 5,
    name: "collections_2026_07_31",
    up: (db) => {
      // 合集/专辑（UGC 组织，对标 Snack Prompt 的 List）：用户把已发布社区模板收进命名合集。
      db.exec(`CREATE TABLE IF NOT EXISTS collections(
        id TEXT PRIMARY KEY,
        author_id TEXT,
        author TEXT NOT NULL DEFAULT '匿名',
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS collection_items(
        collection_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (collection_id, item_id)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_coll_items_coll ON collection_items(collection_id, position)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_coll_items_item ON collection_items(item_id)`);
    },
  },
  {
    version: 6,
    name: "community_cover_2026_08_04",
    up: (db) => {
      // 社区模板封面图（轻量版封面方案，报告 #1）：封面图链接 / data URL，空串=无封面。
      // 幂等 ALTER：已应用过（如全新库在 v1 基线已加）则忽略，避免破坏老库。
      try { db.exec("ALTER TABLE community ADD COLUMN cover TEXT"); } catch { /* 列已存在则忽略（幂等） */ }
    },
  },
  {
    version: 7,
    name: "community_version_2026_08_14",
    up: (db) => {
      // 社区模板版本徽标（报告 #7，对标 ProBazaar v3.0）：记录模板版本号，传递"持续更新"信号。
      // 幂等 ALTER：列已存在则忽略。全量回填 v1.0（种子与既有发布统一首发版本）。
      try { db.exec("ALTER TABLE community ADD COLUMN version TEXT"); } catch { /* 列已存在则忽略（幂等） */ }
      db.prepare("UPDATE community SET version='v1.0' WHERE version IS NULL OR version=''").run();
    },
  },
  {
    version: 8,
    name: "community_difficulty_2026_08_17",
    up: (db) => {
      // F35-③ 模板难度 / 适配层级元数据：difficulty(入门/进阶/专家) + recommend_model(推荐模型)。
      // 幂等 ALTER：列已存在则忽略。历史数据不设默认（NULL），由 communityFromRow 兜底为「入门」。
      try { db.exec("ALTER TABLE community ADD COLUMN difficulty TEXT"); } catch { /* 列已存在则忽略（幂等） */ }
      try { db.exec("ALTER TABLE community ADD COLUMN recommend_model TEXT"); } catch { /* 列已存在则忽略（幂等） */ }
    },
  },
];

// 应用所有「未应用」的迁移。返回实际执行了的迁移名（便于启动日志）。
export function runMigrations(db: DatabaseSync): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, version INTEGER NOT NULL, applied_at INTEGER NOT NULL)");
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null } | undefined;
  const applied = row?.v ?? 0;
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= applied) continue;
    db.exec("BEGIN");
    try {
      m.up(db);
      db.prepare("INSERT INTO schema_migrations(name,version,applied_at) VALUES(?,?,?)").run(m.name, m.version, Date.now());
      db.exec("COMMIT");
      ran.push(m.name);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return ran;
}

// 已应用的迁移版本列表（供测试 / 启动诊断）。
export function appliedVersions(db: DatabaseSync): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, version INTEGER NOT NULL, applied_at INTEGER NOT NULL)");
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>;
  return rows.map((r) => r.version);
}
