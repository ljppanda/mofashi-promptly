// views/board.ts — 热度榜（Component 模式）。
import { ctx } from "../core/ctx.js";
import { esc } from "../core/ui.js";

export async function board(): Promise<void> {
  ctx.appEl().innerHTML = `
    <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
    <h1 class="section-title" style="font-size:1.7rem;margin-top:10px;">🔥 热度榜</h1>
    <p class="muted" style="margin-top:6px;">按「使用人次 / 收藏人次 / 评分」综合排序。数据由服务端真实累计（首次含演示初始数据）。</p>
    <div class="flex gap-2 mt-3 flex-wrap">
      <button class="btn btn-ghost btn-sm sort-btn" data-sort="heat">综合热度</button>
      <button class="btn btn-ghost btn-sm sort-btn" data-sort="uses">使用人次</button>
      <button class="btn btn-ghost btn-sm sort-btn" data-sort="favorites">收藏人次</button>
      <button class="btn btn-ghost btn-sm sort-btn" data-sort="rating">评分</button>
    </div>
    <div id="board-wrap" class="mt-4">加载中…</div>
  `;
  document.querySelectorAll(".sort-btn").forEach(b => b.addEventListener("click", () => {
    ctx.currentSort = b.getAttribute("data-sort") || "heat";
    renderBoard(ctx.currentSort);
  }));
  renderBoard(ctx.currentSort || "heat");
}

export async function renderBoard(sort: string): Promise<void> {
  const wrap = (document.getElementById("board-wrap") as HTMLElement);
  if (!wrap) return;
  wrap.innerHTML = "加载中…";
  try {
    const rows = await (await fetch("/metrics/board?sort=" + sort + "&limit=100")).json();
    if (!rows || !rows.length) { wrap.innerHTML = '<p class="muted">暂无数据。</p>'; return; }
    wrap.innerHTML = `<table class="board-table">
      <thead><tr><th>#</th><th>模板</th><th>行业</th><th>使用</th><th>收藏</th><th>评分</th><th>热度分</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${i + 1}</td>
        <td><a href="${r.id ? "#/t/" + encodeURIComponent(r.id) : "#"}" class="board-link">${esc(r.title)}</a></td>
        <td>${esc(r.industry)}</td>
        <td>${r.uses}</td>
        <td>${r.favorites}</td>
        <td>${r.avgRating ? r.avgRating.toFixed(1) : "—"}<span class="muted"> (${r.ratingCount})</span></td>
        <td><b>${Math.round(r.heat)}</b></td>
      </tr>`).join("")}</tbody>
    </table>`;
  } catch (e) {
    wrap.innerHTML = '<p class="muted">加载失败：' + esc((e as any).message) + '</p>';
  }
}
