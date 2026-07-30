// probe-keys.mjs — 探测 apikey.txt 里的 Key 能否出网、对应模型 ID 是否有效。
// 仅打印 HTTP 状态 + 回复前若干字符，绝不回显密钥本身。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const txt = readFileSync(resolve(ROOT, "apikey.txt"), "utf8");
const keys = {};
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([^：:]+)[：:]\s*(.+?)\s*$/);
  if (m) keys[m[1].trim()] = m[2].trim();
}
const dk = keys["deepseek"];
const qw = keys["通义"] || keys["qwen"] || keys["百炼"];

async function probe(name, base, model, key) {
  if (!key) { console.log(`[${name}] 未找到 key，跳过`); return; }
  const url = base + "/chat/completions";
  const body = JSON.stringify({ model, messages: [{ role: "user", content: "用一句话回复：连通性测试" }], max_tokens: 16 });
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body });
    const txt = await r.text();
    const ok = r.ok;
    const snippet = (txt || "").slice(0, 120).replace(/\s+/g, " ");
    console.log(`[${name}] HTTP ${r.status} (${Date.now() - t0}ms) model=${model} :: ${ok ? "OK" : snippet}`);
  } catch (e) {
    console.log(`[${name}] 网络/请求异常 (${Date.now() - t0}ms): ${e.message}`);
  }
}

console.log("=== 探测 deepseek ===");
await probe("deepseek", "https://api.deepseek.com/v1", "deepseek-chat", dk);
await probe("deepseek", "https://api.deepseek.com/v1", "deepseek-reasoner", dk);
console.log("=== 探测 通义/百炼 (qwen) ===");
await probe("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus", qw);
await probe("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-max", qw);
