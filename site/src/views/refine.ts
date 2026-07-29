// views/refine.ts — F5 动态改写提示词（Component 模式）。
// 模板详情页与社区详情页共用同一套改写逻辑，靠 refineCtx 区分元素 id 与状态访问器。
import { ctx } from "../core/ctx.js";
import { esc } from "../core/ui.js";
import { renderGenSteps, appendThink } from "../core/steps.js";
import { REFINE_STEPS } from "../core/config.js";
import { LLM } from "../llm.js";

export function openRefineBox(): void {
  const rc = ctx.refineCtx;
  if (!rc) return;
  const box = document.getElementById(rc.boxId);
  const fb = document.getElementById(rc.feedbackId) as HTMLInputElement;
  const steps = document.getElementById(rc.stepsId);
  const live = document.getElementById(rc.liveId);
  const result = document.getElementById(rc.resultId);
  if (steps) { steps.style.display = "none"; steps.innerHTML = ""; }
  if (live) { live.style.display = "none"; live.textContent = ""; }
  if (result) { result.style.display = "none"; result.innerHTML = ""; }
  if (box) box.style.display = "block";
  if (fb) { fb.focus(); }
}

export function closeRefineBox(): void {
  const rc = ctx.refineCtx;
  if (!rc) return;
  const box = document.getElementById(rc.boxId);
  const fb = document.getElementById(rc.feedbackId) as HTMLInputElement;
  if (box) box.style.display = "none";
  if (fb) fb.value = "";
}

export async function handleRefine(): Promise<void> {
  const rc = ctx.refineCtx;
  if (!rc) return;
  const fb = document.getElementById(rc.feedbackId) as HTMLInputElement;
  const live = document.getElementById(rc.liveId);
  const result = document.getElementById(rc.resultId);
  const goBtn = document.getElementById(rc.goId) as HTMLButtonElement;
  const cancelBtn = document.getElementById(rc.cancelId) as HTMLButtonElement;
  const m = document.getElementById(rc.msgId);
  const feedback = fb ? fb.value.trim() : "";
  if (!feedback) { if (m) m.textContent = "请先描述你希望改进的地方。"; return; }
  if (!rc.getPrompt()) { if (m) m.textContent = "请先查看提示词再改写。"; return; }

  if (goBtn) { goBtn.disabled = true; goBtn.style.opacity = ".55"; }
  if (cancelBtn) { cancelBtn.disabled = true; }
  if (result) { result.style.display = "none"; result.innerHTML = ""; }
  if (live) { live.style.display = "none"; live.textContent = ""; }
  ctx.thinkLog = {}; ctx.activeStepKey = "";
  renderGenSteps("analyze", REFINE_STEPS, rc.stepsId);
  if (m) m.textContent = "分析中，请稍候…";

  ctx.refineController = new AbortController();
  const onNode = (name: string) => {
    if (name === "result") { renderGenSteps("__done__", REFINE_STEPS, rc.stepsId); return; }
    renderGenSteps(name, REFINE_STEPS, rc.stepsId);
  };
  const onThink = (text: string) => appendThink(text, rc.stepsId);
  const onToken = (chunk: string) => {
    if (chunk) { if (live) { live.style.display = "block"; live.textContent += chunk; } }
  };
  try {
    let res: any;
    try {
      res = await LLM.refinePrompt(rc.getPrompt(), feedback, rc.getTestMessages(), onToken, onNode, onThink, ctx.refineController.signal);
    } catch (e) {
      const em = (e && (e as any).message) || "";
      if (/API 错误|401|Authentication|api ?key|invalid|key/i.test(em)) throw e;
      // 服务端 Agent 不可用 -> 浏览器直连兜底
      if (live) { live.style.display = "none"; live.textContent = ""; }
      res = await LLM.refinePromptDirect(rc.getPrompt(), feedback, rc.getTestMessages(), onToken, onNode, onThink, ctx.refineController.signal);
    }
    if (live) live.style.display = "none"; // 用干净的审阅视图取代实时草稿
    renderGenSteps("__done__", REFINE_STEPS, rc.stepsId);
    showRefineResult(res.prompt);
    if (m) m.textContent = "✓ AI 已生成改写版提示词，请在下方审阅。";
  } catch (e) {
    if (ctx.refineController && ctx.refineController.signal.aborted) {
      if (m) m.textContent = "已停止改写。";
    } else {
      if (live) { live.style.display = "block"; live.textContent += "\n\n✗ 改写失败：" + (e as any).message; }
      if (m) m.textContent = "改写失败：" + (e as any).message;
    }
  } finally {
    if (goBtn) { goBtn.disabled = false; goBtn.style.opacity = "1"; }
    if (cancelBtn) cancelBtn.disabled = false;
    ctx.refineController = null;
  }
}

