// tests/stats.test.ts
// T-03 后端聚合端点取数层回归测试（离线、零网络，全部走注入的 fetch 替身）。
// 覆盖 docs/dashboard_design.md §2 的 10 项：canonicalName 归并 / 逐字段判空 / max_groups 钳制 /
// path 字符串形态 / 空 {} 回退 / 错误率口径 / 总量=分组求和 / 关闭态零网络 / 429 退避 / 429-HTML 不崩。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalName, isNoise, isTelemetryRoot, isWhitelistedFlow, isLlmRunName,
  rangeToTimes, statusDistribution, errorRateOf, pendingRateOf,
  groupByBody, getStats, getStatsCached, _clearStatsCache,
  buildGroups, coerceGroupBy, VALID_GROUP_BYS,
  STATS_SELECT,
  type StatsDeps,
} from "../src/stats.js";

// ---------- 测试替身 ----------

interface Recorded { url: string; body: unknown; }

interface RespSpec { status?: number; contentType?: string; json?: unknown; raw?: string; }
type Responder = (ctx: { url: string; body: any; callIndex: number; statsIndex: number }) => RespSpec;

// 构造一个可编程的 fetch 替身。
// 支持两种模式：
//   - responses：按「stats 请求」与「query 请求」分别路由（因 Promise.all 并发，不能用单一队列）。
//   - responder：完全自定义（按 url+body 决定），用于需要精确控制每次响应的场景。
function makeDeps(opts: {
  enabled?: boolean;
  projectId?: string | null;
  // stats 请求按序返回：第 n 次 stats 命中 statsResponses[min(n, len-1)]
  statsResponses?: RespSpec[];
  // runs/query 固定返回
  queryResponse?: RespSpec;
  // 完全自定义（优先级最高）
  responder?: Responder;
}): { deps: StatsDeps; calls: Recorded[]; sleeps: number[]; statsCalls: () => Recorded[]; queryCalls: () => Recorded[] } {
  const calls: Recorded[] = [];
  const sleeps: number[] = [];
  let statsIndex = 0;
  const deps: StatsDeps = {
    enabled: opts.enabled ?? true,
    apiKey: "test-key",
    endpoint: "https://api.smith.langchain.com",
    project: "模法师-Promptly",
    ensureProject: async () => (opts.projectId === undefined ? "proj-uuid" : opts.projectId),
    fetchRaw: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      const callIndex = calls.length;
      calls.push({ url, body });

      let r: RespSpec;
      if (opts.responder) {
        r = opts.responder({ url, body, callIndex, statsIndex });
      } else if (url.endsWith("/api/v1/runs/query")) {
        r = opts.queryResponse ?? { json: { runs: [] } };
      } else {
        const arr = opts.statsResponses ?? [{ json: {} }];
        r = arr[Math.min(statsIndex, arr.length - 1)];
        statsIndex++;
      }
      const status = r.status ?? 200;
      const contentType = r.contentType ?? "application/json";
      let text: string;
      if (typeof r.raw === "string") text = r.raw;
      else text = JSON.stringify(r.json ?? {});
      return { status, contentType, text };
    },
    now: () => new Date("2026-02-10T12:00:00.000Z"),
    sleep: async (ms) => { sleeps.push(ms); },
  };
  return {
    deps, calls, sleeps,
    statsCalls: () => calls.filter((c) => c.url.endsWith("/api/v1/runs/stats")),
    queryCalls: () => calls.filter((c) => c.url.endsWith("/api/v1/runs/query")),
  };
}

// ---------- 1. canonicalName 归并（5 个碎名 + 别名） ----------

test("canonicalName: 实测 5 个碎名归并到同一键", () => {
  const expected = "deepseek·deepseek-chat·llm";
  assert.equal(canonicalName("deepseek·deepseek-chat·llm"), expected);
  assert.equal(canonicalName("DeepSeek·deepseek-chat·llm"), expected, "中文 label 首段应映射回 id");
  assert.equal(canonicalName("DeepSeek·deepseek-chat"), expected, "缺 ·llm 后缀应补齐");
  assert.equal(canonicalName("deepseek-chat·llm"), "deepseek-chat·llm", "无 provider 前缀仅保留 model（无法反推 provider）");
  assert.equal(canonicalName("DeepSeek·deepseek-chat·tool"), expected, "·tool 后缀应归一掉");
});

test("canonicalName: 序号后缀 #2 / #selfcheck 归一", () => {
  assert.equal(canonicalName("deepseek·deepseek-chat·llm#2"), "deepseek·deepseek-chat·llm");
  assert.equal(canonicalName("deepseek·deepseek-chat·llm#selfcheck"), "deepseek·deepseek-chat·llm");
});

test("canonicalName: 别名 Kimi→kimi、通义千问（阿里）→qwen", () => {
  assert.equal(canonicalName("Kimi·kimi-k2·llm"), "kimi·kimi-k2·llm");
  assert.equal(canonicalName("通义千问（阿里）·qwen-max·llm"), "qwen·qwen-max·llm");
});

