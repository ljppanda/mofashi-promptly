// tests/trace.test.ts
// T01 上报基础设施回归测试（离线、零网络）。
// 守四件事：Usage→LangSmith 映射（含 total 兜底）、上报体校验、无 Key 时 no-op、emitTraceReport 调用形态。
// 单测绝不发网络请求：emitTraceReport 通过注入 deps 断言调用形态；no-op 用注入替身验证零上报。

import { test } from "node:test";
import assert from "node:assert/strict";
import { toUsageMetadata, toLsModelMetadata, parseTraceReport, emitTraceReport, PUBLIC_FLOWS, TRACE_FLOWS } from "../src/trace.js";
import type { TraceDeps, TraceCall } from "../src/trace.js";
import { LS_ENABLED, lsStart, lsEnd } from "../src/langsmith.js";

// ---------------- toUsageMetadata：字段映射与 total 兜底 ----------------

test("toUsageMetadata: 完整 Usage 逐字段映射", () => {
  const m = toUsageMetadata({
    inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreateTokens: 5, totalTokens: 165,
  });
  assert.ok(m);
  assert.equal(m!.input_tokens, 100);
  assert.equal(m!.output_tokens, 50);
  assert.equal(m!.total_tokens, 165);
  assert.deepEqual(m!.input_token_details, { cache_read: 10, cache_creation: 5 });
});

test("toUsageMetadata: total 缺失时用 input+output+cacheRead+cacheCreate 兜底", () => {
  const m = toUsageMetadata({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreateTokens: 5 });
  assert.ok(m);
  assert.equal(m!.total_tokens, 165, "total 应兜底为四项之和");
});

test("toUsageMetadata: totalTokens=0 视为缺失，走兜底（不返回 0）", () => {
  const m = toUsageMetadata({ inputTokens: 7, outputTokens: 3, totalTokens: 0 });
  assert.ok(m);
  assert.equal(m!.total_tokens, 10);
});

test("toUsageMetadata: undefined / 非对象返回 undefined（无则略）", () => {
  assert.equal(toUsageMetadata(undefined), undefined);
  assert.equal(toUsageMetadata(null as unknown as undefined), undefined);
});

test("toLsModelMetadata: 恒写 ls_provider / ls_model_type / ls_model_name（成本估算必需）", () => {
  assert.deepEqual(
    toLsModelMetadata("deepseek", "deepseek-chat"),
    { ls_provider: "deepseek", ls_model_type: "chat", ls_model_name: "deepseek-chat" },
  );
});

// ---------------- parseTraceReport：合法 / 非法输入 ----------------

test("parseTraceReport: 合法上报体规范化（保留白名单字段，丢弃多余字段）", () => {
  const rep = parseTraceReport({
    flow: "llm:run",
    label: "被测模型",
    metadata: { industry: "餐饮" },
    extra: "should-be-dropped",
    calls: [
      { provider: "deepseek", model: "deepseek-chat", usage: { inputTokens: 10, outputTokens: 20 }, elapsedMs: 1234, junk: 1 },
    ],
  });
  assert.ok(rep);
  assert.equal(rep!.flow, "llm:run");
  assert.equal(rep!.label, "被测模型");
  assert.deepEqual(rep!.metadata, { industry: "餐饮" });
  assert.equal(rep!.calls.length, 1);
  assert.equal(rep!.calls[0].provider, "deepseek");
  assert.equal(rep!.calls[0].model, "deepseek-chat");
  assert.equal(rep!.calls[0].usage?.inputTokens, 10);
  assert.equal(rep!.calls[0].elapsedMs, 1234);
  assert.equal((rep as unknown as Record<string, unknown>).extra, undefined, "多余顶层字段应被丢弃");
  assert.equal((rep!.calls[0] as unknown as Record<string, unknown>).junk, undefined, "多余 call 字段应被丢弃");
});

test("parseTraceReport: 非白名单 flow 返回 null", () => {
  assert.equal(parseTraceReport({ flow: "hack:whatever", calls: [{ provider: "a", model: "b" }] }), null);
});

test("parseTraceReport: 默认白名单为 PUBLIC_FLOWS，agent:* 走端点应被拒", () => {
  // 端点收窄白名单：agent:* 不在 PUBLIC_FLOWS，默认调用应拒绝。
  assert.equal(parseTraceReport({ flow: "agent:generate", calls: [{ provider: "a", model: "b" }] }), null);
  assert.equal(parseTraceReport({ flow: "agent:refine", calls: [{ provider: "a", model: "b" }] }), null);
  // PUBLIC_FLOWS 仅含 9 个前端流程，不含 agent:*。
  assert.equal(PUBLIC_FLOWS.length, 9);
  assert.ok(!PUBLIC_FLOWS.includes("agent:generate"));
});

