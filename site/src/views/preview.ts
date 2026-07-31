// views/preview.ts — 模板「示例预览」（报告 #3）。
//
// 价值：让用户在收藏/使用前，先真实看到"这条模板能产出什么"——
//   ① 按模板把示例目标实例化为一条成品提示词
//   ② 直接用这条成品提示词跑出一段示例回答（流式）
// 对标 PromptBase 的"看示例输出"。全程用用户自己的 Key 在浏览器本地跑，零服务端依赖、零外泄。
import { LLM } from "../llm.js";
import { Store } from "../store.js";
import { esc, toast } from "../core/ui.js";

function fmtUsage(u: any, ms?: number): string {
  if (!u) return ms != null ? `${ms}ms` : "";
  const parts: string[] = [];
  if (u.prompt_tokens != null) parts.push(`in ${u.prompt_tokens}`);
  if (u.completion_tokens != null) parts.push(`out ${u.completion_tokens}`);
  if (u.total_tokens != null) parts.push(`共 ${u.total_tokens} tok`);
  if (ms != null) parts.push(`${ms}ms`);
  return parts.join(" · ");
}

export function openPreviewModal(t: any): void {
  const title = t?.title || "这条模板";
  const ind = t?.industry || "通用";
  const defaultGoal = `想用「${title}」解决一个${ind}场景下的具体问题，请给出具体、可直接落地的版本。`;
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.id = "prev-overlay";
  ov.innerHTML = `
    <div class="modal-card card" style="max-width:840px;width:94%;max-height:92vh;overflow:auto;">
      <div class="flex items-center justify-between">
        <div class="ttl">🔍 示例预览（看这条模板能产出什么）</div>
        <button id="prev-close" class="btn btn-ghost btn-sm">关闭</button>
      </div>
      <p class="muted mt-2" style="font-size:.8rem;">填一个示例目标，模型会：① 按模板生成一条成品提示词 → ② 直接用它跑出一段示例回答。让你在收藏/使用前先看到真实效果。全程用你自己的 Key，本地运行，不上传服务器。</p>
      <div class="mt-3">
        <label class="text-sm font-medium" style="color:var(--slate)">示例目标（可改成你真实的场景）</label>
        <textarea id="prev-goal" class="input" rows="3" style="margin-top:4px;">${esc(defaultGoal)}</textarea>
      </div>
      <div class="flex gap-2 mt-3 flex-wrap items-center">
        <button id="prev-run" class="btn btn-primary btn-sm">▶ 生成示例输出</button>
        <button id="prev-stop" class="btn btn-danger btn-sm" style="display:none;">■ 停止</button>
        <span id="prev-progress" class="muted" style="font-size:.78rem;"></span>
      </div>
      <div id="prev-hint" class="mt-2" style="display:none;"></div>
      <details id="prev-prompt-wrap" class="mt-3" style="display:none;">
        <summary class="muted" style="cursor:pointer;font-size:.82rem;">📋 本次实际使用的成品提示词（点开看）</summary>
        <pre id="prev-prompt" class="code-box" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;"></pre>
      </details>
      <div class="mt-3">
        <div class="muted" style="font-size:.82rem;margin-bottom:6px;">💡 示例回答（模型基于上面的提示词生成）</div>
        <pre id="prev-out" class="code-box" style="min-height:120px;white-space:pre-wrap;word-break:break-word;"></pre>
        <div id="prev-usage" class="muted" style="font-size:.75rem;margin-top:6px;"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  (document.getElementById("prev-close") as HTMLButtonElement)?.addEventListener("click", close);

  const goalEl = (document.getElementById("prev-goal") as HTMLTextAreaElement);
  const runBtn = (document.getElementById("prev-run") as HTMLButtonElement);
  const stopBtn = (document.getElementById("prev-stop") as HTMLButtonElement);
  const progEl = (document.getElementById("prev-progress") as HTMLElement);
  const hintEl = (document.getElementById("prev-hint") as HTMLElement);
  const promptWrap = (document.getElementById("prev-prompt-wrap") as HTMLDetailsElement);
  const promptEl = (document.getElementById("prev-prompt") as HTMLElement);
  const outEl = (document.getElementById("prev-out") as HTMLElement);
  const usageEl = (document.getElementById("prev-usage") as HTMLElement);

  let controller: AbortController | null = null;

  async function run(): Promise<void> {
    const settings = Store.getSettings();
    if (!settings || !settings.key) {
      hintEl.style.display = "";
      hintEl.innerHTML = `<div class="pill pill-amber" style="padding:8px 12px;">⚠️ 尚未配置 API Key，无法生成示例。请先到「设置」页填写你的模型 Key（用户自带 Key，平台不存储）。</div>`;
      toast("请先到「设置」配置 API Key");
      return;
    }
    const goal = goalEl.value.trim();
    if (!goal) { toast("请填写示例目标"); return; }

    controller = new AbortController();
    runBtn.disabled = true;
    stopBtn.style.display = "";
    hintEl.style.display = "none";
    outEl.textContent = "";
    usageEl.textContent = "";
    promptWrap.style.display = "none";
    promptEl.textContent = "";

    const tpl = {
      title: t?.title || "",
      industry: t?.industry || "",
      summary: t?.summary || "",
      tags: t?.tags || [],
      variables: t?.variables || [],
      prompt: t?.prompt || "",
    };

    try {
      // ① 实例化为成品提示词（流式展示到折叠区）
      progEl.textContent = "① 按模板生成成品提示词…";
      let pBuf = "";
      const { prompt } = await LLM.useTemplate(tpl as any, goal, (c) => {
        if (c) { pBuf += c; promptEl.textContent = pBuf; }
      }, controller.signal);
      promptEl.textContent = prompt;
      promptWrap.style.display = "";

      // ② 用成品提示词跑出示例回答（流式主展示）
      progEl.textContent = "② 用成品提示词跑示例回答…";
      let full = "";
      const onTok = (c: string) => { if (c) { full += c; outEl.textContent = full; outEl.scrollTop = outEl.scrollHeight; } };
      const res = await LLM.chatWithPrompt(prompt, [{ role: "user", content: goal }], onTok, controller.signal);
      full = res.text || full;
      outEl.textContent = full;
      if (res.usage) usageEl.textContent = "📊 " + fmtUsage(res.usage, res.elapsedMs);
      progEl.textContent = "✓ 完成 · 这就是这条模板在真实目标下的产出";
    } catch (e: any) {
      if (controller && controller.signal.aborted) {
        outEl.textContent += "\n\n■ 已停止";
        progEl.textContent = "已停止。";
      } else {
        const msg = (e && e.message) ? e.message : String(e);
        outEl.textContent += "\n\n✗ 生成失败：" + msg;
        progEl.textContent = "失败：" + msg;
        toast("示例预览失败：" + msg);
      }
    } finally {
      runBtn.disabled = false;
      stopBtn.style.display = "none";
      controller = null;
    }
  }

  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", () => { if (controller) controller.abort(); });
}