test("canonicalName: flow 名（含 :）原样返回，不参与 provider·model 归并", () => {
  assert.equal(canonicalName("agent:generate"), "agent:generate");
  assert.equal(canonicalName("judge:eval"), "judge:eval");
});

// ---------- 白名单 / 噪声判定 ----------

test("isNoise: 探针噪声前缀命中", () => {
  assert.equal(isNoise("t01-probe:withTrace-metadata"), true);
  assert.equal(isNoise("withtrace-probe"), true);
  assert.equal(isNoise("hello-metadata"), true);
  assert.equal(isNoise("wt-123"), true);
  assert.equal(isNoise("agent:generate"), false);
});

test("isWhitelistedFlow / isLlmRunName: 区分 flow 名与 llm 名", () => {
  assert.equal(isWhitelistedFlow("agent:generate"), true);
  assert.equal(isWhitelistedFlow("judge:eval"), true);
  assert.equal(isWhitelistedFlow("deepseek·deepseek-chat·llm"), false);
  assert.equal(isLlmRunName("deepseek·deepseek-chat·llm"), true);
  assert.equal(isLlmRunName("deepseek·deepseek-chat·llm#2"), true);
  assert.equal(isLlmRunName("agent:generate"), false);
});

// ---------- 2. 逐字段判空鲁棒性 ----------

test("getStats: 某组 total_tokens:null 时不崩，同组其它字段仍可读", async () => {
  const { deps } = makeDeps({
    statsResponses: [
      { json: { "llm:run": { run_count: 3, total_tokens: null, latency_p50: 12.5, error_rate: 0 } } },
    ],
    queryResponse: { json: { runs: [] } },
  });
  const r = await getStats("7d", "name", deps);
  assert.equal(r.ok, true);
  const g = r.groups.find((x) => x.key === "llm:run");
  assert.ok(g);
  assert.equal(g!.stats.run_count, 3);
  assert.equal(g!.stats.total_tokens, null, "null 应保留为 null（不崩）");
  assert.equal(g!.stats.latency_p50, 12.5, "同组其它字段不受影响");
});

// ---------- 3. max_groups 钳制 ----------

test("groupByBody: max_groups 恒为 20（钳制上限）", () => {
  for (const gb of ["flow", "model", "run_type", "name"] as const) {
    assert.equal(groupByBody(gb).max_groups, 20);
  }
});

// ---------- 4. groupBy 形态（flow 直接 name；metadata 为可选增强） ----------

test("groupByBody: flow 视图直接走 name 分组（不再用 metadata path=flow，避免第 3 发被 429）", () => {
  const gb = groupByBody("flow");
  assert.equal(gb.attribute, "name", "flow 视图必须直接用 name 分组");
  assert.equal(gb.path, undefined, "flow 视图不应带 metadata path");
});

test("groupByBody: metadata 分组仍可用，path 是字符串（非数组，防 422）", () => {
  const gb = groupByBody("metadata");
  assert.equal(gb.attribute, "metadata");
  assert.equal(typeof gb.path, "string", "path 必须是 string（数组会 422）");
  assert.equal(gb.path, "flow");
});

test("groupByBody: model 走 name、run_type 走 run_type", () => {
  assert.equal(groupByBody("model").attribute, "name");
  assert.equal(groupByBody("run_type").attribute, "run_type");
});

test("getStats: groupBy=flow 时请求数恰好 2，且 group_by.attribute=name、max_groups=20", async () => {
  const { deps, calls, statsCalls, queryCalls } = makeDeps({
    statsResponses: [
      { json: { "agent:generate": { run_count: 1 } } },
    ],
    queryResponse: { json: { runs: [] } },
  });
  await getStats("7d", "flow", deps);
  assert.equal(statsCalls().length, 1, "flow 视图只发 1 次 stats 请求");
  assert.equal(queryCalls().length, 1, "另发 1 次 runs/query");
  assert.equal(calls.length, 2, "总计恰好 2 次请求（§2.9 预算）");
  const gb = (statsCalls()[0].body as { group_by: { attribute: string; path?: unknown; max_groups: number } }).group_by;
  assert.equal(gb.attribute, "name");
  assert.equal(gb.path, undefined);
  assert.equal(gb.max_groups, 20);
  // select 不含 run_facets / error_rate（§2.2）
  const sel = (statsCalls()[0].body as { select: string[] }).select;
  assert.ok(!sel.includes("run_facets"), "select 不应含 run_facets");
  assert.ok(!sel.includes("error_rate"), "select 不应含平台 error_rate");
});

// ---------- 5. flow 视图恒 2 请求（无回退重发） ----------

