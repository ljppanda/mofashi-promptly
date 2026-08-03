#!/bin/sh
set -e
mkdir -p /app/server/data
if [ ! -f /app/server/data/templates.json ]; then
  cp /app/server/seed/templates.json /app/server/data/templates.json
fi
cd /app/server
# 备份定时化：后台启动调度器（启动即备份一次 + 按 BACKUP_INTERVAL_MS 周期循环，默认 6h），
# 主服务前台运行。备份脚本损坏不影响主服务启动；备份目录在 appdata 卷内已持久化。
node scripts/backup-scheduler.mjs &
exec npm start
