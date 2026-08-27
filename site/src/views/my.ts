// views/my.ts — 我的模板（按分类分组）（Component 模式）。
// 个人本地工具：模板仅存本机浏览器（localStorage），无云端账号、无社区发布。
import { ctx } from "../core/ctx.js";
import { esc } from "../core/ui.js";
import { Store } from "../store.js";
import { iconFor } from "./home.js";
import { ALL_INDUSTRIES } from "../core/config.js";
import { openImportFile } from "./import.js";

export function myTemplates(): void {
  // 合并“我的模板”与“AI 草稿”（去重，我的模板优先），刷新后草稿也能在此找到
  const mine = Store.getMine();
  const drafts = Store.getDrafts().filter(d => !mine.some(m => m.slug === d.slug));
  const all = mine.concat(drafts);
  let activeTag: string | null = null; // F37 标签筛选状态
  ctx.appEl().innerHTML = `
    <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
    <div class="flex items-center justify-between mt-2">
      <h1 class="section-title" style="font-size:1.7rem;">我的模板</h1>
      <button id="my-import" class="btn btn-ghost btn-sm">📥 导入模板</button>
    </div>
    <p class="muted" style="font-size:.8rem;margin-top:10px;">（以下为本设备本地模板，仅保存在当前浏览器）</p>
    ${all.length
      ? `<div id="my-tags" class="cm-tagcloud mt-3"></div>
         <div id="my-body" class="mt-4"></div>`
      : '<p class="muted" style="margin-top:16px;">还没有收藏的模板。在模板详情页点「收藏到我的模板」即可，AI 生成的草稿也会自动保留在此；也可点右上「导入模板」载入本地 JSON。</p>'}
  `;
  const ib = (document.getElementById("my-import") as HTMLButtonElement);
  if (ib) ib.addEventListener("click", openImportFile);

  // F37 标签云筛选：按当前全部模板的标签频率排序，点击即按该标签过滤分组列表
  function renderTags(): void {
    const el = document.getElementById("my-tags");
    if (!el) return;
    const freq: Record<string, number> = {};
    all.forEach((t: any) => (t.tags || []).forEach((tg: string) => { freq[tg] = (freq[tg] || 0) + 1; }));
    const tags = Object.entries(freq).sort((a: any, b: any) => b[1] - a[1]).slice(0, 30).map(([t, c]) => ({ t, c }));
    el.innerHTML = tags.length
      ? `<span class="muted" style="font-size:.75rem;margin-right:6px;">🔖 按标签筛选</span>` +
        tags.map((x: any) => `<button class="cm-tag${activeTag === x.t ? " active" : ""}" data-tag="${esc(x.t)}">#${esc(x.t)} <span class="cm-tag-c">${x.c}</span></button>`).join("") +
        (activeTag ? `<button class="cm-tag cm-tag-clear" data-clear="1">✕ 清除筛选</button>` : "")
      : "";
    el.querySelectorAll<HTMLElement>(".cm-tag").forEach(b => b.addEventListener("click", () => {
      if (b.getAttribute("data-clear")) { activeTag = null; }
      else { const tg = b.getAttribute("data-tag") || ""; activeTag = activeTag === tg ? null : tg; }
      render();
    }));
  }

  function renderBody(): void {
    const el = (document.getElementById("my-body") as HTMLElement);
    if (!el) return;
    const list = activeTag ? all.filter((t: any) => (t.tags || []).includes(activeTag)) : all;
    const head = activeTag ? `<p class="muted" style="font-size:.8rem;margin-bottom:6px;">已筛选标签 <b>#${esc(activeTag)}</b>，共 ${list.length} 个模板</p>` : "";
    el.innerHTML = head + (list.length ? groupedMineHtml(list) : `<p class="muted">没有带「#${esc(activeTag || "")}」标签的模板。</p>`);
    el.querySelectorAll<HTMLElement>(".del-btn").forEach(b => b.addEventListener("click", (e) => {
      e.preventDefault();
      const slug = b.getAttribute("data-slug");
      if (!slug) return;
      if (!confirm("确定删除该模板？删除后将从「我的模板」移除（热度榜统计不受影响）。")) return;
      if (Store.hasMine(slug)) Store.removeMine(slug);
      else Store.removeDraft(slug);
      render();
    }));
  }

  function render(): void { renderTags(); renderBody(); }
  render();
}

// 我的模板专属卡片：通用卡片 + 删除按钮
function mineCard(t: any): string {
  const badge = t.imported
    ? '<span class="pill pill-green">导入</span>'
    : (t.generated ? '<span class="pill pill-amber">AI 生成</span>' : "");
  return `<div class="mine-card-wrap">
    <a href="#/t/${encodeURIComponent(t.slug)}" class="card tpl-card">
      <div class="flex items-center justify-between">
        <span class="pill pill-violet">${esc(t.industry)}</span>
        <span class="text-xs muted">${esc(t.task || "")} ${badge}</span>
      </div>
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.summary || "")}</p>
    </a>
    <div class="mine-card-actions">
      <button class="del-btn" data-slug="${esc(t.slug)}" title="删除此模板">🗑 删除</button>
    </div>
  </div>`;
}

function groupedMineHtml(mine: any[]): string {
  const groups: Record<string, any[]> = {};
  mine.forEach(t => {
    const k = t.industry || "其他";
    (groups[k] = groups[k] || []).push(t);
  });
  const order = ALL_INDUSTRIES.slice();
  const keys = Object.keys(groups).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b, "zh");
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys.map(k => `
    <section class="mt-5">
      <h2 class="section-title" style="font-size:1.05rem;display:flex;align-items:center;gap:8px;">
        <span>${iconFor(k)}</span><span>${esc(k)}</span>
        <span class="muted" style="font-size:.78rem;font-weight:600;">${groups[k].length} 个</span>
      </h2>
      <div class="grid sm:grid-cols-2 gap-3" style="margin-top:10px;">${groups[k].map(mineCard).join("")}</div>
    </section>`).join("");
}
