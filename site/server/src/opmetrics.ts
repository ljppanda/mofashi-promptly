// opmetrics.ts — 运行时运营指标（内存计数器，重启清零）。
// 与 db.ts 的「榜单指标（uses/favorites/rating）」和 traces 表（单次调用留痕）是不同维度：
//   - 这里关注「多 LLM 服务的健康度」：各家 provider 的成功率 / 延迟、整体生成成功率、RAG 命中率。
// 设计：纯内存、零依赖、零外部调用；指标聚合可对接 /ops/metrics 端点或日志告警。
// 为什么是内存而非持久化：运营指标的价值在「近期趋势」，重启清零可接受；持久化趋势交给 traces 表 + 外部日志/Metrics 系统。

interface ProviderStat {
  attempts: number;
  success: number;
  totalLatencyMs: number;
  lastError: string | null;
  lastErrorAt: number | null;
}

const providers = new Map<string, ProviderStat>();
const generation = { attempts: 0, success: 0 };
const rag = { queries: 0, hits: 0 };
const failovers = { attempts: 0, success: 0 };

function keyOf(provider: string, model: string): string {
  return `${provider}::${model}`;
}

export function recordProviderAttempt(provider: string, model: string, ok: boolean, latencyMs: number, error?: string): void {
  const k = keyOf(provider, model);
  let s = providers.get(k);
  if (!s) { s = { attempts: 0, success: 0, totalLatencyMs: 0, lastError: null, lastErrorAt: null }; providers.set(k, s); }
  s.attempts += 1;
  if (ok) s.success += 1;
  else { s.lastError = (error || "unknown").slice(0, 200); s.lastErrorAt = Date.now(); }
  s.totalLatencyMs += Math.max(0, latencyMs);
}

export function recordProviderLatency(provider: string, model: string, latencyMs: number): void {
  const s = providers.get(keyOf(provider, model));
  if (s) s.totalLatencyMs += Math.max(0, latencyMs);
}

export function recordGeneration(ok: boolean): void {
  generation.attempts += 1;
  if (ok) generation.success += 1;
}

export function recordRag(queries: number, hits: number): void {
  rag.queries += queries;
  rag.hits += hits;
}

export function recordFailover(ok: boolean): void {
  failovers.attempts += 1;
  if (ok) failovers.success += 1;
}

export interface ProviderSnapshot {
  provider: string;
  model: string;
  attempts: number;
  success: number;
  successRate: number; // 0~1
  avgLatencyMs: number;
  lastError: string | null;
  lastErrorAt: number | null;
}

export interface MetricsSnapshot {
  providers: ProviderSnapshot[];
  generation: { attempts: number; success: number; successRate: number };
  rag: { queries: number; hits: number; hitRate: number };
  failover: { attempts: number; success: number; successRate: number };
  uptimeMs: number;
  generatedAt: number;
}

const startedAt = Date.now();

export function snapshot(): MetricsSnapshot {
  const provs: ProviderSnapshot[] = [];
  for (const [k, s] of providers) {
    const [provider, model] = k.split("::");
    provs.push({
      provider,
      model,
      attempts: s.attempts,
      success: s.success,
      successRate: s.attempts ? s.success / s.attempts : 1,
      avgLatencyMs: s.attempts ? Math.round(s.totalLatencyMs / s.attempts) : 0,
      lastError: s.lastError,
      lastErrorAt: s.lastErrorAt,
    });
  }
  provs.sort((a, b) => (b.attempts - a.attempts) || a.provider.localeCompare(b.provider));
  const genRate = generation.attempts ? generation.success / generation.attempts : 1;
  const ragRate = rag.queries ? rag.hits / rag.queries : 0;
  const foRate = failovers.attempts ? failovers.success / failovers.attempts : 0;
  return {
    providers: provs,
    generation: { attempts: generation.attempts, success: generation.success, successRate: genRate },
    rag: { queries: rag.queries, hits: rag.hits, hitRate: ragRate },
    failover: { attempts: failovers.attempts, success: failovers.success, successRate: foRate },
    uptimeMs: Date.now() - startedAt,
    generatedAt: Date.now(),
  };
}

// 仅供测试：清空所有计数器。
export function _resetForTest(): void {
  providers.clear();
  generation.attempts = 0; generation.success = 0;
  rag.queries = 0; rag.hits = 0;
  failovers.attempts = 0; failovers.success = 0;
}
