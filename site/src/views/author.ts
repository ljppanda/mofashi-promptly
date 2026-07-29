// views/author.ts — 作者主页（Component 模式）。
import { ctx } from "../core/ctx.js";
import { esc, setMeta } from "../core/ui.js";
import { LLM } from "../llm.js";
import { communityCard, reportDialog } from "./community.js";

export async function authorPage(authorId: string): Promise<void> {
  ctx.appEl().innerHTML = `<a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a><div class="mt-3 muted">加载中…</div>`;
  let data: any;
  try { data = await LLM.communityAuthor(authorId); }
  catch (e) {
    ctx.appEl().innerHTML = `<a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a><p class="mt-3">加载失败：${esc((e as any).message)}</p>`;
    return;
  }
  const items = data.items || [];
  setMeta("👤 " + data.author + " · 模法师 Promptly", (data.author || "作者") + " 发布了 " + items.length + " 个提示词模板");
  ctx.appEl().innerHTML = `
    <a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a>
    <div class="mt-3">
      <h1 class="section-title" style="font-size:1.5rem;">👤 ${esc(data.author)}</h1>
      <div class="muted" style="font-size:.85rem;margin-top:6px;">${items.length} 个已公开模板</div>
    </div>
    <div id="author-wrap" class="mt-4">${items.length ? items.map(r => communityCard(r, "square")).join("") : '<p class="muted">该作者还没有公开的模板。</p>'}</div>
  `;
  const wrap = (document.getElementById("author-wrap") as HTMLElement);
  if (wrap && items.length) {
    wrap.querySelectorAll(".cm-card").forEach(c => c.addEventListener("click", () => { location.hash = "#/c/" + encodeURIComponent(c.getAttribute("data-id")); }));
    wrap.querySelectorAll(".cm-report").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      reportDialog(b.getAttribute("data-id"), b.getAttribute("data-title"));
    }));
  }
}
