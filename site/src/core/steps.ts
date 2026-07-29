// core/steps.ts — Agent 状态机步骤条（Module 模式）。
// 负责把后端流式事件可视化为「实时思考时间线」，状态（思考日志 / 当前步）集中存于 ctx。
import { ctx } from "./ctx.js";
import { GEN_STEPS_5, STEP_HINT } from "./config.js";
import { esc } from "./ui.js";

// 展示 RAG 召回的参考范例（让“agent 有依据”可见）
export function renderRagRefs(refs: any[]): void {
  const el = (document.getElementById("gen-rag") as HTMLElement);
  if (!el) return;
  if (!refs || !refs.length) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "block";
  el.innerHTML = `<div class="ttl">🔎 已从模板库与社区广场检索到 ${refs.length} 个相似范例作为参考</div>` +
    `<div style="display:flex;flex-wrap:wrap;gap:6px;">` +
    refs.map((r) => `<span class="tag" style="background:#fff;border:1px solid var(--brand-100);">${r.source === "community" ? '<b style="color:#16a34a">社区</b> · ' : ""}${esc(r.title)}<span class="muted"> · ${esc(r.industry)}</span></span>`).join("") +
    `</div>`;
}

// 状态机步骤条：把 Agent 的节点事件可视化（实时思考时间线）
export function renderGenSteps(activeKey: string, steps?: any[], containerId = "gen-steps"): void {
  const el = document.getElementById(containerId || "gen-steps");
  if (!el) return;
  const list = steps || GEN_STEPS_5;
  if (activeKey && activeKey !== "__done__") ctx.activeStepKey = activeKey;
  el.style.display = "block";
  const actIdx = list.findIndex((s) => s.k === ctx.activeStepKey);
  el.innerHTML = '<div class="timeline">' + list.map((s) => {
    const curIdx = list.findIndex((x) => x.k === s.k);
    let state = "pending";
    if (activeKey === "__done__") state = "done";
    else if (curIdx < actIdx) state = "done";
    else if (curIdx === actIdx) state = "active";
    const hint = (state === "active" || state === "done") ? (STEP_HINT[s.k] || "") : "";
    const thinks = (ctx.thinkLog[s.k] || []).map((t) => `<div class="think-line">${esc(t)}</div>`).join("");
    const mark = state === "done" ? "✓" : (state === "active" ? "" : "");
    return `<div class="step ${state}" data-step="${s.k}">
      <div class="step-dot">${mark}</div>
      <div class="step-body">
        <div class="step-title">${s.label}</div>
        ${hint ? `<div class="step-hint">${hint}</div>` : ""}
        <div class="step-think">${thinks}</div>
      </div>
    </div>`;
  }).join("") + '</div>';
}

// 把后端发来的“思考/产物”文本实时追加到当前激活步骤下
export function appendThink(text: string, containerId = "gen-steps"): void {
  if (!text) return;
  if (!ctx.thinkLog[ctx.activeStepKey]) ctx.thinkLog[ctx.activeStepKey] = [];
  ctx.thinkLog[ctx.activeStepKey].push(text);
  const base = containerId || "gen-steps";
  const box = document.querySelector('#' + base + ' .step[data-step="' + ctx.activeStepKey + '"] .step-think');
  if (box) {
    const d = document.createElement("div");
    d.className = "think-line";
    d.textContent = text;
    box.appendChild(d);
    try { box.scrollIntoView({ block: "nearest" }); } catch (e) {}
  }
}
