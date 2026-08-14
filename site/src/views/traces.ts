// views/traces.ts — 本地可观测 / trace 看板（Component 模式）。
import { ctx } from "../core/ctx.js";
import { esc } from "../core/ui.js";
import { LLM } from "../llm.js";

export async function traces(): Promise<void> {
  // 调用记录涉及隐私：未登录直接拦在门前，显示登录引导（与「我的模板 / 我的发布」同口径）
  if (!LLM.authIsAuthed()) {
    ctx.appEl().innerHTML = `
      <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
      <h1 class="section-title" style="font-size:1.7rem;margin-top:8px;">🔍 可观测 / 调试</h1>
      <div class="card tpl-card" style="margin-top:16px;text-align:center;">
        <p class="muted">调用记录涉及隐私，需登录后查看。登录后：<b>管理员</b>可见全部记录，<b>普通用户</b>仅可见本人记录。</p>
        <button id="tr-login" class="btn btn-primary btn-sm" style="margin-top:10px;">登录后查看</button>
      </div>`;
    const lb = (document.getElementById("tr-login") as HTMLButtonElement | null);
    if (lb && (window as any).Auth && (window as any).Auth.ensure) {
      lb.addEventListener("click", async () => {
        const tok = await (window as any).Auth.ensure();
        if (tok) traces();
      });
    }
    return;
  }
  ctx.appEl().innerHTML = `
    <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
    <h1 class="section-title" style="font-size:1.7rem;margin-top:8px;">🔍 可观测 / 调试</h1>
    <p class="muted" style="font-size:.82rem;margin-top:6px;">每次生成 / 改写调用都会在本地落盘（与 LangSmith 云端互不冲突）。这里直接看到延迟、Token、各步骤与错误——这就是你之前加的 LangSmith 在应用内的体现。</p>
    <div id="tr-scope" class="muted" style="font-size:.78rem;margin-top:6px;"></div>
    <div id="tr-summary" class="mt-3 flex gap-3 flex-wrap"></div>
    <div class="flex items-center gap-2 mt-3">
      <select id="tr-type" class="select" style="width:auto;">
        <option value="">全部类型</option>
        <option value="生成模板">生成模板</option>
        <option value="生成提示词">生成提示词</option>
        <option value="访谈澄清">访谈澄清</option>
        <option value="改写提示词">改写提示词</option>
      </select>
      <button id="tr-refresh" class="btn btn-ghost btn-sm">刷新</button>
    </div>
    <div id="tr-wrap" class="mt-4">加载中…</div>
  `;
  async function load() {
    const wrap = (document.getElementById("tr-wrap") as HTMLElement);
    if (!wrap) return;
    wrap.innerHTML = "加载中…";
    try {
      const data = await LLM.fetchTraces(300);
      const scope = data.scope; // "all"（管理员）/ "self"（普通用户）
      const scopeEl = (document.getElementById("tr-scope") as HTMLElement | null);
      if (scopeEl) scopeEl.innerHTML = scope === "all"
        ? "当前为 <b>管理员</b> 视角：显示 <b>全部</b> 调用记录（含匿名调用）。"
        : "当前视角：仅显示 <b>你本人</b> 的调用记录（匿名调用不可见）。";
      const typeFilter = (document.getElementById("tr-type") as HTMLSelectElement).value;
      const traces = (data.traces || []).filter((t: any) => !typeFilter || t.type === typeFilter);
      const total = traces.length;
      const errs = traces.filter((t: any) => t.status === "error").length;
      const avgLat = total ? Math.round(traces.reduce((s: number, t: any) => s + (t.latencyMs || 0), 0) / total) : 0;
      const tok = traces.reduce((s: number, t: any) => s + (t.totalTokens || 0), 0);
      const sum = (document.getElementById("tr-summary") as HTMLElement);
      if (sum) sum.innerHTML = [["总调用", total], ["错误", errs], ["平均延迟", (avgLat / 1000).toFixed(1) + "s"], ["累计 Token", tok]]
        .map((kv) => `<div class="pill" style="background:#f0e8d8;color:var(--slate);">${kv[0]}：<b>${kv[1]}</b></div>`).join("");
      if (!traces.length) { wrap.innerHTML = '<p class="muted">还没有任何调用记录。去生成或测试一条提示词，这里就会出现 trace。</p>'; return; }
      wrap.innerHTML = traces.map(trCard).join("");
      wrap.querySelectorAll(".tr-expand").forEach(b => b.addEventListener("click", () => {
        const box = document.getElementById("tr-steps-" + b.getAttribute("data-id"));
        if (box) box.style.display = box.style.display === "none" ? "block" : "none";
      }));
    } catch (e) {
      const msg = ((e as any).message || "");
      if (msg.indexOf("请先登录") >= 0) {
        wrap.innerHTML = '<p class="muted">登录态已失效，请 <a href="#" onclick="location.reload();return false;">刷新页面重新登录</a> 后再查看。</p>';
      } else {
        wrap.innerHTML = '<p class="muted">加载失败：' + esc(msg) + '</p>';
      }
    }
  }
  const refresh = (document.getElementById("tr-refresh") as HTMLButtonElement);
  if (refresh) refresh.addEventListener("click", load);
  const typeSel = (document.getElementById("tr-type") as HTMLSelectElement);
  if (typeSel) typeSel.addEventListener("change", load);
  load();
}

export function trCard(t: any): string {
  const time = new Date(t.createdAt).toLocaleString("zh-CN", { hour12: false });
  const steps = (t.steps || []).map((s: string) => `<span class="tag" style="background:#fff;border:1px solid var(--brand-100);">${esc(s)}</span>`).join(" ");
  const statusBadge = t.status === "error" ? '<span class="pill pill-red">错误</span>' : '<span class="pill pill-green">成功</span>';
  return `<div class="card tpl-card" style="margin-top:12px;">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div><b>${esc(t.type)}</b> ${statusBadge} <span class="muted" style="font-size:.75rem;">${esc(t.provider || "")} · ${esc(t.model || "")}</span></div>
      <div class="muted" style="font-size:.75rem;">${time}</div>
    </div>
    <div class="muted" style="font-size:.78rem;margin-top:4px;">⏱ ${((t.latencyMs || 0) / 1000).toFixed(1)}s · 📥 ${(t.promptTokens || 0)} 📤 ${(t.completionTokens || 0)} 📊 ${(t.totalTokens || 0)}</div>
    ${t.preview ? `<div class="muted" style="font-size:.75rem;margin-top:2px;">📝 ${esc(t.preview)}</div>` : ""}
    ${t.error ? `<div class="tr-error" style="margin-top:6px;">✗ ${esc(t.error)}</div>` : ""}
    ${(t.steps && t.steps.length) ? `<button class="btn btn-ghost btn-sm tr-expand" data-id="${esc(t.id)}" style="margin-top:8px;">查看步骤（${(t.steps || []).length}）</button><div id="tr-steps-${esc(t.id)}" class="tr-steps" style="display:none;margin-top:8px;">${steps}</div>` : ""}
  </div>`;
}
