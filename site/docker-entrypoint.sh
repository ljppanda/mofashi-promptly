#!/bin/sh
set -e
mkdir -p /app/server/data
if [ ! -f /app/server/data/templates.json ]; then
  cp /app/server/seed/templates.json /app/server/data/templates.json
fi
cd /app/server
exec npm start