test("getStats: flow 视图无论返回空 {} 与否都只发 2 次请求（绝不换参重发第 3 次）", async () => {
  // ① 返回空 {} —— 旧设计在此会重发第 3 次（真机被 429 打死），新设计不重发。
  const empty = makeDeps({
    statsResponses: [{ json: {} }],
    queryResponse: { json: { runs: [] } },
  });
  const r1 = await getStats("7d", "flow", empty.deps);
  assert.equal(r1.ok, true);
  assert.equal(empty.statsCalls().length, 1, "空 {} 也不应重发（无第 3 次请求）");
  assert.equal(empty.calls.length, 2, "总计仍为 2 次请求");

  // ② 返回非空 —— 同样 2 次请求。
  const nonEmpty = makeDeps({
    statsResponses: [{ json: { "agent:generate": { run_count: 2 } } }],
    queryResponse: { json: { runs: [] } },
  });
  const r2 = await getStats("7d", "flow", nonEmpty.deps);
  assert.equal(r2.ok, true);
  assert.equal(nonEmpty.statsCalls().length, 1);
  assert.equal(nonEmpty.calls.length, 2);
});

test("getStats: flow 视图 warning 为中性描述（不再说「已回退」）", async () => {
  const { deps } = makeDeps({
    statsResponses: [{ json: { "agent:generate": { run_count: 1 } } }],
    queryResponse: { json: { runs: [] } },
  });
  const r = await getStats("7d", "flow", deps);
  assert.ok(r.warnings?.some((w) => w.includes("按 run 名归并")), "应给出中性 warning");
  assert.ok(!r.warnings?.some((w) => w.includes("回退")), "不应再出现「已回退」字样");
});

test("getStats: flow 视图对 name 分组结果归类（flow 名进主视图 + llm 名归一）", async () => {
  const { deps } = makeDeps({
    statsResponses: [
      {
        json: {
          "agent:generate": { run_count: 3 },
          "deepseek·deepseek-chat·llm": { run_count: 5, total_tokens: 100 },
        },
      },
    ],
    queryResponse: { json: { runs: [] } },
  });
  const r = await getStats("7d", "flow", deps);
  assert.ok(r.groups.some((g) => g.key === "agent:generate"), "flow 名应进主视图");
  assert.ok(r.groups.some((g) => g.key === "deepseek·deepseek-chat·llm"), "llm 名应归一进分组");
});

// ---------- 6. 错误率口径（排除 pending） ----------

test("errorRateOf: 分母排除 pending", () => {
  const dist = statusDistribution([
    { status: "success" }, { status: "success" }, { status: "error" }, { status: "pending" },
  ]);
  assert.deepEqual(dist, { success: 2, error: 1, pending: 1, total: 4 });
  assert.equal(errorRateOf(dist), 1 / 3, "error/(success+error)=1/3，pending 不计入分母");
  assert.equal(pendingRateOf(dist), 1 / 4, "未完成率=pending/全部");
});

test("errorRateOf: 分母为 0 时返回 null", () => {
  assert.equal(errorRateOf(statusDistribution([{ status: "pending" }])), null);
});

test("getStats: totals 用自算错误率（含 pending 时不含 pending）", async () => {
  const { deps } = makeDeps({
    statsResponses: [
      { json: { "agent:generate": { run_count: 3 } } },
    ],
    queryResponse: { json: { runs: [{ status: "success" }, { status: "success" }, { status: "error" }, { status: "pending" }] } },
  });
  const r = await getStats("7d", "flow", deps);
  assert.equal(r.totals.errorRate, 1 / 3);
  assert.equal(r.totals.pendingRate, 1 / 4);
  assert.equal(r.totals.rootRunCount, 4);
  // root 口径计数由后端直接给出
  assert.equal(r.totals.errorCount, 1);
  assert.equal(r.totals.pendingCount, 1);
  assert.equal(r.totals.successCount, 2);
});

// ---------- 6b. 计数用 root 口径（不是 round(runCount×rate)） ----------

test("getStats: 成功/失败/未完成计数为 root 口径，绝不用 runCount 反推", async () => {
  // 构造真机场景：runCount=21（含子 run 的分组求和）但 rootRunCount=17（status 分布来自根 run）。
  // 分组求和 = 21（两组合计），根 run 分布 = 13 success / 0 error / 4 pending。
  const runs = [
    ...Array.from({ length: 13 }, () => ({ status: "success" })),
    ...Array.from({ length: 4 }, () => ({ status: "pending" })),
  ];
  const { deps } = makeDeps({
    statsResponses: [
      { json: { "agent:generate": { run_count: 11 }, "deepseek·deepseek-chat·llm": { run_count: 10 } } },
    ],
    queryResponse: { json: { runs } },
  });
  const r = await getStats("7d", "flow", deps);
  assert.equal(r.totals.runCount, 21, "runCount = 分组求和 = 11+10");
  assert.equal(r.totals.rootRunCount, 17, "rootRunCount = 根 run 数");
  assert.equal(r.totals.errorCount, 0, "错误计数 = root 口径 0（旧口径 round(21*0)=0，此处靠 pending 区分）");
  assert.equal(r.totals.pendingCount, 4, "未完成 = root 口径 4（旧口径 round(21*(4/17))=5 ✗）");
  assert.equal(r.totals.successCount, 13, "成功 = root 口径 13（旧口径 21-0-5=16 ✗）");
  // 交叉验证：计数求和 = rootRunCount（root 口径自洽），且 ≠ runCount
  assert.equal(r.totals.errorCount + r.totals.pendingCount + r.totals.successCount, r.totals.rootRunCount);
  assert.notEqual(r.totals.rootRunCount, r.totals.runCount, "两口径确实不同");
});

