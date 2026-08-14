// 只读分析：确认 templates.ts 中每个 prompt 的重复模式是否统一、去重规则能否还原为干净 7 段。
import fs from "node:fs";
const p = process.argv[2] || "site/src/templates.ts";
const text = fs.readFileSync(p, "utf8");

const re = /"prompt":\s*"((?:\\.|[^"\\])*)"/g;
let m; const prompts = [];
while ((m = re.exec(text)) !== null) prompts.push(m[1]);
console.log("提取 prompt 数:", prompts.length);

function decode(s) { return s.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c)); }
function dedupe(prompt) {
  const parts = prompt.split("\n# ");
  const segs = parts.map((p, i) => (i === 0 ? p : "# " + p));
  const hdr = segs.map((s) => s.split("\n")[0].trim());
  const order = ["# 角色与背景", "# 目标", "# 核心约束与禁止项", "# 工作流", "# 输出规范", "# 边界与兜底", "# 自检"];
  const chosen = [];
  for (const h of order) {
    const idxs = [];
    segs.forEach((s, i) => { if (hdr[i] === h) idxs.push(i); });
    if (h === "# 输出规范") { if (idxs.length >= 2) chosen.push(idxs[1]); else if (idxs.length === 1) chosen.push(idxs[0]); }
    else if (idxs.length) chosen.push(idxs[0]);
  }
  return { result: chosen.map((i) => segs[i]).join("\n"), chosen };
}

let anomalies = 0;
const counts = {};
for (let i = 0; i < prompts.length; i++) {
  const d = decode(prompts[i]);
  const r = dedupe(d);
  const secs = r.result.split("\n# ").map((s) => (s.startsWith("# ") ? s : "# " + s).split("\n")[0].trim());
  const uniq = new Set(secs);
  if (secs.length !== 7 || uniq.size !== 7) {
    anomalies++;
    if (anomalies <= 5) console.log(`ANOMALY #${i}: sections=${secs.length} unique=${uniq.size} ->`, secs.join(" | "));
  }
  // 统计去重后各 header 出现次数（应为 1）
  for (const s of secs) counts[s] = (counts[s] || 0) + 1;
}
console.log("异常模板数:", anomalies);
console.log("去重后各 header 总出现次数（应均 = prompt 数）:", JSON.stringify(counts));
