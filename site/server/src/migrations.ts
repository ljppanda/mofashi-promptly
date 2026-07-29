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
  // 未来变更在此追加，例如：
  // {
  //   version: 3,
  //   name: "add_community_flag",
  //   up: (db) => { db.exec("ALTER TABLE community ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0"); },
  // },
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
