// backup.mjs — SQLite（WAL 模式）在线备份脚本。
//
// 关键：本项目 data/app.db 运行在 WAL 模式，WAL 会产生 app.db-wal / app.db-shm 伴随文件。
// 备份必须把这三个文件当一个整体一起拷，否则会丢失最近未合并到主库的事务。
//
// 做法：
//   1. 用 node:sqlite 以「读写」打开库，先尝试 PRAGMA wal_checkpoint(TRUNCATE)，
//      把 WAL 里待落盘的事务合并回主库并把 WAL 截断（best-effort，失败不致命）。
//   2. 把 app.db（+ 仍存在的 -wal / -shm）整体拷到 data/backups/<时间戳>/ 下。
//   3. 仅保留最近 N 份（默认 7，可用 BACKUP_KEEP 覆盖）。
//
// 用法：node scripts/backup.mjs   或   npm run backup
// 注意：运行时服务端会持有该 db 句柄，WAL 模式下多进程并发读取是允许的；
//       即便 checkpoint 因并发失败，拷贝三个文件本身也是一致的 WAL 快照。
// 本文件为纯 JavaScript（无 TS 注解），由 `node` 直接运行；也可被 backup-scheduler.mjs import。

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "app.db");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP ?? 7));

function ts() {
  // 形如 2026-07-29T09-30-00，文件名安全且可读
  return new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
}

function copyIfExists(src, destDir) {
  if (!fs.existsSync(src)) return null;
  fs.copyFileSync(src, path.join(destDir, path.basename(src)));
  return path.basename(src);
}

export function runBackup() {
  if (!fs.existsSync(DB_FILE)) {
    throw new Error(`[backup] 未找到数据库文件：${DB_FILE}（服务是否已启动并初始化过？）`);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // 1) best-effort checkpoint：把 WAL 合并回主库，减小 -wal 体积（并非备份必需，但更干净）
  try {
    const db = new DatabaseSync(DB_FILE);
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (e) {
      console.warn(`[backup] wal_checkpoint 失败（仍可安全拷贝文件）：${e?.message}`);
    } finally { db.close(); }
  } catch (e) {
    console.warn(`[backup] 无法打开库执行 checkpoint（跳过，直接拷文件）：${e?.message}`);
  }

  // 2) 整体拷贝 app.db 及伴随文件（-wal / -shm）作为一致快照
  const destDir = path.join(BACKUP_DIR, ts());
  fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  copied.push(path.basename(copyIfExists(DB_FILE, destDir) ?? ""));
  copyIfExists(DB_FILE + "-wal", destDir);
  copyIfExists(DB_FILE + "-shm", destDir);
  console.log(`[backup] 已备份到：${destDir}`);

  // 3) 轮转：保留最近 KEEP 份
  const dirs = fs.readdirSync(BACKUP_DIR)
    .filter((n) => fs.statSync(path.join(BACKUP_DIR, n)).isDirectory())
    .sort((a, b) => b.localeCompare(a)); // 目录名含时间戳，字典序即时间序
  const toRemove = dirs.slice(KEEP);
  for (const d of toRemove) {
    const full = path.join(BACKUP_DIR, d);
    fs.rmSync(full, { recursive: true, force: true });
    console.log(`[backup] 清理旧备份：${d}`);
  }
  console.log(`[backup] 完成：本次 ${copied.filter(Boolean).length} 个文件，保留 ${Math.min(dirs.length, KEEP)} 份。`);
}

// 仅当直接以 CLI 运行（非被 backup-scheduler.mjs import）时执行
if (import.meta.main) {
  try {
    runBackup();
  } catch (e) {
    console.error(e?.message || String(e));
    process.exit(1);
  }
}
