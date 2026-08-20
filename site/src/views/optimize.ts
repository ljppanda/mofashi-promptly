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

// onApply 可选：编辑态「✨ 增强」传入，优化版应用后回调（写回编辑框 + 落 F10 版本）；
// 不传则为默认行为（直接 Store.addMine 存为新版本并关闭弹窗）。
export function openOptimizeModal(t: any, onApply?: (rec: any) => void): void {
  const settings = Store.getSettings();
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
        <div style="flex:1;min-width:200px;">
          <label class="text-sm font-medium" style="color:var(--slate)">裁判模型（限当前 Key 厂商：${esc(LLM.PROVIDERS[settings.provider]?.label || settings.provider || "未设置")}）</label>
          <div class="flex gap-2 items-center" style="margin-top:4px;">
            <select id="opt-judge-model" class="select" style="flex:1.2;margin-bottom:0;" disabled></select>
            <button id="opt-judge-fetch" class="btn btn-ghost btn-sm" type="button" title="用当前 Key 从厂商拉取在役模型">🔄</button>
          </div>
          <p class="muted" style="font-size:.74rem;margin-top:4px;">裁判必须用当前 Key 所属厂商的模型，否则 Key 对不上无法调用；选「用当前设置的模型」则与被测同模型。</p>
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
      <div id="opt-stage" style="display:none;align-items:center;gap:8px;margin-top:10px;padding:9px 12px;font-size:.8rem;color:var(--slate);background:var(--brand-50);border:1px solid var(--brand-100);border-radius:10px;">
        <span class="spinner" style="width:14px;height:14px;border-width:2px;flex:none;"></span>
        <span id="opt-stage-text" style="flex:1;min-width:0;">准备中…</span>
        <span id="opt-timer" class="muted" style="margin-left:8px;font-variant-numeric:tabular-nums;white-space:nowrap;"></span>
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

  // —— 裁判模型：锁定当前 Key 所属厂商，仅可选该厂商模型（避免 Key 对不上无法调用）——
  const jProv = (settings.provider && LLM.PROVIDERS[settings.provider]) ? settings.provider : "";
  const jProvLabel = jProv ? LLM.PROVIDERS[jProv].label : "未设置";
  const judgeModelSel = (document.getElementById("opt-judge-model") as HTMLSelectElement);
  const judgeFetchBtn = (document.getElementById("opt-judge-fetch") as HTMLButtonElement);
  function populateJudgeModels(live?: string[] | null): void {
    if (!jProv) { judgeModelSel.disabled = true; judgeModelSel.innerHTML = ""; return; }
    const prov = LLM.PROVIDERS[jProv];
    const list = (live && live.length) ? live : (prov.models || []);
    const cur = (settings.customModel && settings.customModel.trim()) || settings.model || prov.default;
    const opts = ['<option value="">（用当前设置的模型：' + esc(cur) + '）</option>']
      .concat(list.map((m: string) => '<option value="' + esc(m) + '">' + esc(m) + '</option>'));
    const prev = judgeModelSel.value;
    judgeModelSel.innerHTML = opts.join("");
    if (prev && (prev === "" || list.indexOf(prev) !== -1)) judgeModelSel.value = prev;
    else judgeModelSel.value = ""; // 默认用当前设置的模型
    judgeModelSel.disabled = false;
  }
  // 打开即用真实 Key 拉取（不回退 OpenRouter，避免列出无 Key 不可用的型号）；无 Key/失败则回退内置清单
  (async () => {
    if (!jProv) { judgeModelSel.disabled = true; return; }
    if (settings.key) {
      try {
        const ids = await LLM.listModels(jProv, settings.key, settings.secret || "", false);
        if (ids && ids.length) { populateJudgeModels(ids); return; }
      } catch (e) {}
    }
    populateJudgeModels();
  })();
  if (judgeFetchBtn) judgeFetchBtn.addEventListener("click", async () => {
    if (!jProv) { toast("「设置」页未配置厂商，无法选择裁判模型"); return; }
    if (!settings.key) { toast("请先在「设置」页填写 " + jProvLabel + " 的 API Key，才能拉取真实模型"); return; }
    judgeFetchBtn.disabled = true; judgeFetchBtn.textContent = "…";
    try {
      const ids = await LLM.listModels(jProv, settings.key, settings.secret || "", false);
      if (ids && ids.length) { populateJudgeModels(ids); toast("✓ 已拉取 " + ids.length + " 个在役模型"); }
      else { populateJudgeModels(); toast("⚠ 实时拉取失败：Key 无效或 " + jProvLabel + " 不支持 /models，已用内置清单"); }
    } catch (e: any) {
      populateJudgeModels();
      toast("✗ 拉取失败：" + (e && e.message ? e.message : e) + "，已用内置清单");
    } finally {
      judgeFetchBtn.disabled = false; judgeFetchBtn.textContent = "🔄";
    }
  });

  const DIM_LABELS: Record<string, string> = { relevance: "相关性", structure: "结构", usable: "可用", specific: "具体", safety: "安全", jsonValid: "JSON" };
  function dimHtml(d: any): string {
    return Object.keys(DIM_LABELS).filter((k) => d && typeof d[k] === "number").map((k) => `${DIM_LABELS[k]} ${d[k].toFixed(1)}`).join(" · ");
  }
  function metricsHtml(agg: any): string {
    const parts: string[] = [];
    if (agg && typeof agg.avgTokens === "number") parts.push(`~${Math.round(agg.avgTokens)} tok`);
    if (agg && typeof agg.avgLatencyMs === "number") parts.push(`~${Math.round(agg.avgLatencyMs)} ms`);
    return parts.length ? `<div class="muted" style="font-size:.76rem;margin-top:2px;">⚙ 单样本均值 ${parts.join(" · ")}</div>` : "";
  }

  async function run(): Promise<void> {
    const goals = goalsEl.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!goals.length) { toast("请至少填一个测试目标"); return; }
    const threshold = Number((document.getElementById("opt-th") as HTMLInputElement).value) || 14;
    const jModel = judgeModelSel.value;
    const judgeOver = jModel ? { provider: jProv, model: jModel } : {};
    controller = new AbortController();
    runBtn.disabled = true;
    stopBtn.style.display = "";
    resEl.style.display = "none";
    diffEl.style.display = "none";
    actEl.style.display = "none";
    newPrompt = null;
    const stageBox = document.getElementById("opt-stage") as HTMLElement;
    const stageText = document.getElementById("opt-stage-text") as HTMLElement;
    const stageTimer = document.getElementById("opt-timer") as HTMLElement;
    const setStage = (txt: string) => { if (stageText) stageText.textContent = txt; };
    const t0 = Date.now();
    const stageTimerId = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      if (stageTimer) stageTimer.textContent = `已用时 ${mm}:${ss}`;
    }, 1000);
    if (stageBox) stageBox.style.display = "flex";
    try {
      setStage(`🚀 已启动评测（共 ${goals.length} 个样本，每个需 3 次模型调用，通常共需 1–4 分钟，请勿关闭弹窗）`);
      progEl.textContent = `评测原版 0/${goals.length}…`;
      const orig = await judgeSamples(t, goals, {}, judgeOver,
        (done, total) => { progEl.textContent = `评测原版 ${done}/${total}…`; },
        (idx, total, _stage, label) => { setStage(`📝 评测原版 · 第 ${idx}/${total} 个样本 — ${label}…`); },
        controller.signal);
      const agg = await aggregate(orig);
      let html = `<div class="card" style="padding:12px;"><b>原版：均分 ${agg.avgTotal.toFixed(1)}/20</b>（${agg.count} 有效）<div class="muted" style="font-size:.8rem;margin-top:4px;">${dimHtml(agg.dims)}</div>${metricsHtml(agg)}</div>`;
      if (agg.avgTotal >= threshold) {
        resEl.innerHTML = html + `<p class="muted mt-2" style="font-size:.82rem;">✓ 已达到阈值（${threshold}），质量达标，建议保留原版。如需进一步打磨可手动微调。</p>`;
        resEl.style.display = "";
        progEl.textContent = "完成";
        setStage("✅ 原版已达标，无需改写");
        clearInterval(stageTimerId);
        return;
      }
      const critique = buildCritique(agg);
      setStage("🧠 均分未达标，正在让 AI 改写提示词（单次调用，约 10–40 秒）…");
      progEl.textContent = `改写优化版…`;
      const opt = await LLM.optimizePrompt(t.prompt, critique, (tok, done) => {
        if (!done) {
          const n = tok ? tok.length : 0;
          setStage(`✍️ AI 正在改写提示词…（已生成 ${n} 字）`);
        }
      }, controller.signal);
      newPrompt = opt.prompt;
      setStage("📝 复测优化版阶段…");
      progEl.textContent = `复测优化版 0/${goals.length}…`;
      const optT = { ...t, prompt: newPrompt };
      const optRes = await judgeSamples(optT, goals, {}, judgeOver,
        (done, total) => { progEl.textContent = `复测优化版 ${done}/${total}…`; },
        (idx, total, _stage, label) => { setStage(`📝 复测优化版 · 第 ${idx}/${total} 个样本 — ${label}…`); },
        controller.signal);
      const optAgg = await aggregate(optRes);
      const delta = optAgg.avgTotal - agg.avgTotal;
      html += `<div class="card mt-2" style="padding:12px;border-color:var(--brand);"><b>优化版：均分 ${optAgg.avgTotal.toFixed(1)}/20</b> <span class="pill pill-amber">${delta >= 0 ? "▲ +" : "▼ "}${delta.toFixed(1)}</span><div class="muted" style="font-size:.8rem;margin-top:4px;">${dimHtml(optAgg.dims)}</div>${metricsHtml(optAgg)}</div>`;
      resEl.innerHTML = html + `<p class="muted mt-2" style="font-size:.82rem;">${delta > 0 ? "优化后质量提升，可「采用优化版」。仍可在「历史版本」回滚。" : "优化后分数未提升，建议保留原版或手动调整阈值。"}</p>`;
      resEl.style.display = "";
      diffEl.innerHTML = `<div class="muted" style="font-size:.8rem;margin-bottom:6px;">原版 ↔ 优化版 文本差异</div><div class="code-box" style="white-space:pre-wrap;max-height:300px;overflow:auto;">${diffLines(t.prompt, newPrompt)}</div>`;
      diffEl.style.display = "";
      actEl.style.display = "";
      progEl.textContent = "完成";
      setStage("✅ 优化完成，下方为原版 ↔ 优化版对比");
    } catch (e: any) {
      progEl.textContent = "";
      if (stageText) stageText.textContent = "⚠️ 已中断：" + (e && e.message ? e.message : e);
      toast("优化中断：" + (e && e.message ? e.message : e));
    } finally {
      clearInterval(stageTimerId);
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
    if (onApply) {
      // 编辑态增强：交给调用方写回 + 落版本，再关弹窗
      onApply(rec);
      close();
    } else {
      Store.addMine(rec);
      toast("✓ 已保存优化版（可在「历史版本」回滚）");
      close();
    }
  });
  (document.getElementById("opt-discard") as HTMLButtonElement)?.addEventListener("click", () => {
    actEl.style.display = "none";
    diffEl.style.display = "none";
    newPrompt = null;
    toast("已放弃优化版，保留原版");
  });
}