// ---------- 7. 总量 = 分组求和（不是不分组请求） ----------

test("getStats: runCount = 分组求和；且不发不分组请求", async () => {
  const { deps, statsCalls } = makeDeps({
    statsResponses: [
      { json: { "agent:generate": { run_count: 3 }, "llm:run": { run_count: 4 } } },
    ],
    queryResponse: { json: { runs: [{ status: "success" }, { status: "success" }] } },
  });
  const r = await getStats("7d", "flow", deps);
  assert.equal(r.totals.runCount, 7, "总量应为分组求和 3+4=7（不是恒 100 的不分组假值）");
  // 不能出现「不分组 stats」——即所有 stats 请求都必须带 group_by
  for (const c of statsCalls()) {
    assert.ok((c.body as { group_by?: unknown }).group_by, "每个 stats 请求都必须带 group_by");
  }
});

// ---------- 8. 关闭态零网络 ----------

test("getStats: 关闭态（enabled=false）零 fetch 调用", async () => {
  const { deps, calls } = makeDeps({ enabled: false });
  const r = await getStats("7d", "flow", deps);
  assert.equal(r.ok, true);
  assert.equal(r.enabled, false);
  assert.equal(calls.length, 0, "关闭态必须零网络");
  assert.deepEqual(r.groups, []);
});

// ---------- 9. 429 → 退避重试 2 次后 partial ----------

test("getStats: stats 请求 429 → 退避 2 次后放弃，返回 partial:true", async () => {
  const { deps, sleeps } = makeDeps({
    statsResponses: [
      { status: 429, contentType: "text/html", raw: "<html>429</html>" }, // stats：恒 429（重试也用同 spec）
    ],
    queryResponse: { json: { runs: [{ status: "success" }] } }, // query：成功
  });
  const r = await getStats("7d", "flow", deps);
  assert.equal(r.ok, true, "部分成功仍 ok:true");
  assert.equal(r.partial, true, "stats 失败 → partial:true");
  assert.equal(sleeps.length, 2, "应退避 2 次（1000ms→3000ms）");
  assert.ok(sleeps[0] >= 800 && sleeps[0] <= 1200, "首次退避约 1000ms(±20%)");
  assert.ok(sleeps[1] >= 2400 && sleeps[1] <= 3600, "次次退避约 3000ms(±20%)");
});

// ---------- 10. 429 返回 HTML 时不抛异常 ----------

test("getStats: 429/HTML 响应体会被识别为限流，绝不抛 Unexpected token '<'", async () => {
  const { deps } = makeDeps({
    statsResponses: [{ status: 429, contentType: "text/html", raw: "<html><body>rate limited</body></html>" }],
    queryResponse: { status: 429, contentType: "text/html", raw: "<html>nope</html>" },
  });
  // 不该 reject；两者都失败 → ok:false 但不抛
  await assert.doesNotReject(async () => {
    const r = await getStats("7d", "flow", deps);
    assert.equal(r.ok, false);
    assert.equal(r.enabled, true);
  });
});

// ---------- range 换算 ----------

test("rangeToTimes: today 用本地 00:00；all 省略字段；7d/30d 减对应天数", () => {
  const now = new Date("2026-02-10T12:00:00.000Z");
  const today = rangeToTimes("today", now);
  assert.ok(today.start_time);
  const d = new Date(today.start_time!);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.deepEqual(rangeToTimes("all", now), {});
  const d7 = new Date(rangeToTimes("7d", now).start_time!);
  assert.equal(Math.round((now.getTime() - d7.getTime()) / 86400000), 7);
  const d30 = new Date(rangeToTimes("30d", now).start_time!);
  assert.equal(Math.round((now.getTime() - d30.getTime()) / 86400000), 30);
});

// ---------- groupBy / range 非法值回退 ----------

test("getStats: 非法 range/groupBy 回退默认（7d/flow）", async () => {
  const { deps } = makeDeps({
    statsResponses: [{ json: { "agent:generate": { run_count: 1 } } }],
    queryResponse: { json: { runs: [] } },
  });
  const r = await getStats("bogus", "bogus", deps);
  assert.equal(r.range, "7d");
  assert.equal(r.groupBy, "flow");
});

// ---------- 缓存 / in-flight ----------

