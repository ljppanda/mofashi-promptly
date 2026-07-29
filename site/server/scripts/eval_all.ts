/**
 * 评测一键编排：先跑离线 RAG 检索质量评测（无需 Key），
 * 若检测到 EVAL_API_KEY 则继续跑 F1→F2 链路评测（需 LLM Key）。
 *
 * 用法：npm run eval
 *   - 无 Key：仅离线 RAG 评测，链路评测优雅跳过并提示如何开启。
 *   - 有 Key：RAG + 链路全跑（链路评测另读 EVAL_PROVIDER / EVAL_MODEL）。
 */
import { spawnSync } from "node:child_process";

function runNpm(script: string): number {
  const r = spawnSync("npm", ["run", script], { stdio: "inherit", env: process.env });
  return r.status ?? 1;
}

console.log("▶ 离线 RAG 检索质量评测（无需 Key）");
runNpm("eval:rag");

if (process.env.EVAL_API_KEY) {
  console.log("\n▶ F1→F2 链路评测（已检测到 EVAL_API_KEY）");
  runNpm("eval:chain");
} else {
  console.log("\n⚠️ 未设置 EVAL_API_KEY，跳过 F1→F2 链路评测（离线 RAG 评测已完成）。");
  console.log("  开启方式：EVAL_PROVIDER=deepseek EVAL_MODEL=deepseek-chat EVAL_API_KEY=sk-xxx npm run eval:chain");
}