// 展示 AI 改写后的新版提示词，让用户对比审阅并选择采用 / 放弃
function showRefineResult(newPrompt: string): void {
  const rc = ctx.refineCtx;
  if (!rc) return;
  const box = document.getElementById(rc.resultId);
  if (!box) return;
  box.style.display = "block";
  box.innerHTML = `
    <div class="ttl">✅ AI 已生成「改进版」提示词（下方为完整新版，审阅后决定是否替换）</div>
    <pre class="code-box" id="refine-new" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow:auto;">${esc(newPrompt)}</pre>
    <div class="flex gap-2 mt-3 flex-wrap items-center">
      <button id="refine-apply" class="btn btn-primary btn-sm">✓ 采用并替换</button>
      <button id="refine-discard" class="btn btn-ghost btn-sm">放弃本次改写</button>
      <span class="muted" style="font-size:.75rem;">采用后将替换当前测试提示词，并重置测试对话以便重新验证效果</span>
    </div>`;
  (document.getElementById("refine-apply") as HTMLButtonElement).addEventListener("click", () => applyRefine(newPrompt));
  (document.getElementById("refine-discard") as HTMLButtonElement).addEventListener("click", () => {
    box.style.display = "none"; box.innerHTML = "";
    const mm = document.getElementById(rc.msgId);
    if (mm) { mm.textContent = "已放弃本次改写。"; setTimeout(() => { if (mm) mm.textContent = ""; }, 2000); }
  });
}

// 采用改写版：替换当前提示词 -> 更新测试提示词展示 -> 重置测试对话为分隔标记
function applyRefine(newPrompt: string): void {
  const rc = ctx.refineCtx;
  if (!rc) return;
  rc.setPrompt(newPrompt);
  const tp = rc.testPromptId ? document.getElementById(rc.testPromptId) : null;
  if (tp) tp.textContent = newPrompt;
  // 同步刷新上方主"提示词正文"卡片，否则替换后顶部仍显示最初版本
  const live = document.getElementById(rc.promptCardId);
  if (live) { live.textContent = newPrompt; live.style.display = "block"; }
  // 同步把主卡片标题标记为「改进版提示词」，让视觉上明确已切换
  const liveLabel = document.getElementById(rc.promptLabelId);
  if (liveLabel) { liveLabel.textContent = "✨ 改进版提示词"; liveLabel.className = "live-label live-label-updated"; }
  rc.setTestMessages([]);
  rc.resetController();
  const log = document.getElementById(rc.testLogId);
  if (log) log.innerHTML = '<div class="test-divider">—— 已切换为「改进版」提示词，下面用新问题重新验证效果 ——</div>';
  const usageEl = document.getElementById(rc.usageId);
  if (usageEl) usageEl.textContent = "";
  const rb = document.getElementById(rc.resultId);
  if (rb) { rb.style.display = "none"; rb.innerHTML = ""; }
  const steps = document.getElementById(rc.stepsId);
  if (steps) { steps.style.display = "none"; steps.innerHTML = ""; }
  const rbox = document.getElementById(rc.boxId);
  if (rbox) { rbox.style.display = "none"; const fb = document.getElementById(rc.feedbackId) as HTMLInputElement; if (fb) fb.value = ""; }
  const m = document.getElementById(rc.msgId);
  if (m) { m.textContent = "✓ 已采用改进版提示词，可重新测试。"; setTimeout(() => { if (m) m.textContent = ""; }, 2500); }
}

// 模板详情页的 refine 上下文（元素 id 与状态访问器）
export function templateRefineCtx(): any {
  return {
    getPrompt: () => ctx.current ? ctx.current._lastPrompt : "",
    setPrompt: (p: string) => { if (ctx.current) ctx.current._lastPrompt = p; },
    getTestMessages: () => ctx.testMessages,
    setTestMessages: (m: any[]) => { ctx.testMessages = m; },
    resetController: () => { ctx.testController = null; },
    testLogId: "test-log",
    promptCardId: "use-live",
    promptLabelId: "use-live-label",
    testPromptId: "test-prompt",
    usageId: "use-run-usage",
    stepsId: "refine-steps",
    resultId: "refine-result",
    liveId: "refine-live",
    boxId: "refine-box",
    feedbackId: "refine-feedback",
    goId: "refine-go",
    cancelId: "refine-cancel",
    msgId: "msg",
  };
}

// 社区详情页的 refine 上下文
export function communityRefineCtx(): any {
  return {
    getPrompt: () => ctx.cCurrentPrompt,
    setPrompt: (p: string) => { ctx.cCurrentPrompt = p; },
    getTestMessages: () => ctx.cState.msgs,
    setTestMessages: (m: any[]) => { ctx.cState.msgs = m; },
    resetController: () => { ctx.cState.ctl = null; },
    testLogId: "cm-test-log",
    promptCardId: "cm-prompt-body",
    promptLabelId: "cm-prompt-label",
    testPromptId: null,
    usageId: "cm-test-usage",
    stepsId: "cm-refine-steps",
    resultId: "cm-refine-result",
    liveId: "cm-refine-live",
    boxId: "cm-refine-box",
    feedbackId: "cm-refine-feedback",
    goId: "cm-refine-go",
    cancelId: "cm-refine-cancel",
    msgId: "cm-msg",
  };
}