test("getStatsCached: 30s 内同 key 命中缓存（第二次零 fetch）", async () => {
  _clearStatsCache();
  const { deps, calls } = makeDeps({
    statsResponses: [{ json: { "agent:generate": { run_count: 1 } } }],
    queryResponse: { json: { runs: [] } },
  });
  const r1 = await getStatsCached("7d", "flow", deps);
  const n1 = calls.length;
  const r2 = await getStatsCached("7d", "flow", deps);
  assert.equal(calls.length, n1, "第二次应命中缓存，零新增 fetch");
  assert.deepEqual(r1.groups, r2.groups);
});

test("STATS_SELECT: 保守清单（含主要标量，不含 run_facets）", () => {
  assert.ok(STATS_SELECT.includes("run_count"));
  assert.ok(STATS_SELECT.includes("total_tokens"));
  assert.ok(STATS_SELECT.includes("latency_p50"));
  assert.ok(!STATS_SELECT.includes("run_facets"));
});

// ---------- 真机 8 组名 → buildGroups 归类（flow 视图） ----------

test("buildGroups: 真机 8 组名 → 恰好 3 个 flow + 若干 llm，噪声不出现", () => {
  // 2026-09-18 真机 group_by=name（近 7 天）实测返回的 8 组。
  const raw = {
    "agent:refine": { run_count: 1, total_tokens: 120 },
    "judge:eval": { run_count: 2, total_tokens: 240 },
    "llm:chat": { run_count: 1, total_tokens: 100 },
    "deepseek·deepseek-chat·llm": { run_count: 9, total_tokens: 2300 },
    "deepseek-chat·llm": { run_count: 1, total_tokens: 300 },
    "DeepSeek·deepseek-chat·llm": { run_count: 2, total_tokens: 500 },
    "deepseek·deepseek-chat·attempt": { run_count: 3, total_tokens: 0 }, // 非 llm 名 → 丢弃
    "e2e-probe-root": { run_count: 1, total_tokens: 50 },                // 非白名单非 llm → 丢弃
  };
  const groups = buildGroups(raw, "flow");
  const keys = groups.map((g) => g.key);

  // 3 个 flow 名（白名单）进主视图
  assert.ok(keys.includes("agent:refine"), "agent:refine 应保留");
  assert.ok(keys.includes("judge:eval"), "judge:eval 应保留");
  assert.ok(keys.includes("llm:chat"), "llm:chat 应保留");

  // llm 名归一：deepseek·deepseek-chat·llm(9) + DeepSeek·…(2) 合并为 11；deepseek-chat·llm 独立
  assert.ok(keys.includes("deepseek·deepseek-chat·llm"), "llm 名应归一进分组");
  const dsGroup = groups.find((g) => g.key === "deepseek·deepseek-chat·llm")!;
  assert.equal(dsGroup.stats.run_count, 11, "两段 deepseek llm 名（9+2）应合并为 11");
  assert.ok(keys.includes("deepseek-chat·llm"), "无前缀 llm 名独立保留");

  // 噪声 / 非归类名不出现
  assert.ok(!keys.includes("deepseek·deepseek-chat·attempt"), "attempt 后缀非 llm 名应丢弃");
  assert.ok(!keys.includes("e2e-probe-root"), "非白名单非 llm 名应丢弃");

  // flow 视图产出的 flow 名恰好 3 个（含 ":" 的键）
  const flowKeys = keys.filter((k) => k.includes(":"));
  assert.equal(flowKeys.length, 3, "应恰好 3 个 flow 名");
});

// ---------- groupBy 收敛：model 等价于 flow，且不泄漏探针 ----------

test("coerceGroupBy: 非白名单值（model / run_type / 乱码）一律落到默认 flow", () => {
  assert.deepEqual([...VALID_GROUP_BYS], ["flow", "name"], "VALID_GROUP_BYS 应收敛为 flow/name");
  assert.equal(coerceGroupBy("model"), "flow", "已废弃的 model → flow");
  assert.equal(coerceGroupBy("run_type"), "flow", "已废弃的 run_type → flow");
  assert.equal(coerceGroupBy("bogus"), "flow", "乱码 → flow");
  assert.equal(coerceGroupBy("flow"), "flow");
  assert.equal(coerceGroupBy("name"), "name");
});