test("parseTraceReport: 显式传 TRACE_FLOWS 时 agent:* 被接受（后端内部复用）", () => {
  const rep = parseTraceReport(
    { flow: "agent:generate", calls: [{ provider: "deepseek", model: "deepseek-chat" }] },
    TRACE_FLOWS,
  );
  assert.ok(rep);
  assert.equal(rep!.flow, "agent:generate");
  // TRACE_FLOWS = PUBLIC_FLOWS + 4 个 agent 流程名。
  assert.equal(TRACE_FLOWS.length, PUBLIC_FLOWS.length + 4);
  // 收窄白名单仍覆盖 llm:* / judge:eval。
  assert.ok(TRACE_FLOWS.includes("judge:eval") && TRACE_FLOWS.includes("llm:chat"));
});

test("parseTraceReport: 缺 flow 返回 null", () => {
  assert.equal(parseTraceReport({ calls: [{ provider: "a", model: "b" }] }), null);
});

test("parseTraceReport: calls 为空数组返回 null", () => {
  assert.equal(parseTraceReport({ flow: "llm:run", calls: [] }), null);
});

test("parseTraceReport: calls 非数组返回 null", () => {
  assert.equal(parseTraceReport({ flow: "llm:run", calls: "nope" }), null);
});

test("parseTraceReport: call 缺 provider / model 返回 null", () => {
  assert.equal(parseTraceReport({ flow: "llm:run", calls: [{ model: "b" }] }), null);
  assert.equal(parseTraceReport({ flow: "llm:run", calls: [{ provider: "a" }] }), null);
  assert.equal(parseTraceReport({ flow: "llm:run", calls: [{ provider: "  ", model: "b" }] }), null);
});

test("parseTraceReport: raw 非对象返回 null", () => {
  assert.equal(parseTraceReport(null), null);
  assert.equal(parseTraceReport("x"), null);
  assert.equal(parseTraceReport([1, 2]), null);
});

test("parseTraceReport: usage 非数字字段被忽略，不留 undefined 键", () => {
  const rep = parseTraceReport({
    flow: "llm:chat",
    calls: [{ provider: "a", model: "b", usage: { inputTokens: "x" as unknown as number, outputTokens: 5 } }],
  });
  assert.ok(rep);
  const u = rep!.calls[0].usage;
  assert.ok(u);
  assert.equal(u!.outputTokens, 5);
  assert.equal(u!.inputTokens, undefined, "非数字 inputTokens 不应写入");
});

// ---------------- 负数防护（端点不信任输入） ----------------

test("toUsageMetadata: 负数 token 一律归 0（防污染平台统计 / 负成本）", () => {
  const m = toUsageMetadata({ inputTokens: -5, outputTokens: -3, cacheReadTokens: -2, cacheCreateTokens: -1, totalTokens: -8 });
  assert.ok(m);
  assert.equal(m!.input_tokens, 0);
  assert.equal(m!.output_tokens, 0);
  assert.equal(m!.total_tokens, 0);
  assert.deepEqual(m!.input_token_details, { cache_read: 0, cache_creation: 0 });
});

test("toUsageMetadata: 负 total 视为缺失 → 走正数加法兜底", () => {
  const m = toUsageMetadata({ inputTokens: 100, outputTokens: 50, totalTokens: -8 });
  assert.ok(m);
  assert.equal(m!.total_tokens, 150, "负数 total 应归 0 后走加法兜底，得 100+50=150");
});

test("toUsageMetadata: 单个负数 input 归 0，其余字段保留", () => {
  const m = toUsageMetadata({ inputTokens: -5, outputTokens: 7, totalTokens: 2 });
  assert.ok(m);
  assert.equal(m!.input_tokens, 0);
  assert.equal(m!.output_tokens, 7);
  assert.equal(m!.total_tokens, 2);
});

