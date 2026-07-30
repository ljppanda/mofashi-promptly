// tests/community.test.ts
// 社区搜索 / 排序 / 行业筛选 的回归测试 + SQL 注入中性化验证。
// 每个用例用独立临时库（APP_DB_FILE + 动态 import 缓存隔离），不污染生产 data/app.db。

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

async function freshDb() {
  const f = path.join(os.tmpdir(), `mofashi_comm_${Math.random().toString(36).slice(2)}.db`);
  process.env.APP_DB_FILE = f;
  const mod = await import(`../src/db.js?v=${Math.random()}`);
  return { mod, file: f };
}

// WAL 模式下连接不关则文件被锁，无法删除；先 closeDb 再清理主库 + .db-wal/.db-shm 伴随文件。
function cleanup(mod: any, file: string) {
  try { mod.closeDb?.(); } catch { /* ignore */ }
  for (const p of [file, file + "-wal", file + "-shm"]) {
    try { fs.rmSync(p, { force: true }); } catch { /* 仍被锁则忽略，留在 tmp 无害 */ }
  }
}

function seed(mod: any, rows: { id: string; title: string; industry: string; prompt: string; tags: string[]; uses?: number; rating?: number }[]) {
  for (const r of rows) {
    mod.publishCommunity({ id: r.id, title: r.title, industry: r.industry, prompt: r.prompt, tags: r.tags });
    mod.publishNowCommunity(r.id);
    if (r.uses) mod.communityUse(r.id, r.uses);
    if (r.rating) mod.communityRate(r.id, r.rating, null);
  }
}

// 空库时 db.ts 会在导入阶段自动注入 8 条官方种子（id 以 seed- 开头）。排序类断言只关心
// 本测试夹具的相对顺序，故先剥离种子行，避免生产种子干扰测试不变量。
const stripSeeds = (arr: any[]) => arr.map((x: any) => x.id).filter((id: string) => !id.startsWith("seed-"));

// ---------------- 搜索 ----------------
test("community: 搜索 q 命中标题/正文/标签", async () => {
  const { mod, file } = await freshDb();
  try {
    seed(mod, [
      { id: "a", title: "番茄炒蛋菜谱生成器", industry: "生活/个人效率", prompt: "帮用户生成家常菜谱", tags: ["美食", "菜谱"] },
      { id: "b", title: "法律合同审查", industry: "法律", prompt: "审查租赁合同风险", tags: ["合同"] },
    ]);
    const hit = mod.listCommunity({ q: "菜谱" });
    assert.ok(hit.some((r: any) => r.id === "a"), "应命中标题含『菜谱』的 a");
    assert.ok(!hit.some((r: any) => r.id === "b"), "不应命中 b");
    const miss = mod.listCommunity({ q: "不存在的xyz关键词" });
    assert.equal(miss.length, 0, "无匹配应返回空");
  } finally {
    cleanup(mod, file);
  }
});

// ---------------- 行业筛选 ----------------
test("community: industry 筛选只返回同行业", async () => {
  const { mod, file } = await freshDb();
  try {
    seed(mod, [
      { id: "a", title: "菜谱A", industry: "生活/个人效率", prompt: "x", tags: [] },
      { id: "b", title: "合同B", industry: "法律", prompt: "y", tags: [] },
      { id: "c", title: "菜谱C", industry: "生活/个人效率", prompt: "z", tags: [] },
    ]);
    const r = mod.listCommunity({ industry: "生活/个人效率" });
    assert.equal(r.length, 2);
    assert.ok(r.every((x: any) => x.industry === "生活/个人效率"));
  } finally {
    cleanup(mod, file);
  }
});

// ---------------- 排序正确性 ----------------
test("community: rating 排序按平均分降序", async () => {
  const { mod, file } = await freshDb();
  try {
    seed(mod, [
      { id: "low", title: "低分", industry: "法律", prompt: "p", tags: [], rating: 1 },
      { id: "high", title: "高分", industry: "法律", prompt: "p", tags: [], rating: 5 },
      { id: "mid", title: "中分", industry: "法律", prompt: "p", tags: [], rating: 3 },
    ]);
    const r = mod.listCommunity({ sort: "rating" });
    assert.deepEqual(stripSeeds(r), ["high", "mid", "low"]);
  } finally {
    cleanup(mod, file);
  }
});

test("community: heat 排序按 使用+收藏*2+评分 降序", async () => {
  const { mod, file } = await freshDb();
  try {
    seed(mod, [
      { id: "cold", title: "冷", industry: "法律", prompt: "p", tags: [], uses: 1 },
      { id: "hot", title: "热", industry: "法律", prompt: "p", tags: [], uses: 10 },
      { id: "warm", title: "温", industry: "法律", prompt: "p", tags: [], uses: 5 },
    ]);
    const r = mod.listCommunity({ sort: "heat" });
    assert.deepEqual(stripSeeds(r), ["hot", "warm", "cold"]);
  } finally {
    cleanup(mod, file);
  }
});

// ---------------- SQL 注入中性化 ----------------
test("community: 注入式 q 被当作字面量，表结构不被破坏", async () => {
  const { mod, file } = await freshDb();
  try {
    seed(mod, [{ id: "a", title: "正常模板", industry: "法律", prompt: "p", tags: [] }]);
    // 带引号和注释的「注入」字符串应被 LIKE 当作普通文本，不执行、不报错
    const injected = mod.listCommunity({ q: "'; DROP TABLE community; --" });
    assert.equal(injected.length, 0, "注入串无字面匹配，返回空");
    // 关键：注入后表仍在，常规查询正常 → 证明参数化（未拼接 SQL）
    const after = mod.listCommunity({});
    assert.ok(after.some((r: any) => r.id === "a"), "注入后表完好、数据可读");
  } finally {
    cleanup(mod, file);
  }
});

test("community: 含 % 通配符的 q 不报错", async () => {
  const { mod, file } = await freshDb();
  try {
    seed(mod, [{ id: "a", title: "模板百分号%测试", industry: "法律", prompt: "p", tags: [] }]);
    const r = mod.listCommunity({ q: "百分号%" });
    assert.ok(Array.isArray(r), "含 % 的查询应正常返回数组");
  } finally {
    cleanup(mod, file);
  }
});
