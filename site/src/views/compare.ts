// views/compare.ts — 跨模型对比测试（Component 模式）。
// 同一提示词并发跑多个模型，并排展示输出 + token 用量 + 按 MODEL_PRICE 估算成本。
// 灵感来自 LLMWise / Anthropic Library：帮用户挑「最适配自己模板的模型」。
import { LLM } from "../llm.js";
import { Store } from "../store.js";
import { esc, fmtUsage, toast } from "../core/ui.js";
import { estimateCost } from "../core/config.js";

// 打开对比弹窗。promptText：作为系统设定的提示词；question：发给每个模型的测试问题
export function openCompareModal(promptText: string, question?: string): void {
  const settings = Store.getSettings();
  const curProvider = settings.provider || "openai";
  const PROVIDERS: any = LLM.PROVIDERS;
  const modelRows = Object.keys(PROVIDERS).map(p => {
    const pdef = PROVIDERS[p];
    const model = pdef.default;
    const checked = p === curProvider ? "checked" : "";
    const prefillKey = p === curProvider ? (settings.key || "") : "";
    const prefillSecret = p === curProvider ? (settings.secret || "") : "";
    const secretField = pdef.needSecret
      ? `<input class="input cmp-secret" data-p="${esc(p)}" style="margin-top:4px;" placeholder="API Secret" value="${esc(prefillSecret)}" />`
      : "";
    return `<label class="cmp-model-row" style="display:block;padding:6px 0;border-top:1px solid var(--brand-100);">
      <input type="checkbox" class="cmp-chk" data-p="${esc(p)}" data-m="${esc(model)}" ${checked}/> <b>${esc(pdef.label)}</b> · <span class="muted" style="font-size:.78rem;">${esc(model)}</span>
      <input class="input cmp-key" data-p="${esc(p)}" style="margin-top:4px;" placeholder="API Key（留空则用已保存的）" value="${esc(prefillKey)}" />
      ${secretField}
    </label>`;
  }).join("");

  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.id = "cmp-overlay";
  ov.innerHTML = `
    <div class="modal-card card" style="max-width:780px;width:94%;max-height:92vh;overflow:auto;">
      <div class="flex items-center justify-between">
        <div class="ttl">🔬 跨模型对比测试（同一提示词跑多个模型，对比输出与成本）</div>
        <button id="cmp-close" class="btn btn-ghost btn-sm">关闭</button>
      </div>
      <div class="mt-3">
        <label class="text-sm font-medium" style="color:var(--slate)">提示词（作为系统设定）</label>
        <textarea id="cmp-prompt" class="input" rows="4" style="margin-top:4px;font-family:monospace;">${esc(promptText || "")}</textarea>
      </div>
      <div class="mt-3">
        <label class="text-sm font-medium" style="color:var(--slate)">测试问题（发给每个模型）</label>
        <input id="cmp-question" class="input" style="margin-top:4px;" value="${esc(question || "请用 3 句话介绍你能帮我做什么，并各举一例。")}" />
      </div>
      <div class="mt-3">
        <label class="text-sm font-medium" style="color:var(--slate)">选择要对比的模型（2–3 个）</label>
        <div id="cmp-models" style="margin-top:4px;">${modelRows}</div>
      </div>
      <div class="flex gap-2 mt-3 flex-wrap items-center">
        <button id="cmp-run" class="btn btn-primary btn-sm">▶ 运行对比</button>
        <span id="cmp-msg" class="muted" style="font-size:.78rem;"></span>
      </div>
      <div id="cmp-results" class="mt-4" style="display:none;"></div>
      <div id="cmp-summary" class="mt-3" style="display:none;"></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  const closeBtn = (document.getElementById("cmp-close") as HTMLButtonElement);
  if (closeBtn) closeBtn.addEventListener("click", close);
  const runBtn = (document.getElementById("cmp-run") as HTMLButtonElement);
  if (runBtn) runBtn.addEventListener("click", () => runCompare(ov));
}

async function runCompare(ov: HTMLElement): Promise<void> {
  const prompt = (ov.querySelector("#cmp-prompt") as HTMLTextAreaElement).value;
  const question = ((ov.querySelector("#cmp-question") as HTMLInputElement).value.trim()) || "请介绍你能帮我做什么。";
  const chks = Array.from(ov.querySelectorAll(".cmp-chk")) as HTMLInputElement[];
  const picks = chks.filter(c => c.checked).map(c => ({ provider: c.getAttribute("data-p"), model: c.getAttribute("data-m") }));
  if (picks.length < 2) { (ov.querySelector("#cmp-msg") as HTMLElement).textContent = "请至少勾选 2 个模型。"; return; }
  const resultsEl = ov.querySelector("#cmp-results") as HTMLElement;
  const summaryEl = ov.querySelector("#cmp-summary") as HTMLElement;
  resultsEl.style.display = "block";
  summaryEl.style.display = "block";
  resultsEl.innerHTML = picks.map((p, i) => `
    <div class="card tpl-card" style="margin-top:12px;">
      <div class="ttl">${esc(LLM.PROVIDERS[p.provider!].label)} · ${esc(p.model!)}</div>
      <pre id="cmp-out-${i}" class="code-box" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;"></pre>
      <div id="cmp-usage-${i}" class="muted" style="font-size:.75rem;margin-top:6px;"></div>
    </div>`).join("");
  const runBtn = ov.querySelector("#cmp-run") as HTMLButtonElement;
  if (runBtn) { runBtn.disabled = true; runBtn.style.opacity = ".55"; }
  (ov.querySelector("#cmp-msg") as HTMLElement).textContent = "对比运行中…";

  const signal = new AbortController().signal;
  let totalIn = 0, totalOut = 0, totalCost = 0;
  await Promise.all(picks.map(async (p, i) => {
    const settings = Store.getSettings();
    const keyEl = ov.querySelector(`.cmp-key[data-p="${p.provider}"]`) as HTMLInputElement;
    const secretEl = ov.querySelector(`.cmp-secret[data-p="${p.provider}"]`) as HTMLInputElement;
    const typedKey = (keyEl && keyEl.value.trim()) || "";
    const typedSecret = secretEl ? (secretEl.value.trim() || "") : "";
    const finalKey = typedKey || (p.provider === settings.provider ? (settings.key || "") : "");
    const finalSecret = typedSecret || (p.provider === settings.provider ? (settings.secret || "") : "");
    const outEl = ov.querySelector("#cmp-out-" + i) as HTMLElement;
    const usageEl = ov.querySelector("#cmp-usage-" + i) as HTMLElement;
    const over: any = { provider: p.provider, model: p.model, key: finalKey };
    if (finalSecret) over.secret = finalSecret;
    try {
      const onToken = (chunk: string) => { if (chunk) outEl.textContent += chunk; };
      const res = await LLM.chatWithPrompt(prompt, [{ role: "user", content: question }], onToken, signal, over);
      const cost = estimateCost(p.provider!, res.usage);
      totalIn += (res.usage && res.usage.inputTokens) || 0;
      totalOut += (res.usage && res.usage.outputTokens) || 0;
      totalCost += cost;
      usageEl.innerHTML = `📊 ${fmtUsage(res.usage, res.elapsedMs)} · 估算成本 <b>$${cost.toFixed(4)}</b>`;
    } catch (e: any) {
      outEl.textContent = "✗ " + (e && e.message ? e.message : e);
    }
  }));
  if (runBtn) { runBtn.disabled = false; runBtn.style.opacity = "1"; }
  (ov.querySelector("#cmp-msg") as HTMLElement).textContent = "✓ 对比完成";
  summaryEl.innerHTML = `<div class="card tpl-card" style="margin-top:8px;padding:10px 12px;">
    <div class="ttl">📊 对比汇总（${picks.length} 个模型）</div>
    <div class="muted" style="font-size:.82rem;margin-top:6px;">输入合计 ${totalIn} · 输出合计 ${totalOut} · <b>估算总成本 $${totalCost.toFixed(4)}</b></div>
    <div class="muted" style="font-size:.72rem;margin-top:4px;">* 成本为各厂商公开价目近似估算（USD / 1M tokens），以实际账单为准；未配置对应 Key 的模型会报错。</div>
  </div>`;
  if (!totalCost) toast("提示：部分模型未配置 Key，已跳过成本统计");
}