test("parseTraceReport: 负数 usage 在解析层即归一为 0", () => {
  const rep = parseTraceReport({
    flow: "llm:run",
    calls: [{ provider: "a", model: "b", usage: { inputTokens: -5, outputTokens: -3, totalTokens: -8 } }],
  });
  assert.ok(rep);
  assert.deepEqual(rep!.calls[0].usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
});

test("parseTraceReport: elapsedMs 负数保留（展示字段，不拦）", () => {
  const rep = parseTraceReport({ flow: "llm:run", calls: [{ provider: "a", model: "b", elapsedMs: -123 }] });
  assert.ok(rep);
  assert.equal(rep!.calls[0].elapsedMs, -123, "elapsedMs 仅影响展示，按取舍不拦负数");
});

// ---------------- 无 Key 时 no-op（零网络、零开销） ----------------

test("langsmith: 无 Key 时 LS_ENABLED=false 且 lsStart 返回 null 零网络", async () => {
  // 测试环境不设 LANGSMITH_API_KEY，且不设 LANGSMITH_ENABLED → 应判为关闭。
  if (process.env.LANGSMITH_API_KEY === undefined && process.env.LANGSMITH_ENABLED === undefined) {
    assert.equal(LS_ENABLED, false, "无 Key 且无显式开关应为关闭");
    const id = await lsStart("x", "chain", {});
    assert.equal(id, null, "关闭时 lsStart 必须返回 null");
    await lsEnd(null, { outputs: {} }); // 不应抛错
    await lsEnd("some-id", { outputs: {} }); // 关闭时即使有 id 也应静默 no-op
  }
});

// ---------------- emitTraceReport：注入 deps 断言调用形态 ----------------

test("emitTraceReport: 构造 1 父 chain + 每 call 1 子 llm，usage/lsModelMetadata 正确", async () => {
  const starts: Array<{ name: string; runType: string; parent: string | null | undefined }> = [];
  const ends: Array<{ id: string | null; usage?: unknown; lsModelMetadata?: unknown }> = [];

  const deps: TraceDeps = {
    lsStart: async (name, runType, _inputs, parentRunId) => {
      starts.push({ name, runType, parent: parentRunId });
      return `run-${starts.length}`;
    },
    lsEnd: async (id, opts) => {
      ends.push({ id, usage: opts?.usage, lsModelMetadata: opts?.lsModelMetadata });
    },
  };

  const calls: TraceCall[] = [
    { provider: "deepseek", model: "deepseek-chat", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } },
    { provider: "openai", model: "gpt-4o", usage: { inputTokens: 5, outputTokens: 7 } },
  ];
  await emitTraceReport({ flow: "judge:eval", label: "裁判模型", calls }, deps);

  // 1 父 + 2 子 = 3 次 lsStart
  assert.equal(starts.length, 3, "应为 1 父 chain + 2 子 llm");
  assert.equal(starts[0].name, "judge:eval");
  assert.equal(starts[0].runType, "chain");
  assert.equal(starts[0].parent, undefined, "父 run 无 parent");
  assert.equal(starts[1].runType, "llm");
  assert.equal(starts[1].parent, "run-1", "子 run 的 parent 应指向父 run id");
  assert.equal(starts[2].parent, "run-1");

  // 子 run 的 lsEnd 应带上 usage 与 ls_* 模型元数据。
  // 结束顺序：先子（child1→child2），最后父。
  assert.equal(ends.length, 3, "父 + 2 子各一次 lsEnd");
  assert.ok(ends[0].usage, "子 llm run 应带 usage");
  assert.deepEqual(ends[0].lsModelMetadata, { ls_provider: "deepseek", ls_model_type: "chat", ls_model_name: "deepseek-chat" });
  assert.deepEqual(ends[1].lsModelMetadata, { ls_provider: "openai", ls_model_type: "chat", ls_model_name: "gpt-4o" });
  // 最后一次 lsEnd 是父 run
  assert.equal(ends[2].id, "run-1", "父 run 最后结束");
  assert.equal(ends[2].usage, undefined, "父 chain run 不应带 usage");
});

test("emitTraceReport: 父 chain run 的 metadata 落 flow（= rep.flow，供看板按 metadata 聚合）", async () => {
  const starts: Array<{ name: string; runType: string; metadata?: Record<string, unknown> }> = [];
  const deps: TraceDeps = {
    lsStart: async (name, runType, _inputs, _parent, metadata) => {
      starts.push({ name, runType, metadata });
      return `run-${starts.length}`;
    },
    lsEnd: async () => { /* noop */ },
  };
  await emitTraceReport({ flow: "llm:run", label: "被测模型", metadata: { industry: "餐饮" }, calls: [{ provider: "a", model: "b" }] }, deps);
  // 父 run = 第 1 次 lsStart；其 metadata 应含 flow 且保留原有键
  assert.equal(starts[0].runType, "chain");
  assert.equal(starts[0].metadata?.flow, "llm:run", "父 run metadata.flow 必须等于 rep.flow");
  assert.equal(starts[0].metadata?.industry, "餐饮", "原有 metadata 键应保留");
});

test("emitTraceReport: deps.lsStart 抛异常时静默不抛出", async () => {
  const deps: TraceDeps = {
    lsStart: async () => { throw new Error("network down"); },
    lsEnd: async () => { /* noop */ },
  };
  await assert.doesNotReject(
    emitTraceReport({ flow: "llm:chat", calls: [{ provider: "a", model: "b" }] }, deps),
    "埋点异常必须被吞掉",
  );
});

test("emitTraceReport: 关闭态（无 deps 注入且无 Key）不抛错", async () => {
  // 无 Key 环境下默认 deps 的 lsStart 返回 null，应全程静默。
  if (process.env.LANGSMITH_API_KEY === undefined && process.env.LANGSMITH_ENABLED === undefined) {
    await assert.doesNotReject(emitTraceReport({ flow: "llm:chat", calls: [{ provider: "a", model: "b" }] }));
  }
});
