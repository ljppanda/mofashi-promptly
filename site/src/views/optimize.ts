// views/optimize.ts — 提示词自动优化闭环（F13）。
//
// 闭环：对模板采样 N 组测试目标 → 实例化 → 跑被测模型 → 裁判打分（judge.ts）
//       若均分 < 阈值 → 基于「评测结论」自动改写（LLM.optimizePrompt）→ 复测 → 并排对比 → 采用/放弃。
// 全部在浏览器用用户自己的 Key 跑，零服务端依赖、零外泄，复用 F10 版本历史做回滚兜底。
import { LLM } from "../llm.js";
import { Store } from "../store.js";
import { esc, toast, diffLines } from "../core/ui.js";
import { judgeSamples, aggregate, buildCritique } from "../core/judge.js";

// 根据模板自动生成若干「测试目标」变体（用户可在弹窗里增删）。
function genSamples(t: any, n: number): string[] {
  const base = t.title || t.summary || "这个模板";
  const ind = t.industry || "通用";
  const tmpl = [
    `我想用「${base}」解决一个${ind}场景下常见的具体问题，请给出可直接落地的版本。`,
    `帮我基于「${base}」写一份面向新手、容易上手的版本。`,
    `用「${base}」处理一个稍微复杂一点的真实案例，要求专业、严谨、有依据。`,
    `我需要「${base}」的一个精简版，适合快速套用、省时间。`,
    `针对「${base}」，给我一个带具体示例和操作步骤的实操版本。`,
    `把「${base}」改写成更口语化、更亲切的语气。`,
    `用「${base}」应对一个信息少、时间紧的紧急场景。`,
    `我要「${base}」的进阶版，包含边界情况与注意事项。`,
  ];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(tmpl[i % tmpl.length]);
  return out;
}