test("groupBy=model 与 groupBy=flow 结果逐字段一致，且不泄漏 e2e-probe-root / 大写 DeepSeek·", async () => {
  // 同一份「脏」分组数据：含探针、大写重复桶、attempt 子 run。
  const dirty = {
    "agent:refine": { run_count: 1, total_tokens: 120 },
    "deepseek·deepseek-chat·llm": { run_count: 9, total_tokens: 2300 },
    "DeepSeek·deepseek-chat·llm": { run_count: 2, total_tokens: 500 },
    "deepseek·deepseek-chat·attempt": { run_count: 3, total_tokens: 0 },
    "e2e-probe-root": { run_count: 1, total_tokens: 50 },
  };

  const mk = () => makeDeps({
    statsResponses: [{ json: dirty }],
    queryResponse: { json: { runs: [{ status: "success" }] } },
  });
  const dFlow = mk();
  const dModel = mk();
  const rFlow = await getStats("7d", "flow", dFlow.deps);
  const rModel = await getStats("7d", "model", dModel.deps);

  // 逐字段一致（groups + totals；generatedAt 是实时时间，不比）
  assert.deepEqual(rModel.groups, rFlow.groups, "model 与 flow 的 groups 应逐字段一致");
  assert.deepEqual(rModel.totals, rFlow.totals, "model 与 flow 的 totals 应逐字段一致");
  assert.equal(rModel.groupBy, "flow", "model 被归一为 flow");

  // 且都恰好发 2 次请求（model 不再走 else 分支）
  assert.equal(dModel.calls.length, 2, "model 视图同样只发 2 次请求");

  // 不泄漏探针 / 大写重复桶
  const keys = rModel.groups.map((g) => g.key);
  assert.ok(!keys.includes("e2e-probe-root"), "不得泄漏探针名");
  assert.ok(!keys.some((k) => k.startsWith("DeepSeek·")), "不得出现大写 DeepSeek· 重复桶");
  assert.ok(!keys.includes("deepseek·deepseek-chat·attempt"), "不得出现 attempt 子 run");
  assert.ok(keys.includes("deepseek·deepseek-chat·llm"), "小写 deepseek llm 名应归一保留");
});

// ---------- T-06：kind 标记 / 根 run 噪声过滤 / llmCallCount ----------

test("buildGroups: kind 标记——flow 名 → \"flow\"，llm 名 → \"llm\"", () => {
  const raw = {
    "agent:refine": { run_count: 1 },
    "judge:eval": { run_count: 2 },
    "llm:chat": { run_count: 1 },
    "deepseek·deepseek-chat·llm": { run_count: 9 },
    "DeepSeek·deepseek-chat·llm": { run_count: 2 }, // 归一后与上一行合并
    "deepseek-chat·llm": { run_count: 1 },
    "e2e-probe-root": { run_count: 1 },              // 噪声 → 过滤
  };
  const groups = buildGroups(raw, "flow");
  const kindOf = (k: string) => groups.find((g) => g.key === k)?.kind;

  assert.equal(kindOf("agent:refine"), "flow");
  assert.equal(kindOf("judge:eval"), "flow");
  assert.equal(kindOf("llm:chat"), "flow");
  assert.equal(kindOf("deepseek·deepseek-chat·llm"), "llm");
  assert.equal(kindOf("deepseek-chat·llm"), "llm");
  // 每个组都必须有 kind（不允许 undefined）
  assert.ok(groups.every((g) => g.kind === "flow" || g.kind === "llm"), "所有组都应有 kind");

  const flowGroups = groups.filter((g) => g.kind === "flow");
  const llmGroups = groups.filter((g) => g.kind === "llm");
  assert.equal(flowGroups.length, 3, "flow 组 3 个");
  assert.equal(llmGroups.length, 2, "llm 组 2 个");
});

test("getStats: llmCallCount = 仅 llm 组 run_count 之和（不含 flow 组）", async () => {
  const { deps } = makeDeps({
    statsResponses: [
      {
        json: {
          "agent:generate": { run_count: 7 },           // flow 组，不计入
          "deepseek·deepseek-chat·llm": { run_count: 9 }, // llm 组
          "deepseek-chat·llm": { run_count: 2 },          // llm 组
        },
      },
    ],
    queryResponse: { json: { runs: [{ status: "success" }] } },
  });
  const r = await getStats("7d", "flow", deps);
  assert.equal(r.totals.llmCallCount, 11, "llmCallCount = 9+2 = 11（不含 flow 组的 7）");
  assert.equal(r.totals.runCount, 18, "runCount 仍为分组求和 7+9+2");
});

// 真机场景复刻（T-06 验收）：17 条根 run 里 5 条探针，真实 12 条全 success。
const REAL_MACHINE_ROOT_RUNS = [
  ...Array.from({ length: 12 }, () => ({ name: "agent:refine", status: "success" })),
  { name: "t01-probe:withTrace-metadata", status: "pending" },
  { name: "t01-probe:withTrace-metadata", status: "pending" },
  { name: "t01-probe:withTrace-metadata", status: "pending" },
  { name: "withtrace-probe", status: "pending" },
  { name: "e2e-probe-root", status: "success" },
];
const REAL_MACHINE_GROUPS = {
  "agent:refine": { run_count: 1, total_tokens: 120 },
  "judge:eval": { run_count: 2, total_tokens: 240 },
  "llm:chat": { run_count: 1, total_tokens: 100 },
  "deepseek·deepseek-chat·llm": { run_count: 10, total_tokens: 2300 },
  "deepseek-chat·llm": { run_count: 1, total_tokens: 300 },
};

