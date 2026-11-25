#!/usr/bin/env node
// backup-scheduler.mjs
// 轻量备份调度器：启动即备份一次，之后按 BACKUP_INTERVAL_MS 周期备份。
// 由 docker-entrypoint.sh 在后台拉起；即使本脚本失败也不影响主服务。
//
// 环境变量：
//   DATA_DIR             默认 <cwd>/data
//   BACKUP_DIR           默认 <DATA_DIR>/backups
//   BACKUP_INTERVAL_MS   默认 6h
//   BACKUP_KEEP          保留最近 N 份，默认 20
//
// 设计要点：
//   1. 先写临时文件再 rename，避免进程在写入中途被杀导致备份文件损坏；
//   2. 只备份用户数据（templates.json），不碰 seed；
//   3. 任何异常都只打日志、不退出，下一轮继续。

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, "backups"));
const INTERVAL_MS = Math.max(60_000, Number(process.env.BACKUP_INTERVAL_MS || 6 * 60 * 60 * 1000));
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 20));
const SOURCE = path.join(DATA_DIR, "templates.json");

function log(msg) {
  console.log(`[backup] ${new Date().toISOString()} ${msg}`);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function prune() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^templates-.*\.json$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      log(`pruned ${f}`);
    } catch (e) {
      log(`prune failed ${f}: ${e.message}`);
    }
  }
}

function backupOnce() {
  if (!fs.existsSync(SOURCE)) {
    log(`skip: ${SOURCE} not found`);
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `templates-${stamp()}.json`);
  const tmp = `${target}.tmp`;
  const data = fs.readFileSync(SOURCE);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
  log(`backup ok -> ${path.basename(target)} (${data.length} bytes)`);
  prune();
}

function loop() {
  try {
    backupOnce();
  } catch (e) {
    log(`backup failed: ${e.message}`);
  }
  const timer = setTimeout(loop, INTERVAL_MS);
  // 不要 unref：定时器就是本进程存活的原因，unref 会让后台备份进程立刻退出。
  void timer;
}
log(`scheduler started: source=${SOURCE} dir=${BACKUP_DIR} interval=${INTERVAL_MS}ms keep=${KEEP}`);
loop();

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    log(`received ${sig}, exiting`);
    process.exit(0);
  });
}
