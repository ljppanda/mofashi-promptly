// backup-scheduler.mjs — 数据库备份定时守护进程（纯 JavaScript，由 `node` 直接运行）。
//
// 用法：
//   node scripts/backup-scheduler.mjs
//   # 或在 Docker 启动命令里挂后台：
//   node scripts/backup-scheduler.mjs &   （建议再套一层 pm2 / tini 管理生命周期）
//   # 或干脆用系统 cron 替代本进程（见下）：
//   0 */6 * * *  cd /path/to/server && node scripts/backup.mjs
//
// 环境变量：
//   BACKUP_INTERVAL_MS  备份间隔毫秒（默认 6 小时 = 21600000）
//   BACKUP_KEEP         保留最近 N 份（默认 7，转发给 backup.mjs）
//
// 机制：
//   - 启动时先跑一次，之后按间隔循环执行 runBackup()。
//   - 用 data/.backup.lock 防多实例重叠：锁内记录 pid，若持有者仍存活则本次跳过；
//     若持有者进程已不存在（崩溃残留锁）则接管，避免死锁。
//   - 捕获 SIGTERM / SIGINT 优雅退出并释放锁。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBackup } from "./backup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const LOCK = path.join(DATA_DIR, ".backup.lock");
const INTERVAL = Math.max(60000, Number(process.env.BACKUP_INTERVAL_MS ?? 6 * 3600 * 1000));

function acquireLock() {
  try {
    if (fs.existsSync(LOCK)) {
      const pid = Number(fs.readFileSync(LOCK, "utf8").trim());
      let alive = false;
      if (pid) {
        try { process.kill(pid, 0); alive = true; } catch { alive = false; }
      }
      if (alive) {
        console.warn(`[backup-scheduler] 发现运行中实例 pid=${pid}，本次跳过`);
        return false;
      }
      console.warn(`[backup-scheduler] 发现过期锁 pid=${pid}，接管`);
    }
    fs.writeFileSync(LOCK, String(process.pid));
    return true;
  } catch (e) {
    console.warn(`[backup-scheduler] 加锁失败：${e?.message}`);
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.readFileSync(LOCK, "utf8").trim() === String(process.pid)) fs.unlinkSync(LOCK);
  } catch { /* ignore */ }
}

async function tick() {
  if (!acquireLock()) return;
  try {
    runBackup();
  } catch (e) {
    console.error(`[backup-scheduler] 备份失败：${e?.message || e}`);
  } finally {
    releaseLock();
  }
}

console.log(`[backup-scheduler] 启动：每 ${Math.round(INTERVAL / 1000)}s 备份一次（BACKUP_INTERVAL_MS 可调）`);
tick();
const timer = setInterval(tick, INTERVAL);

function shutdown() {
  clearInterval(timer);
  releaseLock();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
