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
      <p class="muted mt-2" style="font-size:.8rem;">用你自己的 Key 在浏览器本地跑：对模板采样若干测试目标 → 实例化→跑模型→裁判打分；均分低于阈值则自动改写并复测。全部本地，不上传服务器。<b style="color:var(--brand-700)">裁判建议配另一家厂商的 Key</b>，避免同源自评虚高。</p>
      <div class="flex gap-3 mt-3 flex-wrap items-end">
        <div>
          <label class="text-sm font-medium" style="color:var(--slate)">测试样本数</label>
          <input id="opt-n" type="number" min="1" max="10" value="2" class="input" style="width:90px;margin-top:4px;" />
        </div>
        <div>
          <label class="text-sm font-medium" style="color:var(--slate)">达标阈值（0-20）</label>
          <input id="opt-th" type="number" min="0" max="20" value="14" class="input" style="width:110px;margin-top:4px;" />
        </div>
        <div style="flex:1;min-width:300px;">
          <label class="text-sm font-medium" style="color:var(--slate)">裁判模型（<b style="color:var(--brand-700)">建议用不同厂商</b>，避免自评偏差）</label>
          <div class="flex gap-2 items-center" style="margin-top:4px;">
            <select id="opt-judge-provider" class="select" style="flex:1;margin-bottom:0;"></select>
            <input id="opt-judge-key" type="password" class="input" placeholder="该厂商的 API Key" style="flex:1.2;margin-bottom:0;" autocomplete="off" />
          </div>
          <div class="flex gap-2 items-center" style="margin-top:6px;">
            <select id="opt-judge-model" class="select" style="flex:1.2;margin-bottom:0;" disabled></select>
            <button id="opt-judge-fetch" class="btn btn-ghost btn-sm" type="button" title="用上方 Key 从该厂商拉取在役模型">🔄</button>
          </div>
          <div id="opt-judge-secret-wrap" style="display:none;margin-top:6px;">
            <input id="opt-judge-secret" type="password" class="input" placeholder="该厂商的 API Secret（百度文心需要）" autocomplete="off" />
          </div>
          <p class="muted" style="font-size:.74rem;margin-top:6px;line-height:1.55;">裁判由<b>另一家厂商</b>的模型独立打分：同厂商模型训练同源、偏好相近，容易互相抬高分数（自评偏差）。Key 仅存在你本机浏览器。</p>
          <label class="flex items-center gap-1" style="font-size:.74rem;margin-top:6px;color:var(--slate);cursor:pointer;">
            <input id="opt-judge-same" type="checkbox" style="margin:0;" /> 我只有一个厂商的 Key，仍用同厂商（自评，分数可能偏高）
          </label>
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
      <div id="opt-stream-wrap" style="display:none;margin-top:10px;">
        <div class="muted" style="font-size:.76rem;margin-bottom:6px;">📊 实时评测过程（逐样本打分明细）</div>
        <div id="opt-stream" style="max-height:280px;overflow:auto;display:flex;flex-direction:column;gap:6px;"></div>
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
  goalsEl.value = genSamples(t, Math.max(1, Math.min(10, Number(nEl.value) || 2))).join("\n");

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

  // —— 裁判：独立厂商 + 独立 Key。同厂商模型训练同源、偏好相近，容易互相抬分（自评偏差），
  //     故默认把「当前生成厂商」从候选里排除；确只有一个厂商 Key 时可勾选允许，但明确警示。
  const curProv = (settings.provider && LLM.PROVIDERS[settings.provider]) ? settings.provider : "";
  const judgeProvSel = (document.getElementById("opt-judge-provider") as HTMLSelectElement);
  const judgeKeyEl = (document.getElementById("opt-judge-key") as HTMLInputElement);
  const judgeSecretWrap = (document.getElementById("opt-judge-secret-wrap") as HTMLElement);
  const judgeSecretEl = (document.getElementById("opt-judge-secret") as HTMLInputElement);
  const judgeModelSel = (document.getElementById("opt-judge-model") as HTMLSelectElement);
  const judgeFetchBtn = (document.getElementById("opt-judge-fetch") as HTMLButtonElement);
  const judgeSameChk = (document.getElementById("opt-judge-same") as HTMLInputElement);

  // 上次保存的裁判配置（仅本机 localStorage，与「设置」页的 Key 相互独立）
  const jSavedProv = (settings.judgeProvider && LLM.PROVIDERS[settings.judgeProvider]) ? settings.judgeProvider : "";
  const jSavedKey = typeof settings.judgeKey === "string" ? settings.judgeKey : "";
  const jSavedSecret = typeof settings.judgeSecret === "string" ? settings.judgeSecret : "";
  const jSavedModel = typeof settings.judgeModel === "string" ? settings.judgeModel : "";

  const allowSame = (): boolean => !!(judgeSameChk && judgeSameChk.checked);
  const isSameProv = (p: string): boolean => !!p && p === curProv;

  function renderProviders(keep?: string): void {
    const keys = Object.keys(LLM.PROVIDERS).filter((k) => allowSame() || !isSameProv(k));
    judgeProvSel.innerHTML = keys.map((k) =>
      `<option value="${esc(k)}">${esc(LLM.PROVIDERS[k].label)}${isSameProv(k) ? "（同厂商·自评）" : ""}</option>`).join("");
    const want = keep || jSavedProv;
    if (want && keys.indexOf(want) !== -1) judgeProvSel.value = want;
    else if (keys.length) judgeProvSel.value = keys[0];
  }

  function populateJudgeModels(live?: string[] | null): void {
    const p = judgeProvSel.value;
    if (!p || !LLM.PROVIDERS[p]) { judgeModelSel.disabled = true; judgeModelSel.innerHTML = ""; return; }
    const prov = LLM.PROVIDERS[p];
    const list = (live && live.length) ? live : (prov.models || []);
    judgeModelSel.innerHTML = list.map((m: string) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    const want = (p === jSavedProv) ? jSavedModel : "";
    judgeModelSel.value = (want && list.indexOf(want) !== -1) ? want : (prov.default || list[0] || "");
    judgeModelSel.disabled = !list.length;
  }

  // 少数厂商（百度文心）除 Key 外还需 Secret
  function syncSecretField(): void {
    const p = judgeProvSel.value;
    const need = !!(p && LLM.PROVIDERS[p] && (LLM.PROVIDERS[p] as any).needSecret);
    if (judgeSecretWrap) judgeSecretWrap.style.display = need ? "" : "none";
  }

  function persistJudge(): void {
    try {
      const s = Store.getSettings();
      s.judgeProvider = judgeProvSel.value;
      s.judgeKey = judgeKeyEl.value.trim();
      s.judgeSecret = judgeSecretEl ? judgeSecretEl.value.trim() : "";
      s.judgeModel = judgeModelSel.value;
      Store.saveSettings(s);
    } catch (e) {}
  }

  // 「我只有一个厂商的 Key」：当裁判被选成当前厂商、且 Key 还空着时，自动把「设置」里那把 Key 带进来。
  // 否则这个勾选项只是解锁了选项、用户还得手抄一遍同一个 Key，很别扭。
  function maybePrefillKey(): void {
    if (judgeProvSel.value !== curProv) return;
    if (judgeKeyEl.value.trim() || !settings.key) return;
    judgeKeyEl.value = String(settings.key || "");
    if (judgeSecretEl && settings.secret) judgeSecretEl.value = String(settings.secret || "");
    toast("已带入「设置」里的 " + (LLM.PROVIDERS[curProv]?.label || "当前厂商") + " Key（同厂商自评，分数可能偏高）");
  }

  async function fetchJudgeModels(silent: boolean): Promise<void> {
    const p = judgeProvSel.value;
    const key = judgeKeyEl.value.trim();
    if (!p || !LLM.PROVIDERS[p]) { if (!silent) toast("请先选择裁判厂商"); return; }
    if (!key) {
      populateJudgeModels();
      if (!silent) toast("请填写 " + LLM.PROVIDERS[p].label + " 的 API Key，才能拉取在役模型");
      return;
    }
    if (judgeFetchBtn) { judgeFetchBtn.disabled = true; judgeFetchBtn.textContent = "…"; }
    try {
      const ids = await LLM.listModels(p, key, (judgeSecretEl ? judgeSecretEl.value.trim() : ""), false);
      if (ids && ids.length) { populateJudgeModels(ids); if (!silent) toast("✓ 已拉取 " + ids.length + " 个在役模型"); }
      else { populateJudgeModels(); if (!silent) toast("⚠ 拉取失败：Key 无效或该厂商不支持 /models，已用内置清单"); }
    } catch (e: any) {
      populateJudgeModels();
      if (!silent) toast("✗ 拉取失败：" + (e && e.message ? e.message : e) + "，已用内置清单");
    } finally {
      if (judgeFetchBtn) { judgeFetchBtn.disabled = false; judgeFetchBtn.textContent = "🔄"; }
    }
  }

  renderProviders();
  syncSecretField();
  judgeKeyEl.value = jSavedKey;
  if (judgeSecretEl) judgeSecretEl.value = jSavedSecret;
  populateJudgeModels();
  // 已存过 Key 时，打开即静默拉取该厂商真实在役模型；失败自动回退内置清单
  if (judgeProvSel.value === jSavedProv && judgeKeyEl.value.trim()) fetchJudgeModels(true);

  judgeProvSel.addEventListener("change", () => {
    syncSecretField();
    const sameAsSaved = judgeProvSel.value === jSavedProv;
    judgeKeyEl.value = sameAsSaved ? jSavedKey : "";
    if (judgeSecretEl) judgeSecretEl.value = sameAsSaved ? jSavedSecret : "";
    maybePrefillKey();
    populateJudgeModels();
    persistJudge();
  });
  judgeKeyEl.addEventListener("change", persistJudge);
  judgeModelSel.addEventListener("change", persistJudge);
  if (judgeSecretEl) judgeSecretEl.addEventListener("change", persistJudge);
  if (judgeSameChk) judgeSameChk.addEventListener("change", () => {
    renderProviders(judgeProvSel.value);
    maybePrefillKey();
    populateJudgeModels();
    if (judgeSameChk.checked) toast("⚠ 已允许同厂商裁判：分数可能偏高，仅供参考");
  });
  if (judgeFetchBtn) judgeFetchBtn.addEventListener("click", () => { persistJudge(); fetchJudgeModels(false); });

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
    // 裁判：必须用「另一个厂商」的模型独立打分，Key 也用该厂商自己的（resolveCfg 支持 over.key 覆盖）。
    // 同厂商模型训练同源、偏好相近，自己给自己打分会系统性虚高，故默认禁止。
    const jProv = judgeProvSel.value;
    const jKey = judgeKeyEl.value.trim();
    const jSecret = judgeSecretEl ? judgeSecretEl.value.trim() : "";
    const jModel = judgeModelSel.value;
    if (!jProv || !LLM.PROVIDERS[jProv]) { toast("请选择裁判厂商"); return; }
    if (!jKey) { toast("请填写裁判厂商（" + LLM.PROVIDERS[jProv].label + "）的 API Key，否则无法调用裁判模型"); return; }
    if ((LLM.PROVIDERS[jProv] as any).needSecret && !jSecret) { toast("该厂商需要同时填写 API Secret"); return; }
    if (isSameProv(jProv) && !allowSame()) {
      toast("为保证评分客观，裁判请使用与生成模型不同的厂商；若只有一个厂商的 Key，请勾选「仍用同厂商」");
      return;
    }
    const judgeOver = { provider: jProv, model: jModel, key: jKey, secret: jSecret };
    persistJudge();
    const judgeLabel = LLM.PROVIDERS[jProv].label + " · " + jModel;
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
    const streamWrap = document.getElementById("opt-stream-wrap") as HTMLElement;
    const streamEl = document.getElementById("opt-stream") as HTMLElement;
    const setStage = (txt: string) => { if (stageText) stageText.textContent = txt; };
    if (streamEl) streamEl.innerHTML = "";
    if (streamWrap) streamWrap.style.display = "";
    const scrollStream = () => { try { if (streamEl) streamEl.scrollTop = streamEl.scrollHeight; } catch (e) {} };
    // judgeSamples 的 onProgress 第三个参数就是该样本的 JudgeResult（分数/维度/裁判评语），
    // 此前回调只接了 (done,total) 把它丢弃，所以过程只有"评测中"——这里改成逐条实时渲染。
    const appendSample = (phase: string, idx: number, total: number, goal: string, r: any) => {
      if (!streamEl) return;
      const ok = !!(r && r.available);
      const sc = (r && typeof r.total === "number") ? (r.total as number) : 0;
      const note = (r && typeof r.note === "string" && r.note.trim()) ? r.note.trim() : "";
      const g = String(goal || "").replace(/\s+/g, " ");
      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "padding:9px 11px;";
      card.innerHTML = `
        <div style="font-size:.8rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <b>${esc(phase)} ${idx}/${total}</b>
          <span class="pill ${ok ? "pill-amber" : ""}">${ok ? sc.toFixed(1) + "/20" : "解析失败"}</span>
          <span class="muted" style="font-size:.74rem;">${ok ? dimHtml(r.dims) : "裁判输出无法解析"}</span>
        </div>
        <div class="muted" style="font-size:.74rem;margin-top:3px;">目标：${esc(g.length > 64 ? g.slice(0, 64) + "…" : g)}</div>
        ${note ? `<div style="font-size:.76rem;margin-top:4px;color:var(--slate);line-height:1.55;">🗣 裁判：${esc(note.length > 170 ? note.slice(0, 170) + "…" : note)}</div>` : ""}`;
      streamEl.appendChild(card);
      scrollStream();
    };
    // 通用文本卡片：用于「评测结论」「AI 改写实时预览」
    const appendNote = (title: string, body: string, highlight = false): HTMLElement | null => {
      if (!streamEl) return null;
      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "padding:9px 11px;" + (highlight ? "border-color:var(--brand);" : "");
      card.innerHTML = `<div style="font-size:.8rem;"><b>${esc(title)}</b></div>
        <div class="muted" style="font-size:.76rem;margin-top:4px;white-space:pre-wrap;line-height:1.55;">${esc(body)}</div>`;
      streamEl.appendChild(card);
      scrollStream();
      return card;
    };
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
        (done, total, r) => {
          const sc = (r && typeof r.total === "number") ? `（本样本 ${(r.total as number).toFixed(1)}/20）` : "";
          progEl.textContent = `评测原版 ${done}/${total}…${sc}`;
          if (r) appendSample("原版", done, total, goals[done - 1] || "", r);
        },
        (idx, total, _stage, label) => { setStage(`📝 评测原版 · 第 ${idx}/${total} 个样本 — ${label}…`); },
        controller.signal);
      const agg = await aggregate(orig);
      let html = `<div class="card" style="padding:12px;"><b>原版：均分 ${agg.avgTotal.toFixed(1)}/20</b>（${agg.count} 有效）<div class="muted" style="font-size:.78rem;margin-top:5px;">⚖️ 裁判：${esc(judgeLabel)}</div><div class="muted" style="font-size:.8rem;margin-top:4px;">${dimHtml(agg.dims)}</div>${metricsHtml(agg)}</div>`;
      if (agg.avgTotal >= threshold) {
        resEl.innerHTML = html + `<p class="muted mt-2" style="font-size:.82rem;">✓ 已达到阈值（${threshold}），质量达标，建议保留原版。如需进一步打磨可手动微调。</p>`;
        resEl.style.display = "";
        progEl.textContent = "完成";
        setStage("✅ 原版已达标，无需改写");
        clearInterval(stageTimerId);
        return;
      }
      const critique = buildCritique(agg);
      appendNote("🧾 评测结论（改写依据）", critique.length > 420 ? critique.slice(0, 420) + "…" : critique, true);
      setStage("🧠 均分未达标，正在让 AI 改写提示词（单次调用，约 10–40 秒）…");
      progEl.textContent = `改写优化版…`;
      let liveCard: HTMLElement | null = null;
      const opt = await LLM.optimizePrompt(t.prompt, critique, (tok, done) => {
        const txt = tok || "";
        if (!done) {
          setStage(`✍️ AI 正在改写提示词…（已生成 ${txt.length} 字）`);
          if (!liveCard) liveCard = appendNote("✍️ AI 改写中…", "", true);
          if (liveCard) {
            const body = liveCard.querySelector("div:last-child") as HTMLElement;
            const tail = txt.slice(-240);
            if (body) body.textContent = (txt.length > 240 ? "…" : "") + tail;
            scrollStream();
          }
        } else if (liveCard) {
          const h = liveCard.querySelector("b") as HTMLElement;
          if (h) h.textContent = `✓ 改写完成（${txt.length} 字）`;
        }
      }, controller.signal);
      newPrompt = opt.prompt;
      setStage("📝 复测优化版阶段…");
      progEl.textContent = `复测优化版 0/${goals.length}…`;
      const optT = { ...t, prompt: newPrompt };
      const optRes = await judgeSamples(optT, goals, {}, judgeOver,
        (done, total, r) => {
          const sc = (r && typeof r.total === "number") ? `（本样本 ${(r.total as number).toFixed(1)}/20）` : "";
          progEl.textContent = `复测优化版 ${done}/${total}…${sc}`;
          if (r) appendSample("优化版", done, total, goals[done - 1] || "", r);
        },
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