export function openOptimizeModal(t: any): void {
  const settings = Store.getSettings();
  const curModel = settings.customModel || settings.model || "当前模型";
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.id = "opt-overlay";
  ov.innerHTML = `
    <div class="modal-card card" style="max-width:820px;width:94%;max-height:92vh;overflow:auto;">
      <div class="flex items-center justify-between">
        <div class="ttl">🔧 一键优化（F13 · 自动评测→改写→对比）</div>
        <button id="opt-close" class="btn btn-ghost btn-sm">关闭</button>
      </div>
      <p class="muted mt-2" style="font-size:.8rem;">用你自己的 Key 在浏览器本地跑：对模板采样若干测试目标 → 实例化→跑模型→裁判打分；均分低于阈值则自动改写并复测。全部本地，不上传服务器。</p>
      <div class="flex gap-3 mt-3 flex-wrap items-end">
        <div>
          <label class="text-sm font-medium" style="color:var(--slate)">测试样本数</label>
          <input id="opt-n" type="number" min="1" max="10" value="5" class="input" style="width:90px;margin-top:4px;" />
        </div>
        <div>
          <label class="text-sm font-medium" style="color:var(--slate)">达标阈值（0-20）</label>
          <input id="opt-th" type="number" min="0" max="20" value="14" class="input" style="width:110px;margin-top:4px;" />
        </div>
        <div style="flex:1;min-width:180px;">
          <label class="text-sm font-medium" style="color:var(--slate)">裁判模型（可选，留空=当前 ${esc(curModel)}）</label>
          <input id="opt-judge" class="input" style="margin-top:4px;" placeholder="例如 gpt-5.5，留空则用当前模型" />
        </div>
      </div>
      <div class="mt-3">
        <label class="text-sm font-medium" style="color:var(--slate)">测试目标（每行一条，可增删；默认按上方「样本数」自动生成）</label>
        <textarea id="opt-goals" class="input" rows="5" style="margin-top:4px;font-family:monospace;"></textarea>
      </div>
      <div class="flex gap-2 mt-3 flex-wrap items-center">
        <button id="opt-run" class="btn btn-primary btn-sm">▶ 开始评测并优化</button>
        <button id="opt-stop" class="btn btn-danger btn-sm" style="display:none;">■ 停止</button>
        <span id="opt-progress" class="muted" style="font-size:.78rem;"></span>
      </div>
      <div id="opt-result" class="mt-4" style="display:none;"></div>
      <div id="opt-diff" class="mt-3" style="display:none;"></div>
      <div id="opt-actions" class="flex gap-2 mt-3" style="display:none;">
        <button id="opt-apply" class="btn btn-primary btn-sm">✓ 采用优化版</button>
        <button id="opt-discard" class="btn btn-ghost btn-sm">放弃</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  // 预填测试目标
  const goalsEl = (document.getElementById("opt-goals") as HTMLTextAreaElement);
  const nEl = (document.getElementById("opt-n") as HTMLInputElement);
  goalsEl.value = genSamples(t, Math.max(1, Math.min(10, Number(nEl.value) || 5))).join("\n");

  let controller: AbortController | null = null;
  let newPrompt: string | null = null;

  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  (document.getElementById("opt-close") as HTMLButtonElement)?.addEventListener("click", close);

  const runBtn = (document.getElementById("opt-run") as HTMLButtonElement);
  const stopBtn = (document.getElementById("opt-stop") as HTMLButtonElement);
  const progEl = (document.getElementById("opt-progress") as HTMLElement);
  const resEl = (document.getElementById("opt-result") as HTMLElement);
  const diffEl = (document.getElementById("opt-diff") as HTMLElement);
  const actEl = (document.getElementById("opt-actions") as HTMLElement);

  function dimHtml(d: any): string {
    return `相关性 ${d.relevance.toFixed(1)} · 结构 ${d.structure.toFixed(1)} · 可用 ${d.usable.toFixed(1)} · 具体 ${d.specific.toFixed(1)}`;
  }

  async function run(): Promise<void> {
    const goals = goalsEl.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!goals.length) { toast("请至少填一个测试目标"); return; }
    const threshold = Number((document.getElementById("opt-th") as HTMLInputElement).value) || 14;
    const judgeModel = (document.getElementById("opt-judge") as HTMLInputElement).value.trim();
    const judgeOver = judgeModel ? { model: judgeModel } : {};
    controller = new AbortController();
    runBtn.disabled = true;
    stopBtn.style.display = "";
    resEl.style.display = "none";
    diffEl.style.display = "none";
    actEl.style.display = "none";
    newPrompt = null;
    try {
      progEl.textContent = `评测原版 0/${goals.length}…`;
      const orig = await judgeSamples(t, goals, {}, judgeOver, (done, total) => {
        progEl.textContent = `评测原版 ${done}/${total}…`;
      }, controller.signal);
      const agg = await aggregate(orig);
      let html = `<div class="card" style="padding:12px;"><b>原版：均分 ${agg.avgTotal.toFixed(1)}/20</b>（${agg.count} 有效）<div class="muted" style="font-size:.8rem;margin-top:4px;">${dimHtml(agg.dims)}</div></div>`;
      if (agg.avgTotal >= threshold) {
        resEl.innerHTML = html + `<p class="muted mt-2" style="font-size:.82rem;">✓ 已达到阈值（${threshold}），质量达标，建议保留原版。如需进一步打磨可手动微调。</p>`;
        resEl.style.display = "";
        progEl.textContent = "完成";
        return;
      }
      const critique = buildCritique(agg);
      progEl.textContent = `均分 ${agg.avgTotal.toFixed(1)} 低于阈值，正在自动改写…`;
      const opt = await LLM.optimizePrompt(t.prompt, critique, (tok, done) => {
        if (tok && !done) progEl.textContent = `改写中… ${tok.slice(0, 60)}`;
      }, controller.signal);
      newPrompt = opt.prompt;
      progEl.textContent = `复测优化版 0/${goals.length}…`;
      const optT = { ...t, prompt: newPrompt };
      const optRes = await judgeSamples(optT, goals, {}, judgeOver, (done, total) => {
        progEl.textContent = `复测优化版 ${done}/${total}…`;
      }, controller.signal);
      const optAgg = await aggregate(optRes);
      const delta = optAgg.avgTotal - agg.avgTotal;
      html += `<div class="card mt-2" style="padding:12px;border-color:var(--brand);"><b>优化版：均分 ${optAgg.avgTotal.toFixed(1)}/20</b> <span class="pill pill-amber">${delta >= 0 ? "▲ +" : "▼ "}${delta.toFixed(1)}</span><div class="muted" style="font-size:.8rem;margin-top:4px;">${dimHtml(optAgg.dims)}</div></div>`;
      resEl.innerHTML = html + `<p class="muted mt-2" style="font-size:.82rem;">${delta > 0 ? "优化后质量提升，可「采用优化版」。仍可在「历史版本」回滚。" : "优化后分数未提升，建议保留原版或手动调整阈值。"}</p>`;
      resEl.style.display = "";
      diffEl.innerHTML = `<div class="muted" style="font-size:.8rem;margin-bottom:6px;">原版 ↔ 优化版 文本差异</div><div class="code-box" style="white-space:pre-wrap;max-height:300px;overflow:auto;">${diffLines(t.prompt, newPrompt)}</div>`;
      diffEl.style.display = "";
      actEl.style.display = "";
      progEl.textContent = "完成";
    } catch (e: any) {
      progEl.textContent = "";
      toast("优化中断：" + (e && e.message ? e.message : e));
    } finally {
      runBtn.disabled = false;
      stopBtn.style.display = "none";
      controller = null;
    }
  }

  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", () => { if (controller) controller.abort(); });

  (document.getElementById("opt-apply") as HTMLButtonElement)?.addEventListener("click", () => {
    if (!newPrompt) return;
    const rec = { ...t, prompt: newPrompt };
    Store.addMine(rec);
    toast("✓ 已保存优化版（可在「历史版本」回滚）");
    close();
  });
  (document.getElementById("opt-discard") as HTMLButtonElement)?.addEventListener("click", () => {
    actEl.style.display = "none";
    diffEl.style.display = "none";
    newPrompt = null;
    toast("已放弃优化版，保留原版");
  });
}
