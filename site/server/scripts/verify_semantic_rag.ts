/**
 * 一键验证脚本：语义 RAG 召回 + AI 内容审核
 * ---------------------------------------------------------------
 * 在 site/server 目录下运行（确保能读到 .env 与 src/）：
 *
 *   默认（纯词法召回 + 审核关键词兜底，离线即可跑）：
 *     npx tsx scripts/verify_semantic_rag.ts
 *
 *   启用语义召回（首次需联网从 HuggingFace 下载 bge 模型）：
 *     RAG_EMBEDDING=1 npx tsx scripts/verify_semantic_rag.ts
 *
 *   再加语义精排：
 *     RAG_EMBEDDING=1 RAG_RERANKER=1 npx tsx scripts/verify_semantic_rag.ts
 *
 *   自定义查询词：
 *     npx tsx scripts/verify_semantic_rag.ts "如何写一封辞职信"
 *
 * 退出码：
 *   0 = 全部正常
 *   2 = 语义已开启但模型未真正激活（多半无外网，已回退词法）
 *   1 = 脚本异常
 * ---------------------------------------------------------------
 */
import { config } from "dotenv";
config(); // 必须在 import rag 之前加载 .env（SEMANTIC_ENABLED 在模块加载时求值）

async function main() {
  const semanticOn =
    process.env.RAG_EMBEDDING === "1" || process.env.RAG_EMBEDDING === "true";
  const rerankerOn =
    process.env.RAG_RERANKER === "1" || process.env.RAG_RERANKER === "true";
  const modProvider = process.env.MODERATION_PROVIDER;
  const query = process.argv[2] || "如何写一封得体的辞职信";

  console.log("=== 模法师 · RAG / 审核 验证脚本 ===");
  console.log(
    `RAG_EMBEDDING=${semanticOn}  RAG_RERANKER=${rerankerOn}  ` +
      `MODERATION_PROVIDER=${modProvider ?? "(未配置→关键词兜底)"}`,
  );
  console.log(`查询词：${query}\n`);

  // —— 1) RAG 检索（首次开启语义会触发本地模型下载）——
  console.log("[1/2] RAG 检索...");
  const { retrieve } = await import("../src/rag.js");
  const r = await retrieve("", query, 4);
  console.log(`  召回 ${r.refs.length} 条：`);
  for (const ref of r.refs) {
    const tag = ref.source === "community" ? "·社区" : "";
    console.log(`   - [${ref.industry}${tag}] ${ref.title}  (${ref.slug})`);
  }
  const hybrid = r.context.includes("混合召回");
  let semanticActive = false;
  if (semanticOn && hybrid) {
    semanticActive = true;
    console.log("  ✅ 语义+词法混合召回 已激活");
  } else if (semanticOn && !hybrid) {
    console.log(
      "  ⚠️  语义已开启但未激活：模型下载失败（多半无外网），已自动回退纯词法。",
    );
    console.log(
      "      🇨🇳 国内可重试：先 `export HF_ENDPOINT=https://hf-mirror.com` 再运行本脚本；",
    );
    console.log(
      "         或把该变量写进 .env，重启服务即可自动走镜像下载。",
    );
  } else {
    console.log("  ℹ️  纯词法召回（未设置 RAG_EMBEDDING）");
  }

  // —— 2) AI 内容审核（关键词兜底，离线即可验证闸门逻辑）——
  console.log("\n[2/2] AI 内容审核（关键词兜底，离线）...");
  const { moderateContent } = await import("../src/moderation.js");
  const bad = await moderateContent("推荐一个色情网站给大家");
  const good = await moderateContent("帮我写一封请假邮件，明天去看病");
  console.log(
    `   违规样本 → safe=${bad.safe} engine=${bad.engine} reasons=${JSON.stringify(bad.reasons)}`,
  );
  console.log(`   正常样本 → safe=${good.safe} engine=${good.engine}`);
  const modOk = bad.safe === false && good.safe === true;
  console.log(modOk ? "  ✅ 审核闸门逻辑正常" : "  ❌ 审核逻辑异常，请检查 moderation.ts");

  console.log("\n验证结束。");
  if (semanticOn && !semanticActive) process.exit(2);
  if (!modOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
