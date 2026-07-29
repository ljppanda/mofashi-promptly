// 探针：用与 site/src/llm.ts 的 listModels 完全一致的逻辑，对全部厂商 /models 端点发一次 GET，
// 报告每家：沙箱能否到达、是否需要鉴权(401/403)、以及若有返回的真实模型 ID 样本。
// 说明：本机无 API Key（Key 在用户浏览器 localStorage），故多数厂商会 401/403；
// 本探针目的是验证 listModels 的“端点/解析/优雅兜底”逻辑是否对准真实 API，而非拿到真实清单。

const PROVIDERS = {
  openai:     { label: "OpenAI",            style: "openai", base: "https://api.openai.com/v1" },
  deepseek:   { label: "DeepSeek",          style: "openai", base: "https://api.deepseek.com/v1" },
  moonshot:   { label: "Kimi（月之暗面）",   style: "openai", base: "https://api.moonshot.cn/v1" },
  zhipu:      { label: "智谱 GLM",          style: "openai", base: "https://open.bigmodel.cn/api/paas/v4" },
  qwen:       { label: "通义千问（阿里）",   style: "openai", base: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  doubao:     { label: "豆包（字节）",       style: "openai", base: "https://ark.cn-beijing.volcesengine.com/api/v3" },
  hunyuan:    { label: "腾讯混元",          style: "openai", base: "https://api.hunyuan.cloud.tencent.com/v1" },
  baichuan:   { label: "百川",              style: "openai", base: "https://api.baichuan-ai.com/v1" },
  yi:         { label: "零一万物 Yi",       style: "openai", base: "https://api.lingyiwanwu.com/v1" },
  grok:       { label: "Grok（xAI）",       style: "openai", base: "https://api.x.ai/v1" },
  mistral:    { label: "Mistral",           style: "openai", base: "https://api.mistral.ai/v1" },
  ollama:     { label: "Ollama（本机）",     style: "openai", base: "http://localhost:11434/v1" },
  openrouter: { label: "OpenRouter（聚合）", style: "openai", base: "https://openrouter.ai/api/v1" },
  groq:       { label: "Groq",              style: "openai", base: "https://api.groq.com/openai/v1" },
  perplexity: { label: "Perplexity",        style: "openai", base: "https://api.perplexity.ai" },
  together:   { label: "Together AI",       style: "openai", base: "https://api.together.xyz/v1" },
  claude:     { label: "Claude（Anthropic）", style: "claude", base: "https://api.anthropic.com/v1" },
  gemini:     { label: "Gemini（Google）",   style: "gemini", base: "https://generativelanguage.googleapis.com/v1beta" },
  // ernie 无公开 /models 列表，跳过
};

function buildReq(p, key) {
  if (p.style === "gemini") {
    return { url: p.base + "/models?key=" + encodeURIComponent(key || ""), headers: { "content-type": "application/json" } };
  } else if (p.style === "claude") {
    return { url: p.base + "/models", headers: { "x-api-key": key || "", "anthropic-version": "2023-06-01", "content-type": "application/json" } };
  }
  return { url: p.base + "/models", headers: { "authorization": "Bearer " + (key || ""), "content-type": "application/json" } };
}

async function probe(name, p) {
  const { url, headers } = buildReq(p, ""); // 无 Key，模拟离线/未配置场景
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { method: "GET", headers, signal: ctrl.signal });
    let info = "";
    let ids = [];
    try {
      const j = await r.json();
      if (p.style === "gemini") ids = (j.models || []).map(m => String(m.name || "").replace(/^models\//, "")).filter(Boolean);
      else ids = (j.data || []).map(m => m.id).filter(Boolean);
    } catch (e) {}
    if (ids.length) info = "样本: " + ids.slice(0, 6).join(", ") + (ids.length > 6 ? ` …(共${ids.length})` : "");
    else if (r.status === 401 || r.status === 403) info = "需鉴权(返回" + r.status + ")，填 Key 后可拉取";
    else if (r.status === 200) info = "200 但无 models 字段";
    else info = "HTTP " + r.status;
    return { name, label: p.label, status: r.status, host: new URL(url).host, info };
  } catch (e) {
    const msg = e.name === "AbortError" ? "超时(8s)" : (e.cause && e.cause.code) ? e.cause.code : e.message;
    return { name, label: p.label, status: "ERR", host: new URL(url).host, info: "沙箱不可达: " + msg };
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  console.log("=== 厂商 /models 端点探针（无 Key，验证 listModels 逻辑与可达性）===\n");
  const rows = [];
  for (const [name, p] of Object.entries(PROVIDERS)) rows.push(await probe(name, p));
  // 表格输出
  const w = [10, 20, 8, 26, 40];
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(pad("provider", w[0]) + pad("label", w[1]) + pad("status", w[2]) + pad("host", w[3]) + "info");
  console.log("-".repeat(w.reduce((a, b) => a + b, 0) + 4));
  for (const r of rows) console.log(pad(r.name, w[0]) + pad(r.label, w[1]) + pad(r.status, w[2]) + pad(r.host, w[3]) + r.info);
  const reachable = rows.filter(r => r.status !== "ERR").length;
  const authNeeded = rows.filter(r => r.status === 401 || r.status === 403).length;
  const open = rows.filter(r => r.status === 200).length;
  console.log("\n汇总: 可达" + reachable + "/18, 需鉴权" + authNeeded + ", 公开可拉" + open + ", 沙箱不可达" + (rows.length - reachable));
  console.log("结论: 真实模型清单需在“用户浏览器(含 Key)”里点 🔄 拉取；本机无 Key 仅能验证端点/兜底逻辑。");
})();
