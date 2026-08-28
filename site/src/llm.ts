// LLM 调用：用户自带 Key，前端直连（v1 零后端）
// 支持多家服务商；具体模型由用户在「设置」中自选或自定义填写。
import { Store } from "./store.js";
export const LLM = (function () {
  // style 决定 HTTP 调用方式：openai / claude / gemini / ernie
  // 模型清单基于 2026-07 各厂商在役最新版核查；具体 ID 以厂商控制台为准，
  // 用户也可在「设置」用「自定义模型名」直接填任意 ID（不受此清单限制）。
  const PROVIDERS = {
    openai:    { label: "OpenAI",            style: "openai", base: "https://api.openai.com/v1",
                 models: ["gpt-5.6", "gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano",
                          "gpt-5.3-codex", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-pro",
                          "o3", "o3-pro", "gpt-oss-120b", "gpt-oss-20b"],
                 default: "gpt-5.5",
                 note: "gpt-5.x 为现役主力，gpt-4o/4.1 仍可用；gpt-5.6 为 2026-07 旗舰，gpt-oss 为开放权重" },

    deepseek:  { label: "DeepSeek",          style: "openai", base: "https://api.deepseek.com/v1",
                 models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v3.2", "deepseek-r1-0528", "deepseek-chat"],
                 default: "deepseek-v4-flash",
                 note: "deepseek-chat / deepseek-reasoner 已于 2026-07-24 退役，请改用 v4 系列" },

    moonshot:  { label: "Kimi（月之暗面）",   style: "openai", base: "https://api.moonshot.cn/v1",
                 models: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6", "kimi-k2.5", "kimi-k2"],
                 default: "kimi-k2.6" },

    zhipu:     { label: "智谱 GLM",          style: "openai", base: "https://open.bigmodel.cn/api/paas/v4",
                 models: ["glm-5.1", "glm-5", "glm-5-turbo", "glm-4.7-flash", "glm-4.6", "glm-4-flash"],
                 default: "glm-4.7-flash",
                 note: "glm-4.7-flash 永久免费；glm-5.1 为最新旗舰" },

    qwen:      { label: "通义千问（阿里）",   style: "openai", base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                 models: ["qwen3.6-plus", "qwen3-max", "qwen3-plus", "qwen-plus", "qwen-max", "qwen-turbo", "qwen-long", "qwen3-72b-instruct"],
                 default: "qwen-plus" },

    doubao:    { label: "豆包（字节）",       style: "openai", base: "https://ark.cn-beijing.volcesengine.com/api/v3",
                 models: ["doubao-seed-2.0", "doubao-pro-32k", "doubao-pro-128k", "doubao-lite-32k"],
                 default: "doubao-seed-2.0",
                 note: "豆包需在火山方舟控制台创建推理接入点，模型名填该接入点的 Endpoint ID" },

    hunyuan:   { label: "腾讯混元",          style: "openai", base: "https://api.hunyuan.cloud.tencent.com/v1",
                 models: ["hy3-preview", "hunyuan-a13b-instruct", "hunyuan-role-latest", "hunyuan-turbo", "hunyuan-pro", "hunyuan-standard", "hunyuan-lite"],
                 default: "hy3-preview",
                 note: "hy3-preview 为 2026-04 新发开源 MoE 旗舰" },

    baichuan:  { label: "百川",              style: "openai", base: "https://api.baichuan-ai.com/v1",
                 models: ["baichuan-5-turbo", "baichuan-4"], default: "baichuan-5-turbo",
                 note: "baichuan-5-turbo 为 2026-05 新发搜索增强推理旗舰" },

    yi:        { label: "零一万物 Yi",       style: "openai", base: "https://api.lingyiwanwu.com/v1",
                 models: ["yi-2-large", "yi-large", "yi-medium", "yi-spark"], default: "yi-2-large" },

    grok:      { label: "Grok（xAI）",       style: "openai", base: "https://api.x.ai/v1",
                 models: ["grok-4.5", "grok-4.3", "grok-4.20", "grok-4.20-multi-agent"], default: "grok-4.5",
                 note: "grok-4.5 为稳定默认；grok-4.20 为最新旗舰（2026-07）" },

    mistral:   { label: "Mistral",           style: "openai", base: "https://api.mistral.ai/v1",
                 models: ["mistral-large-latest", "mistral-small-latest"], default: "mistral-small-latest" },

    ollama:    { label: "Ollama（本机）",     style: "openai", base: "http://localhost:11434/v1",
                 models: ["llama3.3", "qwen3", "deepseek-r1", "gpt-oss-120b"], default: "llama3.3",
                 note: "本机需先 ollama pull 对应模型并运行 ollama serve" },

    openrouter: { label: "OpenRouter（聚合）", style: "openai", base: "https://openrouter.ai/api/v1",
                 models: ["openai/gpt-5.5", "anthropic/claude-fable-5", "google/gemini-3.5-flash", "deepseek/deepseek-v4-flash",
                          "meta-llama/llama-4-maverick", "moonshotai/kimi-k2"], default: "openai/gpt-5.5",
                 note: "聚合上百家模型，模型名见控制台；也可直接填任意 openrouter 模型 ID" },

    groq:      { label: "Groq",              style: "openai", base: "https://api.groq.com/openai/v1",
                 models: ["llama-4-maverick", "llama-4-scout", "llama-3.3-70b-versatile", "kimi-k2-instruct", "qwen3-32b"],
                 default: "llama-3.3-70b-versatile" },

    perplexity:{ label: "Perplexity",        style: "openai", base: "https://api.perplexity.ai",
                 models: ["sonar", "sonar-pro", "sonar-reasoning"], default: "sonar" },

    together:  { label: "Together AI",       style: "openai", base: "https://api.together.xyz/v1",
                 models: ["deepseek-ai/DeepSeek-V3", "meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
                 default: "deepseek-ai/DeepSeek-V3",
                 note: "模型名见 Together 控制台，可填任意在架模型 ID" },

    claude:    { label: "Claude（Anthropic）", style: "claude", base: "https://api.anthropic.com/v1",
                 models: ["claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-opus-4.8", "claude-sonnet-4.6", "claude-haiku-4.5"],
                 default: "claude-sonnet-4.6",
                 note: "Claude 3.x 全退役；claude-opus-5 为 2026 旗舰，claude-sonnet-4.6 为均衡默认（模型名用点号，如 claude-sonnet-4.6）" },

    gemini:    { label: "Gemini（Google）",   style: "gemini", base: "https://generativelanguage.googleapis.com/v1beta",
                 models: ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-2.5-flash"],
                 default: "gemini-3.5-flash",
                 note: "gemini-3 系列多为 preview；gemini-3.5-flash 为 2026-05 稳定版，gemini-3.6-flash 为最新" },

    ernie:     { label: "文心一言（百度）",   style: "ernie", base: "https://aip.baidubce.com",
                 models: ["ernie-4.5-8k", "ernie-4.0-8k", "ernie-3.5-8k", "ernie-speed-8k", "ernie-lite-8k"],
                 default: "ernie-4.5-8k", needSecret: true }
  };

  function cfg() {
    const s = Store.getSettings();
    // 兼容旧设置：若没有 provider 但有 model(旧 provider key)，当作 provider
    let providerKey = s.provider || (PROVIDERS[s.model] ? s.model : "openai");
    const p = PROVIDERS[providerKey] || PROVIDERS.openai;
    const model = (s.customModel && s.customModel.trim()) || s.model || p.default;
    return { key: s.key, secret: s.secret, style: p.style, base: p.base, model, provider: providerKey, providerLabel: p.label };
  }

  // 解析最终配置：若传入表单覆盖参数(over)且 provider 合法，则用之；否则回退已保存设置
  function resolveCfg(over?) {
    if (over && over.provider && PROVIDERS[over.provider]) {
      const p = PROVIDERS[over.provider];
      const model = (over.customModel && over.customModel.trim()) || over.model || p.default;
      // key/secret 缺失时回退当前已保存设置：同厂商覆盖（如优化闭环指定裁判模型）无需重复填 Key 即生效；跨厂商仍按需报「未配置 Key」
      const cur = cfg();
      return { key: over.key ?? cur.key, secret: over.secret ?? cur.secret, style: p.style, base: p.base, model, provider: over.provider, providerLabel: p.label };
    }
    return cfg();
  }

  function effectiveLabel(over?) {
    const c = resolveCfg(over);
    return c.providerLabel + " · " + c.model;
  }

  // 测试连接时也需要“当前生效”标签（可能基于未保存的表单）
  function labelOf(over?) {
    const c = resolveCfg(over);
    return c.providerLabel + " · " + c.model;
  }

  // 统一请求入口：代理开关 ON 时把请求转发到本地/部署的代理（/relay），避免浏览器跨域、隐藏 Key
  // signal 用于流式中断（停止生成）
  async function relayFetch(url, method, headers, body, signal?) {
    const s = Store.getSettings();
    const base = (s.proxyBase && String(s.proxyBase).trim()) ? String(s.proxyBase).trim().replace(/\/$/, "") : "";
    if (s.useProxy && base) {
      return fetch(base + "/relay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, method, headers, body: body === undefined ? null : body }),
        signal
      });
    }
    return fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
      signal
    });
  }

  // 归一化 usage 为统一结构：{inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens, totalTokens}
  function normUsage(u) {
    u = u || {};
    return {
      inputTokens: u.inputTokens || u.prompt_tokens || 0,
      outputTokens: u.outputTokens || u.completion_tokens || 0,
      cacheReadTokens: u.cacheReadTokens || u.cache_read_input_tokens || (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0,
      cacheCreateTokens: u.cacheCreateTokens || u.cache_creation_input_tokens || 0,
      totalTokens: u.totalTokens || u.total_tokens || 0
    };
  }

  async function callChat(system, user, over?) {
    const c = resolveCfg(over);
    if (!c.key) throw new Error("未配置 API Key，请先到「设置」页填写。");

    if (c.style === "claude") {
      const url = c.base + "/messages";
      const headers = { "x-api-key": c.key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
      const body = { model: c.model, max_tokens: 1500, system, messages: [{ role: "user", content: user }] };
      const r = await relayFetch(url, "POST", headers, body);
      if (!r.ok) { const t = await r.text(); throw new Error("API 错误 " + r.status + "：" + t.slice(0, 200)); }
      const j = await r.json();
      return j.content && j.content[0] && j.content[0].text;
    }

    if (c.style === "gemini") {
      const url = c.base + "/models/" + encodeURIComponent(c.model) + ":generateContent?key=" + encodeURIComponent(c.key);
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
      };
      const r = await relayFetch(url, "POST", { "content-type": "application/json" }, body);
      if (!r.ok) { const t = await r.text(); throw new Error("API 错误 " + r.status + "：" + t.slice(0, 200)); }
      const j = await r.json();
      const txt = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
      if (!txt) throw new Error("Gemini 未返回文本：" + JSON.stringify(j).slice(0, 200));
      return txt;
    }

    if (c.style === "ernie") {
      if (!c.secret) throw new Error("该服务商需要同时填写 API Key 和 API Secret。");
      const tokUrl = c.base + "/oauth/2.0/token?grant_type=client_credentials&client_id=" +
        encodeURIComponent(c.key) + "&client_secret=" + encodeURIComponent(c.secret);
      const tokRes = await relayFetch(tokUrl, "POST", { "content-type": "application/json" }, null);
      const tokJson = await tokRes.json();
      if (!tokJson.access_token) throw new Error("获取百度 access_token 失败：" + (tokJson.error_description || tokJson.error || "未知"));
      const url = c.base + "/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/" + encodeURIComponent(c.model) + "?access_token=" + tokJson.access_token;
      const body = { messages: [{ role: "user", content: user }], system, temperature: 0.7 };
      const r = await relayFetch(url, "POST", { "content-type": "application/json" }, body);
      if (!r.ok) { const t = await r.text(); throw new Error("API 错误 " + r.status + "：" + t.slice(0, 200)); }
      const j = await r.json();
      return j.result;
    }

    // openai 兼容（多数国内/海外厂商）
    const url = c.base + "/chat/completions";
    const headers = { "authorization": "Bearer " + c.key, "content-type": "application/json" };
    const body = { model: c.model, temperature: 0.7, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
    const r = await relayFetch(url, "POST", headers, body);
    if (!r.ok) { const t = await r.text(); throw new Error("API 错误 " + r.status + "：" + t.slice(0, 200)); }
    const j = await r.json();
    return j.choices && j.choices[0].message.content;
  }

  // ---------- 流式输出 ----------
  // 读取 SSE：逐行回调（去除 data: 前缀由调用方处理）；signal 用于中断
  async function readSSE(r, onLine, signal) {
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        if (signal && signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) onLine(line);
          if (signal && signal.aborted) break;
        }
        if (signal && signal.aborted) break;
      }
    } catch (e) {
      if (!(signal && signal.aborted)) throw e; // 中断不算错误
    } finally {
      try { await reader.cancel(); } catch (e) {}
    }
  }

  // OpenAI 兼容（含文心，已换取 token）的流式解析；返回 {text, usage}
  async function streamOpenAI(url, headers, body, onToken, signal) {
    if (typeof onToken !== "function") onToken = () => {}; // 防空：F13 评测等场景会传 null
    body.stream_options = { include_usage: true }; // 让末块带上 usage
    const r = await relayFetch(url, "POST", headers, body, signal);
    if (!r.ok) { const t = await r.text(); throw new Error("API 错误 " + r.status + "：" + t.slice(0, 200)); }
    let full = "";
    let usage = null;
    await readSSE(r, line => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const j = JSON.parse(data);
        const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (d) { full += d; onToken(d, false); }
        if (j.usage) usage = normUsage(j.usage);
      } catch (e) {}
    }, signal);
    onToken("", true);
    return { text: full, usage };
  }

  // Claude 流式：usage 分散在 message_start / message_delta
  async function streamClaude(url, headers, body, onToken, signal) {
    if (typeof onToken !== "function") onToken = () => {}; // 防空：F13 评测等场景会传 null
    const r = await relayFetch(url, "POST", headers, body, signal);
    if (!r.ok) { const t = await r.text(); throw new Error("API 错误 " + r.status + "：" + t.slice(0, 200)); }
    let full = "";
    let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, totalTokens: 0 };
    await readSSE(r, line => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      try {
        const j = JSON.parse(data);
        if (j.type === "content_block_delta" && j.delta && j.delta.type === "text_delta" && j.delta.text) {
          full += j.delta.text; onToken(j.delta.text, false);
        } else if (j.type === "message_start" && j.usage) {
          usage.inputTokens = j.usage.input_tokens || 0;
          usage.cacheReadTokens = j.usage.cache_read_input_tokens || 0;
          usage.cacheCreateTokens = j.usage.cache_creation_input_tokens || 0;
        } else if (j.type === "message_delta" && j.usage) {
          usage.outputTokens = j.usage.output_tokens || 0;
        }
      } catch (e) {}
    }, signal);
    onToken("", true);
    return { text: full, usage };
  }

  // Gemini 流式：usageMetadata 随块返回
  async function streamGemini(url, body, onToken, signal) {
    if (typeof onToken !== "function") onToken = () => {}; // 防空：F13 评测等场景会传 null
    const r = await relayFetch(url, "POST", { "content-type": "application/json" }, body, signal);
    if (!r.ok) { const t = await r.text(); throw new Error("API 错误 " + r.status + "：" + t.slice(0, 200)); }
    let full = "";
    let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, totalTokens: 0 };
    await readSSE(r, line => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      try {
        const j = JSON.parse(data);
        const txt = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
        if (txt) { full += txt; onToken(txt, false); }
        const um = j.usageMetadata;
        if (um) {
          usage.inputTokens = um.promptTokenCount || 0;
          usage.outputTokens = um.candidatesTokenCount || 0;
          usage.totalTokens = um.totalTokenCount || 0;
        }
      } catch (e) {}
    }, signal);
    onToken("", true);
    return { text: full, usage };
  }

  // 流式对话：逐 token 回调 onToken(chunk, isDone)；返回 {text, usage, elapsedMs}
  async function callChatStream(system, user, onToken, over?, signal?) {
    const c = resolveCfg(over);
    if (!c.key) throw new Error("未配置 API Key，请先到「设置」页填写。");
    // 归一化 onToken：F13 评测 / 部分调用会传 null，下游 stream* 无条件调用 onToken 需防空
    if (typeof onToken !== "function") onToken = () => {};
    const start = Date.now();
    let res;
    if (c.style === "claude") {
      const url = c.base + "/messages";
      const headers = { "x-api-key": c.key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
      const body = { model: c.model, max_tokens: 1500, system, stream: true, messages: [{ role: "user", content: user }] };
      res = await streamClaude(url, headers, body, onToken, signal);
    } else if (c.style === "gemini") {
      const url = c.base + "/models/" + encodeURIComponent(c.model) + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(c.key);
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
      };
      res = await streamGemini(url, body, onToken, signal);
    } else if (c.style === "ernie") {
      if (!c.secret) throw new Error("该服务商需要同时填写 API Key 和 API Secret。");
      const tokUrl = c.base + "/oauth/2.0/token?grant_type=client_credentials&client_id=" +
        encodeURIComponent(c.key) + "&client_secret=" + encodeURIComponent(c.secret);
      const tokRes = await relayFetch(tokUrl, "POST", { "content-type": "application/json" }, null, signal);
      const tokJson = await tokRes.json();
      if (!tokJson.access_token) throw new Error("获取百度 access_token 失败：" + (tokJson.error_description || tokJson.error || "未知"));
      const url = c.base + "/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/" + encodeURIComponent(c.model) + "?access_token=" + tokJson.access_token;
      const body = { messages: [{ role: "user", content: user }], system, temperature: 0.7, stream: true };
      res = await streamOpenAI(url, { "content-type": "application/json" }, body, onToken, signal);
    } else {
      const url = c.base + "/chat/completions";
      const headers = { "authorization": "Bearer " + c.key, "content-type": "application/json" };
      const body = { model: c.model, temperature: 0.7, stream: true, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
      res = await streamOpenAI(url, headers, body, onToken, signal);
    }
    return { text: res.text, usage: res.usage, elapsedMs: Date.now() - start };
  }

  function extractJSON(text) {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a === -1 || b === -1) throw new Error("模型未返回合法 JSON");
    const slice = text.slice(a, b + 1);
    try { return JSON.parse(slice); } catch (err) {
      // 兜底：模型偶发输出未转义控制字符（真实换行/回车等，JSON.parse 抛 Bad control character），
      // 清洗掉非法控制字符后重试一次；仍失败则抛原错误。
      const cleaned = slice.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
      try { return JSON.parse(cleaned); } catch {
        throw err;
      }
    }
  }

  // F1：一句话 + 行业 -> 模板草稿（onToken 可选，传入则流式）；signal 用于中断
  // 生产级骨架（v2）：prompt 字段自带 角色/背景/目标/约束/工作流/输出规范/边界/自检 章节。
  // 返回 { tpl, usage, elapsedMs }
  async function generateTemplate(industry, sentence, onToken, signal) {
    const system = `你是一个提示词模板生成器。根据用户给出的“行业”和“一句话需求”，返回一个 JSON 对象，且 industry 字段必须等于用户指定的行业。
字段：
- title: 模板标题（简短，中文含动词）
- industry: 必须等于用户指定的行业
- task: 任务名
- summary: 一句中文说明这个模板解决什么、产出什么
- variables: 数组，每个 { name(英文snake_case), label(中文), type(select|multiselect|textarea|text), options?(数组，select/multiselect 必填), required(布尔), placeholder?(可选) }
- prompt: 模板正文，用 {{变量name}} 占位。prompt 必须是一个【生产级提示词骨架】，严格按以下章节组织，每节写出该领域【具体、可操作】的占位内容（不要只写小标题，要示范怎么写）：
# 角色与背景
你是{{...}}，[具体身份/资历/立场/能力边界]
# 目标
- 本次要解决的核心问题
- 成功产出的标准
# 核心约束与禁止项
- 必须遵循的原则
- 禁止做的事（如：不编造事实/不越权/专业结论需标注局限）
# 工作流
1. 接收并理解{{关键输入}}
2. 分析/推理步骤
3. 组织产出
# 输出规范
- 结构（分节/表格/列表）
- 格式与示例
- 语气与长度
# 边界与兜底
- 信息不足时如何追问或声明
- 超出能力范围时如何处置
# 自检
- 产出前核对清单（是否覆盖目标/守约束/格式正确）
只输出 JSON，不要解释。`;
    const user = `行业：${industry}\n需求：${sentence}`;
    let text, usage = null, elapsedMs = 0;
    if (onToken) {
      const r = await callChatStream(system, user, onToken, null, signal);
      text = r.text; usage = r.usage; elapsedMs = r.elapsedMs;
    } else {
      text = await callChat(system, user);
    }
    const obj = extractJSON(text);
    obj.slug = "gen-" + Date.now();
    obj.generated = true;
    return { tpl: obj, usage, elapsedMs };
  }

  // 生产级自检：对照生产级清单批判并改写一次，逼近人工优化效果。
  // 非流式（在首稿流式结束后静默执行），返回改写后的完整提示词；失败回退原稿。
  async function prodSelfCheck(prompt, goal, signal) {
    const sys = `你是提示词质量审查员。对照【生产级提示词清单】审查给定提示词：①角色与背景是否具体（身份/资历/立场/能力边界）②目标是否明确可量化③是否有核心约束与禁止项④是否有工作流⑤输出规范是否含格式示例⑥是否有边界与兜底⑦是否有自检清单。找出缺失或薄弱项，然后直接输出【改写后的完整生产级提示词全文】。只输出提示词正文，不要解释、不要代码块围栏、开头不要写"以下是…"。`;
    const user = `用户原始目标：${goal}\n\n待审查提示词：\n${prompt}\n\n请批判并输出改写后的完整提示词：`;
    try {
      const r = await callChatStream(sys, user, null, null, signal);
      const t = (r.text || "").trim();
      return t || prompt;
    } catch (e) {
      return prompt;
    }
  }

  // F2：用模板生成成品提示词（模型代写，用户只给目标）。无 RAG 直连回退用。
  // 生产级（v2）：角色/背景/目标→约束与护栏→工作流→输出规范(含示例)→边界兜底→自检。
  // selfCheck=true 时，首稿流式结束后静默批判改写一次，逼近人工优化效果（多一次调用）。
  // 返回 { prompt, usage, elapsedMs, sources }
  // onStage(步骤key) 透出当前阶段，供前端把「直连兜底路径」也渲染成实时时间线（消除黑盒）。
  async function useTemplate(template, goal, onToken, signal, selfCheck = false, onStage = null) {
    const system = `你是一名「提示词落地工程师」。基于给定提示词模板的专长与结构，写出一条【生产级、可直接复制粘贴进任意 AI 助手】的成品提示词。
要求：
1) 沿用模板角色设定（"你是…"），但不要留任何 {{占位}} 或"请填写"——所有占位由你根据用户目标动态写成具体、有代入感的内容（情境、关键点、示例、边界）。
2) 严格按以下【生产级结构】组织（章节顺序可调，缺一不可）：
   # 角色与背景：具体身份、资历、立场、能力边界，让模型明确"它是谁、不做什么"。
   # 目标：本次要解决的核心问题与成功标准（尽量可量化）。
   # 核心约束与禁止项：必须遵循的原则 + 明确禁止的事（如：不编造事实、不越权、涉及专业领域时标注局限/建议咨询持证专家）。
   # 工作流：接收输入 → 分析推理 → 组织产出的具体步骤。
   # 输出规范：明确结构（分节/表格/列表）、给出格式示例、规定语气与长度。
   # 边界与兜底：信息不足时如何声明或追问；超出能力范围时如何处置。
   # 自检：产出前对照的核对清单（是否覆盖目标 / 守约束 / 格式正确）。
3) 注入真实具体的操作细节、示例与边界逻辑，而不是骨架或空话；语气与模板定位一致。
4) 自包含、可直接使用；只输出提示词正文，不要解释、不要代码块围栏、开头不要写"以下是…"。
【模板专长】标题：${template.title}｜行业：${template.industry}｜定位：${template.summary}｜标签：${(template.tags || []).join("、")}
【模板结构骨架】${template.prompt}
【要覆盖的维度】${(template.variables || []).map(v => v.label).join("、")}`;
    const user = `用户目标：${goal}\n请写出成品提示词。`;
    const r = await callChatStream(system, user, onToken, null, signal);
    let text = (r.text || "").trim();
    if (!text) throw new Error("模型未返回提示词");
    if (selfCheck) {
      if (onStage) onStage("selfcheck");
      text = await prodSelfCheck(text, goal, signal);
    }
    return { prompt: text, usage: r.usage, elapsedMs: r.elapsedMs, sources: [] };
  }

  // F4：把生成的成品提示词直接发给模型，流式返回回答（页内运行看效果）。
  // prompt 已是完整提示词正文，以 user 消息发送，system 留空让提示词自身定义角色/任务。
  async function runPrompt(prompt, onToken, signal) {
    if (!prompt || !prompt.trim()) throw new Error("没有可运行的提示词");
    return await callChatStream("", prompt, onToken, null, signal);
  }

  // 测试沙盒：把整条提示词作为"系统设定"，与用户多轮对话。
  // messages: {role:"user"|"assistant", content:string}[]（不含 system，最后一条必为当前 user 问题）
  // 逐厂商构造完整 messages（含 system=提示词 + 历史上下文），返回 {text, usage, elapsedMs}
  async function chatWithPrompt(promptText, messages, onToken, signal, over = {}) {
    const c = resolveCfg(over);
    if (!c.key) throw new Error("未配置 API Key，请先到「设置」页填写。");
    if (!promptText || !promptText.trim()) throw new Error("没有可测试的提示词，请先生成。");
    const hist = (messages || []).filter(m => m && m.role && m.content);
    const start = Date.now();
    let res;
    if (c.style === "claude") {
      const url = c.base + "/messages";
      const headers = { "x-api-key": c.key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
      const body = { model: c.model, max_tokens: 1500, system: promptText, stream: true, messages: hist.map(m => ({ role: m.role, content: m.content })) };
      res = await streamClaude(url, headers, body, onToken, signal);
    } else if (c.style === "gemini") {
      const url = c.base + "/models/" + encodeURIComponent(c.model) + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(c.key);
      const body = {
        systemInstruction: { parts: [{ text: promptText }] },
        contents: hist.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
      };
      res = await streamGemini(url, body, onToken, signal);
    } else if (c.style === "ernie") {
      if (!c.secret) throw new Error("该服务商需要同时填写 API Key 和 API Secret。");
      const tokUrl = c.base + "/oauth/2.0/token?grant_type=client_credentials&client_id=" +
        encodeURIComponent(c.key) + "&client_secret=" + encodeURIComponent(c.secret);
      const tokRes = await relayFetch(tokUrl, "POST", { "content-type": "application/json" }, null, signal);
      const tokJson = await tokRes.json();
      if (!tokJson.access_token) throw new Error("获取百度 access_token 失败：" + (tokJson.error_description || tokJson.error || "未知"));
      const url = c.base + "/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/" + encodeURIComponent(c.model) + "?access_token=" + tokJson.access_token;
      const body = { messages: hist.map(m => ({ role: m.role, content: m.content })), system: promptText, temperature: 0.7, stream: true };
      res = await streamOpenAI(url, { "content-type": "application/json" }, body, onToken, signal);
    } else {
      const url = c.base + "/chat/completions";
      const headers = { "authorization": "Bearer " + c.key, "content-type": "application/json" };
      const body = { model: c.model, temperature: 0.7, stream: true, messages: [{ role: "system", content: promptText }, ...hist.map(m => ({ role: m.role, content: m.content }))] };
      res = await streamOpenAI(url, headers, body, onToken, signal);
    }
    return { text: res.text, usage: res.usage, elapsedMs: Date.now() - start };
  }

  // 测试连接：用当前设置（或传入的表单覆盖参数）发一次极简请求，验证 Key / 模型有效
  // 返回 { ok, label, model, reply } 或 { ok:false, error }
  async function testConnection(over) {
    const c = resolveCfg(over);
    if (!c.key) return { ok: false, error: "未填写 API Key。" };
    if (c.style === "ernie" && !c.secret) return { ok: false, error: "该服务商还需填写 API Secret。" };
    try {
      const txt = await callChat(
        "你是连接测试器。只回复一个英文单词 OK，不要任何多余内容。",
        "OK",
        over
      );
      return { ok: true, label: c.providerLabel + " · " + c.model, model: c.model, reply: (txt || "").slice(0, 50).replace(/\s+/g, " ").trim() };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // 实时拉取厂商在役模型列表（用于设置页「拉取真实模型列表」按钮）。
  // 优先内存缓存 → localStorage 持久缓存；失败返回 null（调用方回退硬编码清单）。
  // 文心(ernie)无公开 /models 列表，直接返回 null。其余走各厂商 list 接口：
  //   - openai 风格：GET {base}/models → { data:[{id}] }
  //   - claude：GET {base}/models（x-api-key 头）→ { data:[{id}] }
  //   - gemini：GET {base}/models?key= → { models:[{name:"models/xxx"}] }
  // 通过 relayFetch 复用代理开关（代理模式下走 /relay，避免跨域 / 隐藏 Key）。
  const modelCache = new Map();
  let orListCache = null; // 二级兜底源：OpenRouter 聚合目录（公开、无需 Key）
  // 厂商 → OpenRouter 前缀映射；命中后剥离前缀与 :free/:batch 后缀得到该厂商原生模型 ID
  const OR_FALLBACK = { openai: "openai", deepseek: "deepseek", moonshot: "moonshotai", qwen: "qwen", hunyuan: "tencent", grok: "x-ai", mistral: "mistralai", claude: "anthropic", gemini: "google" };
  async function listModels(provider, key, secret, allowFallback = true) {
    const p = PROVIDERS[provider];
    if (!p || provider === "ernie") return null;
    if (modelCache.has(provider)) return modelCache.get(provider);
    const lsKey = "ppt_models_" + provider;
    try { const c = JSON.parse(localStorage.getItem(lsKey) || "null"); if (Array.isArray(c) && c.length) { modelCache.set(provider, c); return c; } } catch (e) {}
    let url, headers;
    if (p.style === "gemini") {
      url = p.base + "/models?key=" + encodeURIComponent(key || "");
      headers = { "content-type": "application/json" };
    } else if (p.style === "claude") {
      url = p.base + "/models";
      headers = { "x-api-key": key || "", "anthropic-version": "2023-06-01", "content-type": "application/json" };
    } else {
      url = p.base + "/models";
      headers = { "authorization": "Bearer " + (key || ""), "content-type": "application/json" };
    }
    // 先拉厂商自身 /models
    try {
      const r = await relayFetch(url, "GET", headers, undefined);
      if (r.ok) {
        const j = await r.json();
        let ids: any[] = [];
        if (p.style === "gemini") ids = (j.models || []).map((m: any) => String(m.name || "").replace(/^models\//, "")).filter(Boolean);
        else {
          // 兼容多种响应形态：OpenAI 风格 {data:[{id}]}、Together 顶层数组、Perplexity {models:[{id}]}、部分厂商 {model_list:[...]}
          const src: any = Array.isArray(j) ? j : (j.data || j.models || j.model_list || j.objects || []);
          ids = (src || []).map((m: any) => m && (m.id || m.name || m.model)).filter(Boolean).map(String);
        }
        ids = Array.from(new Set(ids));
        if (ids.length) { modelCache.set(provider, ids); try { localStorage.setItem(lsKey, JSON.stringify(ids)); } catch (e) {} return ids; }
      }
    } catch (e) {}
    // 二级兜底：自身拉不到（无 Key / 不可达 / 不支持），从 OpenRouter 聚合目录取该厂商真实型号
    // allowFallback=false（如裁判模型场景）时不回退，避免列出无对应 Key 不可用的 OpenRouter 型号
    const pre = OR_FALLBACK[provider];
    if (pre && allowFallback) {
      try {
        if (!orListCache) {
          const orr = await relayFetch("https://openrouter.ai/api/v1/models", "GET", { "content-type": "application/json" }, undefined);
          if (orr.ok) { const oj = await orr.json(); orListCache = oj.data || []; }
        }
        if (Array.isArray(orListCache)) {
          const prefix = pre + "/";
          const ids = Array.from(new Set(orListCache
            .map(m => m.id || "")
            .filter(id => id.startsWith(prefix))
            .map(id => id.slice(prefix.length).replace(/:(free|batch)$/, ""))
            .filter(Boolean)));
          if (ids.length) { modelCache.set(provider, ids); try { localStorage.setItem(lsKey, JSON.stringify(ids)); } catch (e) {} return ids; }
        }
      } catch (e) {}
    }
    return null;
  }

  // ---------- 走服务端 Agent（/agent/*，带 RAG + 自审 + 流式）----------
  // 读取 Agent 的 SSE 事件流，逐事件回调 onEvent(name, data)；onEvent 抛错会在流结束后向上抛出
  async function readAgentSSE(r, onEvent, signal) {
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", curEvent = null, curData = "", dispatchErr = null;
    try {
      while (true) {
        if (signal && signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line.startsWith("event:")) curEvent = line.slice(6).trim();
          else if (line.startsWith("data:")) curData = line.slice(5).trim();
          else if (line === "") {
            if (curEvent) {
              try { onEvent(curEvent, curData ? JSON.parse(curData) : null); }
              catch (e) { dispatchErr = e; }
              curEvent = null; curData = "";
            }
          }
        }
      }
    } finally { try { await reader.cancel(); } catch (e) {} }
    if (dispatchErr) throw dispatchErr;
  }

  function agentPayload(over?) {
    const c = resolveCfg(over);
    const s = Store.getSettings();
    const useProxy = s.useProxy && (s.proxyBase && String(s.proxyBase).trim());
    return {
      provider: c.provider,
      model: c.model,
      apiKey: c.key,
      apiSecret: c.secret,
      proxyBase: useProxy ? String(s.proxyBase).trim().replace(/\/$/, "") : "",
    };
  }

  // F1 via Agent：返回 { tpl, usage, elapsedMs }；onNode(name) 透出状态机节点事件（clarify/retrieve/draft/validate/finalize）；onContext(refs) 透出 RAG 召回的参考范例
  async function generateViaAgent(industry, sentence, onToken, onNode, signal, onContext, onThink) {
    const { provider, model, apiKey, apiSecret, proxyBase } = agentPayload();
    const key = apiKey;
    if (!key) throw new Error("未配置 API Key，请先在「设置」页填写真实 Key 后再生成。");
    const r = await fetch("/agent/generate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model, apiKey: key, apiSecret, industry, sentence, proxyBase }), signal,
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("Agent 生成失败 " + r.status + "：" + t.slice(0, 200)); }
    let tpl = null, usage = null;
    await readAgentSSE(r, (name, data) => {
      if (name === "token" && onToken) onToken(data && data.text, false);
      else if (name === "meta") { if (onNode) onNode("meta"); }
      else if (name === "node" && data && onNode) { onNode(data.name); }
      else if (name === "context" && data && onContext) { onContext(data); }
      else if (name === "think" && data && onThink) { onThink(data.text, data.kind); }
      else if (name === "result") { tpl = data; tpl.slug = "gen-" + Date.now(); tpl.generated = true; }
      else if (name === "usage") usage = data;
      else if (name === "error") throw new Error((data && data.message) || "Agent 出错");
    }, signal);
    if (onToken) onToken("", true);
    if (!tpl) throw new Error("Agent 未返回模板");
    return { tpl, usage, elapsedMs: 0 };
  }

  // F2 via Agent：用模板生成成品提示词（模型代写）。返回 { prompt, usage, elapsedMs, sources }
  async function useTemplateViaAgent(template, goal, onToken, onNode, signal, onContext, onThink) {
    const { provider, model, apiKey, apiSecret, proxyBase } = agentPayload();
    const key = apiKey;
    if (!key) throw new Error("未配置 API Key，请先在「设置」页填写真实 Key 后再生成。");
    const r = await fetch("/agent/use", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model, apiKey: key, apiSecret, industry: template.industry || "其他", template, goal, proxyBase }), signal,
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("Agent 生成失败 " + r.status + "：" + t.slice(0, 200)); }
    let prompt = null, usage = null, sources = [];
    await readAgentSSE(r, (name, data) => {
      if (name === "token" && onToken) onToken(data && data.text, false);
      else if (name === "meta") { if (onNode) onNode("meta"); }
      else if (name === "node" && data && onNode) { onNode(data.name); }
      else if (name === "context" && data && onContext) { onContext(data); }
      else if (name === "think" && data && onThink) { onThink(data.text, data.kind); }
      else if (name === "result") { prompt = data.prompt; sources = data.sources || []; }
      else if (name === "usage") usage = data;
      else if (name === "error") throw new Error((data && data.message) || "Agent 出错");
    }, signal);
    if (onToken) onToken("", true);
    if (prompt == null) throw new Error("Agent 未返回提示词");
    return { prompt, usage, elapsedMs: 0, sources };
  }

  // F3 via Agent：交互式访谈澄清（SSE 流式，复用 node/think/result 事件）。
  // 模型判断一句话目标还缺什么，把思考过程与带选项的问题流式推回；多轮直到 complete。
  // 返回完整 AgentClarifyResult {complete, questions, enrichedGoal, note}；onNode/onThink 透出思考进度。
  async function clarifyViaAgent(template, goal, history, signal, onNode, onThink) {
    const { provider, model, apiKey, apiSecret, proxyBase } = agentPayload();
    const key = apiKey;
    if (!key) throw new Error("未配置 API Key，请先在「设置」页填写真实 Key。");
    const r = await fetch("/agent/clarify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model, apiKey: key, apiSecret, industry: template.industry || "其他", template, goal, history: history || [], proxyBase }), signal,
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("访谈请求失败 " + r.status + "：" + t.slice(0, 200)); }
    let result = null;
    await readAgentSSE(r, (name, data) => {
      if (name === "node" && data && onNode) onNode(data.name);
      else if (name === "think" && data && onThink) onThink(data.text, data.kind);
      else if (name === "result") result = data;
      else if (name === "error") throw new Error((data && data.message) || "访谈出错");
      else if (name === "done") { /* 结束标记，无需处理 */ }
    }, signal);
    if (!result) throw new Error("访谈未返回结果");
    return result;
  }

  // F5 via Agent：根据测试反馈动态改写提示词（SSE：analyze 思考 → rewrite 流式输出）。返回 { prompt }
  async function refinePrompt(origPrompt, feedback, conversation, onToken, onNode, onThink, signal) {
    const { provider, model, apiKey, apiSecret, proxyBase } = agentPayload();
    if (!apiKey) throw new Error("未配置 API Key，请先在「设置」页填写真实 Key 后再改写。");
    const r = await fetch("/agent/refine", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model, apiKey, apiSecret, prompt: origPrompt, feedback, conversation: conversation || [], proxyBase }), signal,
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("改写失败 " + r.status + "：" + t.slice(0, 200)); }
    let prompt = null;
    await readAgentSSE(r, (name, data) => {
      if (name === "token" && onToken) onToken(data && data.text, false);
      else if (name === "node" && data && onNode) onNode(data.name);
      else if (name === "think" && data && onThink) onThink(data.text, data.kind);
      else if (name === "result") prompt = data.prompt;
      else if (name === "error") throw new Error((data && data.message) || "改写出错");
    }, signal);
    if (onToken) onToken("", true);
    if (!prompt) throw new Error("改写未返回提示词");
    return { prompt };
  }

  // F5 浏览器直连兜底：单轮调用模型，用 ----PROMPT---- 分隔"分析"与"新版提示词"
  async function refinePromptDirect(origPrompt, feedback, conversation, onToken, onNode, onThink, signal) {
    const c = resolveCfg();
    if (!c.key) throw new Error("未配置 API Key，请先到「设置」页填写。");
    if (onNode) onNode("analyze");
    if (onThink) onThink("🧐 服务端暂不可用，改用浏览器直连分析并改写…");
    const convText = (conversation || []).slice(-8).map(m => (m.role === "assistant" ? "模型回答" : "用户") + "：" + m.content).join("\n\n");
    const system = `你是提示词优化器。根据用户给出的原提示词与测试反馈，输出改进思路与改写后的【完整提示词全文】。保留好的部分，针对反馈具体改写。先写 3-6 条改进思路，然后用一行分隔符 ----PROMPT---- 隔开，再输出完整提示词正文（不要代码块围栏）。`;
    const user = `【原提示词】\n${origPrompt}\n\n【用户反馈】\n${feedback}` +
      (convText ? `\n\n【测试对话】\n${convText}` : "") + `\n\n请先给改进思路，再用 ----PROMPT---- 分隔并输出完整提示词。`;
    const text = await callChat(system, user, signal);
    const idx = (text || "").indexOf("----PROMPT----");
    const thinkPart = idx >= 0 ? text.slice(0, idx).trim() : (text || "").trim();
    const promptPart = idx >= 0 ? text.slice(idx + 13).trim() : (text || "").trim();
    if (thinkPart && onThink) onThink(thinkPart);
    if (onNode) onNode("rewrite");
    if (onToken) onToken(promptPart, true);
    if (!promptPart) throw new Error("改写未返回提示词");
    return { prompt: promptPart };
  }

  // F13 自动优化闭环：基于「评测结论」(critique) 针对性改写提示词。浏览器直连，支持 over 指定模型与 signal 中断。
  async function optimizePrompt(origPrompt, critique, onToken, signal, over = {}) {
    const c = resolveCfg(over);
    if (!c.key) throw new Error("未配置 API Key，请先到「设置」页填写。");
    const system = `你是一名「提示词优化器」。根据用户给出的【原提示词】与【评测结论】（低分维度与改进建议），对提示词做【针对性改写】，输出改进后的【完整提示词全文】。
改写原则：
1. 保留原提示词中好的部分（角色设定、有用结构、有效约束），不要推倒重来。
2. 针对评测结论里的每条问题逐一改进（如"回答太啰嗦"就加强"只输出要点、避免铺垫"；"没按格式输出"就强化输出格式并给示例；"没抓住重点"就明确任务优先级与目标；"语气不对"就调整角色语气设定）。
3. 改进要可操作、具体到措辞，而非空泛建议。
4. 只输出改进后的【完整提示词正文】，不要任何解释、不要 markdown 代码块围栏、不要在开头写"以下是…"。`;
    const user = `【原提示词】\n${origPrompt}\n\n【评测结论】\n${critique}`;
    const r = await callChatStream(system, user, onToken || null, over, signal);
    const prompt = (r.text || "").trim();
    if (!prompt) throw new Error("优化未返回提示词");
    return { prompt };
  }

  // 社区分享 / 账号 / 可观测 相关函数已全部裁剪（个人本地工具，无服务端账号与社区）。

  return { PROVIDERS, effectiveLabel, labelOf, callChat, callChatStream, testConnection, listModels, generateTemplate, generateViaAgent, useTemplateViaAgent, clarifyViaAgent, useTemplate, runPrompt, chatWithPrompt, refinePrompt, refinePromptDirect, optimizePrompt };
})();