test("getStats(真机场景): 根 run 过滤噪声——rootRunCount=12，pendingRate=0（不再是 23.5%）", async () => {
  const { deps } = makeDeps({
    statsResponses: [{ json: REAL_MACHINE_GROUPS }],
    queryResponse: { json: { runs: REAL_MACHINE_ROOT_RUNS } },
  });
  const r = await getStats("7d", "flow", deps);

  // 噪声过滤：17 → 12（滤掉 5 条探针）
  assert.equal(r.totals.filteredNoiseCount, 5, "应过滤 5 条探针");
  assert.equal(r.totals.rootRunCount, 12, "过滤后根 run = 12");
  assert.equal(r.totals.successCount, 12, "12 条真实根 run 全 success");
  assert.equal(r.totals.errorCount, 0);
  assert.equal(r.totals.pendingCount, 0, "pending 全来自探针，过滤后为 0");

  // 错误率 / 未完成率 = 0（干净口径，不再是 23.5%）
  assert.equal(r.totals.errorRate, 0, "错误率 0");
  assert.equal(r.totals.pendingRate, 0, "未完成率 0（探针 23.5% 已消除）");

  // 自洽：rootRunCount === success+error+pending
  assert.equal(
    r.totals.successCount + r.totals.errorCount + r.totals.pendingCount,
    r.totals.rootRunCount,
    "计数必须与 rootRunCount 自洽",
  );

  // llmCallCount = 10 + 1 = 11
  assert.equal(r.totals.llmCallCount, 11, "大模型请求次数 = 11");

  // 分组：flow 3 个、llm 2 个、带 kind
  assert.equal(r.groups.filter((g) => g.kind === "flow").length, 3, "flow 组 3 个");
  assert.equal(r.groups.filter((g) => g.kind === "llm").length, 2, "llm 组 2 个");
  assert.ok(r.groups.every((g) => g.kind === "flow" || g.kind === "llm"));
  // 探针不出现在任何组
  assert.ok(!r.groups.some((g) => isNoise(g.key)), "分组不得含探针名");
});

test("getStats: e2e-probe-root 也被过滤（本轮新补的噪声前缀）", async () => {
  const { deps } = makeDeps({
    statsResponses: [{ json: { "agent:refine": { run_count: 1 } } }],
    queryResponse: { json: { runs: [
      { name: "agent:refine", status: "success" },
      { name: "e2e-probe-root", status: "error" }, // 若不过滤会把 errorRate 抬到 50%
    ] } },
  });
  const r = await getStats("7d", "flow", deps);
  assert.equal(r.totals.rootRunCount, 1);
  assert.equal(r.totals.filteredNoiseCount, 1);
  assert.equal(r.totals.errorRate, 0, "e2e-probe-root 的错误不应计入错误率");
});

test("getStats: 自洽断言——任何噪声/状态组合下 rootRunCount === success+error+pending", async () => {
  const { deps } = makeDeps({
    statsResponses: [{ json: { "agent:refine": { run_count: 5 } } }],
    queryResponse: { json: { runs: [
      { name: "agent:refine", status: "success" },
      { name: "agent:refine", status: "success" },
      { name: "judge:eval", status: "error" },
      { name: "judge:eval", status: "pending" },
      { name: "t01-probe:x", status: "pending" }, // 噪声
    ] } },
  });
  const r = await getStats("7d", "flow", deps);
  assert.equal(r.totals.rootRunCount, 4);
  assert.equal(r.totals.filteredNoiseCount, 1);
  assert.equal(r.totals.successCount + r.totals.errorCount + r.totals.pendingCount, r.totals.rootRunCount);
  assert.equal(r.totals.errorRate, 1 / 3, "error/(success+error)=1/3");
  assert.equal(r.totals.pendingRate, 1 / 4, "pending/全部=1/4");
});

// ---------- P0-4(a)：failover 重试遥测从「调用次数」排除 ----------

test("C1 [P0-4a]: 12 业务 + attempt(error) + failover(success) + 5 探针 → rootRunCount=12 / filteredNoiseCount=5 / errorRate=0", async () => {
  assert.equal(isTelemetryRoot("deepseek·deepseek-chat·attempt"), true);
  assert.equal(isTelemetryRoot("llm:failover"), true);
  assert.equal(isTelemetryRoot("deepseek·deepseek-chat·llm"), false, "·llm 子 run 是真实调用，不得排除");
  assert.equal(isTelemetryRoot("deepseek·deepseek-chat·tool"), false, "·tool 有 parent，不得排除");
  assert.equal(isTelemetryRoot("agent:refine"), false);

  const runs = [
    ...Array.from({ length: 12 }, () => ({ name: "agent:refine", status: "success" })),
    { name: "deepseek·deepseek-chat·attempt", status: "error" },
    { name: "llm:failover", status: "success" },
    { name: "t01-probe:withTrace-metadata", status: "pending" },
    { name: "t01-probe:withTrace-metadata", status: "pending" },
    { name: "t01-probe:withTrace-metadata", status: "pending" },
    { name: "withtrace-probe", status: "pending" },
    { name: "e2e-probe-root", status: "success" },
  ];
  const { deps } = makeDeps({
    statsResponses: [{ json: REAL_MACHINE_GROUPS }],
    queryResponse: { json: { runs } },
  });
  const r = await getStats("7d", "flow", deps);

  assert.equal(r.totals.rootRunCount, 12, "只数业务流程根 run");
  assert.equal(r.totals.filteredNoiseCount, 5, "提示条仍只数探针，语义与数字不变");
  assert.equal(r.totals.errorCount, 0, "失败 attempt 不得抬升错误计数");
  assert.equal(r.totals.errorRate, 0, "流程重试成功时，attempt 的 error 不得虚增错误率");
  assert.equal(r.totals.successCount, 12, "failover 的虚假 success 也不得抬高分母");
  assert.equal(r.totals.pendingRate, 0);
});

