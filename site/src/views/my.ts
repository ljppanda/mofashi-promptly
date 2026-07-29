// views/my.ts — 我的模板（按分类分组）（Component 模式）。
import { ctx } from "../core/ctx.js";
import { esc } from "../core/ui.js";
import { Store } from "../store.js";
import { iconFor } from "./home.js";
import { ALL_INDUSTRIES } from "../core/config.js";
import { openImportFile } from "./import.js";
import { openPublishForm } from "./community.js";

export function myTemplates(): void {
  // 合并“我的模板”与“AI 草稿”（去重，我的模板优先），刷新后草稿也能在此找到
  const mine = Store.getMine();
  const drafts = Store.getDrafts().filter(d => !mine.some(m => m.slug === d.slug));
  const all = mine.concat(drafts);
  ctx.appEl().innerHTML = `
    <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
    <div class="flex items-center justify-between mt-2">
      <h1 class="section-title" style="font-size:1.7rem;">我的模板</h1>
      <button id="my-import" class="btn btn-ghost btn-sm">📥 导入模板</button>
    </div>
    ${all.length
      ? groupedMineHtml(all)
      : '<p class="muted" style="margin-top:16px;">还没有收藏的模板。在模板详情页点「收藏到我的模板」即可，AI 生成的草稿也会自动保留在此；也可点右上「导入模板」载入本地 JSON。</p>'}
  `;
  const ib = (document.getElementById("my-import") as HTMLButtonElement);
  if (ib) ib.addEventListener("click", openImportFile);
  ctx.appEl().querySelectorAll(".del-btn").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault();
    const slug = b.getAttribute("data-slug");
    if (!slug) return;
    if (!confirm("确定删除该模板？删除后将从「我的模板」移除（热度榜统计不受影响）。")) return;
    if (Store.hasMine(slug)) Store.removeMine(slug);
    else Store.removeDraft(slug);
    myTemplates();
  }));
  ctx.appEl().querySelectorAll(".pub-btn").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault();
    const slug = b.getAttribute("data-slug");
    if (!slug) return;
    const t = Store.findAny(slug);
    if (!t) return;
    openPublishForm({
      title: t.title,
      industry: t.industry || "其他",
      tags: t.tags || [],
      prompt: t.prompt || "",
      note: t.summary || "",
    });
  }));
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
      <button class="pub-btn" data-slug="${esc(t.slug)}" title="发布到社区">📣 发布</button>
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
