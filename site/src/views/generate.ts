// views/generate.ts — F1 模板生成流水线（Component + 状态机）。
// 负责首页「生成模板」：调用 Agent（RAG + 自审 + 流式），失败回退浏览器直连。
import { LLM } from "../llm.js";
import { Store } from "../store.js";
import { ctx } from "../core/ctx.js";
import { fmtUsage, confirmDialog } from "../core/ui.js";
import { renderGenSteps, appendThink, renderRagRefs } from "../core/steps.js";
import { GEN_STEPS_5 } from "../core/config.js";

export async function handleGenerate(): Promise<void> {
  const msg = (document.getElementById("gen-msg") as HTMLElement);
  const live = (document.getElementById("gen-live") as HTMLElement);
  const genBtn = (document.getElementById("gen-btn") as HTMLButtonElement);
  const stopBtn = (document.getElementById("gen-stop") as HTMLButtonElement);
  const openBtn = (document.getElementById("gen-open") as HTMLAnchorElement);
  const industry = (document.getElementById("gen-industry") as HTMLSelectElement).value;
  const sentence = (document.getElementById("gen-input") as HTMLInputElement).value.trim();
  if (!sentence) { msg.textContent = "请先描述你的需求。"; return; }
  // 若本页刚刚已经成功生成过模板（入口按钮已出现），再次点「生成模板」需二次确认，
  // 避免误生成重复草稿、覆盖掉上一份还没来得及去填写的结果。
  if (openBtn && openBtn.style.display !== "none") {
    const ok = await new Promise<boolean>((resolve) => {
      confirmDialog(
        "已经生成过一个模板了",
        "本页刚刚已生成一份模板，点下方「✨ 打开模板，生成你的提示词」即可去填写并生成成品提示词。再次生成会新建一份草稿（不会覆盖刚才那份，两份都在「我的模板」里），确定要重新生成吗？",
        () => resolve(true),
        { confirmLabel: "重新生成", danger: false, onCancel: () => resolve(false) }
      );
    });
    if (!ok) return;
  }
  live.style.display = "block";
  live.textContent = "";
  renderRagRefs(null);
  ctx.thinkLog = {}; ctx.activeStepKey = "";
  msg.textContent = "Agent 运行中（展示状态机流程）…";
  renderGenSteps("clarify", GEN_STEPS_5);
  openBtn.style.display = "none";
  genBtn.disabled = true; genBtn.style.opacity = ".55";
  stopBtn.style.display = "inline-flex";
  ctx.genController = new AbortController();
  try {
    const onGenToken = (chunk: string, done: boolean) => {
      if (chunk) live.textContent += chunk;
      if (done) live.textContent += "\n\n✓ 生成完成";
    };
    // 把 Agent 节点事件映射到步骤条
    const onNode = (name: string) => {
      if (name === "meta") { renderGenSteps("clarify", GEN_STEPS_5); return; }
      if (name === "result") { renderGenSteps("__done__", GEN_STEPS_5); return; }
      renderGenSteps(name, GEN_STEPS_5);
    };
    const onThink = (text: string, kind?: string) => { appendThink(text, "gen-steps", kind); };
    const onContext = (refs: any[]) => { renderRagRefs(refs); };
    let res: any;
    try {
      // 优先走服务端 Agent（RAG + 自审 + 流式）；仅当服务端不可用时，回退到浏览器直连（效果一致）
      res = await LLM.generateViaAgent(industry, sentence, onGenToken, onNode, ctx.genController.signal, onContext, onThink);
    } catch (e) {
      const m = (e && (e as any).message) || "";
      console.error("[generateViaAgent failed]", e);
      if (/API 错误|401|Authentication|api ?key|invalid|key/i.test(m)) throw e;
      live.textContent += "\n（服务端 Agent 暂不可用" + (m ? "：" + m : "") + "，已自动改用浏览器直连生成）";
      renderGenSteps("draft", GEN_STEPS_5);
      appendThink("已切换浏览器直连，正在调用模型生成模板（此模式下不展示中间思考）…");
      res = await LLM.generateTemplate(industry, sentence, onGenToken, ctx.genController.signal);
    }
    // 展示 token 消耗
    renderGenSteps("__done__", GEN_STEPS_5);
    if (res.usage) live.textContent += "\n\n📊 " + fmtUsage(res.usage, res.elapsedMs);
    else live.textContent += "\n耗时 " + (res.elapsedMs / 1000).toFixed(1) + "s";
    // 把用量带到详情页持久展示
    res.tpl._genUsage = res.usage;
    res.tpl._genElapsed = res.elapsedMs;
    if (!res.tpl.slug) res.tpl.slug = "gen-" + Date.now(); // 保证稳定 id，便于热度榜/收藏按 id 累计
    window.__draft = res.tpl;
    Store.saveDraft(res.tpl); // 持久化草稿，刷新后仍可找回
    // 不再自动跳转：保留状态机流程可见，由用户点「查看生成的模板」进入详情
    msg.textContent = "✓ 已生成模板：「" + (res.tpl.title || "未命名") + "」";
    (window as any).__pendingGoal = sentence; // 携带本次需求，供详情页「前往生成」自动填入目标
    openBtn.href = "#/t/" + res.tpl.slug;
    openBtn.style.display = "inline-flex";
    // 上方可能还有一大段生成过程输出，自动把「去生成提示词」入口滚进视野，避免找不到
    setTimeout(() => { try { openBtn.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {} }, 60);
  } catch (e) {
    if (ctx.genController && ctx.genController.signal.aborted) {
      live.textContent += "\n\n■ 已停止生成";
      msg.textContent = "已停止生成。";
    } else {
      live.textContent += "\n\n✗ 生成失败：" + (e as any).message;
      msg.textContent = "生成失败：" + (e as any).message;
    }
  } finally {
    genBtn.disabled = false; genBtn.style.opacity = "1";
    stopBtn.style.display = "none";
    ctx.genController = null;
  }
}
