// 修复 templates.ts 中每个 prompt 的「输出规范之后整段被复制」损坏。
// 先备份，修复后校验；若任何模板去重后不是干净 7 段则自动回滚。
import fs from "node:fs";
import path from "node:path";

const p = process.argv[2] || "site/src/templates.ts";
const bak = p + ".bak";
fs.copyFileSync(p, bak);
console.log("已备份 ->", bak);

const text0 = fs.readFileSync(p, "utf8");
const re = /"prompt":\s*"((?:\\.|[^"\\])*)"/g;

function decode(s) { return s.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c)); }
function encode(s) { return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/"/g, '\\"'); }
function dedupe(prompt) {
  const parts = prompt.split("\n# ");
  const segs = parts.map((q, i) => (i === 0 ? q : "# " + q));
  const hdr = segs.map((s) => s.split("\n")[0].trim());
  const order = ["# 角色与背景", "# 目标", "# 核心约束与禁止项", "# 工作流", "# 输出规范", "# 边界与兜底", "# 自检"];
  const chosen = [];
  for (const h of order) {
    const idxs = [];
    segs.forEach((s, i) => { if (hdr[i] === h) idxs.push(i); });
    if (h === "# 输出规范") { if (idxs.length >= 2) chosen.push(idxs[1]); else if (idxs.length === 1) chosen.push(idxs[0]); }
    else if (idxs.length) chosen.push(idxs[0]);
  }
  return chosen.map((i) => segs[i]).join("\n");
}

let n = 0;
const text1 = text0.replace(re, (full, inner) => {
  n++;
  return `"prompt": "${encode(dedupe(decode(inner)))}"`;
});
fs.writeFileSync(p, text1);
console.log("已重写 prompt 数:", n);

// 校验
const prompts2 = [];
let mm; const re2 = /"prompt":\s*"((?:\\.|[^"\\])*)"/g;
while ((mm = re2.exec(text1)) !== null) prompts2.push(mm[1]);
let anomalies = 0;
for (const raw of prompts2) {
  const d = decode(raw);
  const secs = d.split("\n# ").map((s) => (s.startsWith("# ") ? s : "# " + s).split("\n")[0].trim());
  if (secs.length !== 7 || new Set(secs).size !== 7) anomalies++;
}
console.log("校验后 prompt 数:", prompts2.length, "异常数:", anomalies);
if (anomalies > 0) {
  fs.copyFileSync(bak, p);
  console.log("发现异常，已回滚到备份。");
  process.exit(1);
} else {
  console.log("修复成功，无异常。可删除备份:", bak);
}