test("C2 [P0-4a]: llmCallCount 与改动前一致（=11），遥测记录不重复计数", async () => {
  // 基线：上方「真机场景」用例用同一份 REAL_MACHINE_GROUPS 已断言 llmCallCount = 10+1 = 11。
  // 在分组 stats 与根 run 两侧同时注入遥测名，验证它既不进 llmCallCount、也不进 rootRunCount。
  const dirtyGroups = {
    ...REAL_MACHINE_GROUPS,
    "deepseek·deepseek-chat·attempt": { run_count: 3, total_tokens: 0 },
    "llm:failover": { run_count: 1, total_tokens: 0 },
  };
  const runs = [
    ...REAL_MACHINE_ROOT_RUNS,
    { name: "deepseek·deepseek-chat·attempt", status: "error" },
    { name: "llm:failover", status: "success" },
  ];
  const { deps } = makeDeps({
    statsResponses: [{ json: dirtyGroups }],
    queryResponse: { json: { runs } },
  });
  const r = await getStats("7d", "flow", deps);

  assert.equal(r.totals.llmCallCount, 11, "与改动前数值相同：attempt 是同一次调用的重复记录，加了会双计");
  assert.equal(r.totals.rootRunCount, 12, "遥测根 run 不计入业务调用次数");
  assert.ok(!r.groups.some((g) => g.key.includes("attempt") || g.key === "llm:failover"), "分组层也不得出现遥测名");
});

test("C3 [P0-4a]: 含遥测样本时 rootRunCount === success+error+pending 恒等", async () => {
  const { deps } = makeDeps({
    statsResponses: [{ json: { "agent:refine": { run_count: 5 } } }],
    queryResponse: { json: { runs: [
      { name: "agent:refine", status: "success" },
      { name: "agent:refine", status: "success" },
      { name: "judge:eval", status: "error" },
      { name: "judge:eval", status: "pending" },
      { name: "t01-probe:x", status: "pending" },
      { name: "deepseek·deepseek-chat·attempt", status: "error" },
      { name: "llm:failover", status: "success" },
    ] } },
  });
  const r = await getStats("7d", "flow", deps);
  assert.equal(r.totals.rootRunCount, 4);
  assert.equal(r.totals.filteredNoiseCount, 1);
  assert.equal(r.totals.successCount + r.totals.errorCount + r.totals.pendingCount, r.totals.rootRunCount);
  assert.equal(r.totals.errorRate, 1 / 3, "遥测 error 排除后仍为 1/3");
  assert.equal(r.totals.pendingRate, 1 / 4);
});

test("C4 [P0-4a]: 未知/缺失 status 归入 pending，恒等式不破", async () => {
  const dist = statusDistribution([
    { status: "success" }, { status: "error" }, { status: "weird_state" }, {},
  ]);
  assert.deepEqual(dist, { success: 1, error: 1, pending: 2, total: 4 });
  assert.equal(dist.success + dist.error + dist.pending, dist.total);

  // 端到端：未知 status 的根 run 计入 pending，遥测仍被排除。
  const { deps } = makeDeps({
    statsResponses: [{ json: { "agent:refine": { run_count: 3 } } }],
    queryResponse: { json: { runs: [
      { name: "agent:refine", status: "success" },
      { name: "agent:refine", status: "unknown_state" },
      { name: "deepseek·deepseek-chat·attempt", status: "error" },
    ] } },
  });
  const r = await getStats("7d", "flow", deps);
  assert.equal(r.totals.rootRunCount, 2);
  assert.equal(r.totals.successCount, 1);
  assert.equal(r.totals.errorCount, 0, "遥测的 error 已排除");
  assert.equal(r.totals.pendingCount, 1, "未知 status 归入 pending");
  assert.equal(r.totals.successCount + r.totals.errorCount + r.totals.pendingCount, r.totals.rootRunCount);
  assert.equal(r.totals.pendingRate, 1 / 2);
});
