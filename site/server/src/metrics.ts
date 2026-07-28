// metrics.ts — 持久化已于 M12 迁移到 db.ts（Node 内置 SQLite，单文件 data/app.db）。
// 本文件仅做转发，确保 index.ts 与前端无需任何改动。
export * from "./db.js";
