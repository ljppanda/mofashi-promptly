// views/collections.ts — 合集/专辑列表页与详情页（报告 #2，C4）。
// 合集是用户把已公开社区模板收进的命名分组（对标 Snack Prompt 的 List），提升 UGC 组织与留存。
import { ctx } from "../core/ctx.js";
import { esc, setMeta, toast } from "../core/ui.js";
import { LLM } from "../llm.js";
import { communityCard, reportDialog } from "./community.js";

function collectionCard(c: any): string {
  return `<div class="card tpl-card col-card" data-id="${esc(c.id)}" style="margin-top:12px;cursor:pointer;">
    <div class="flex items-center justify-between">
      <span class="pill pill-violet">📚 合集</span>
      <span class="text-xs muted">${c.authorId ? `<a href="#/u/${esc(c.authorId)}" class="author-link">${esc(c.author)}</a>` : esc(c.author)} · ${c.itemCount || 0} 个模板</span>
    </div>
    <h3 style="margin-top:6px;">${esc(c.title)}</h3>
    ${c.description ? `<p class="muted" style="font-size:.85rem;margin-top:4px;">${esc(c.description)}</p>` : ""}
  </div>`;
}

// 新建合集弹窗（需登录；未登录时后端返回 401，这里捕获提示去登录）
export function openCreateCollectionModal(): void {
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.id = "col-create-overlay";
  ov.innerHTML = `
    <div class="modal-card card" style="max-width:520px;width:94%;">
      <div class="flex items-center justify-between">
        <div class="ttl">＋ 新建合集</div>
        <button id="col-create-close" class="btn btn-ghost btn-sm">关闭</button>
      </div>
      <p class="muted mt-2" style="font-size:.8rem;">给合集起个名字，再把同类提示词收进去。合集公开可见，仅你能增删成员。</p>
      <div class="mt-3">
        <label class="text-sm font-medium" style="color:var(--slate)">合集标题</label>
        <input id="col-title" class="input" style="margin-top:4px;" placeholder="例如：职场效率全家桶 / 爆款小红书合集" maxlength="120" />
      </div>
      <div class="mt-2">
        <label class="text-sm font-medium" style="color:var(--slate)">简介（可选）</label>
        <textarea id="col-desc" class="input" rows="2" style="margin-top:4px;" placeholder="一句话说明这个合集收了什么" maxlength="500"></textarea>
      </div>
      <div class="flex gap-2 mt-3 items-center">
        <button id="col-create-go" class="btn btn-primary btn-sm">创建</button>
        <span id="col-create-msg" class="muted" style="font-size:.78rem;"></span>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  (document.getElementById("col-create-close") as HTMLButtonElement)?.addEventListener("click", close);
  const go = (document.getElementById("col-create-go") as HTMLButtonElement);
  const msg = (document.getElementById("col-create-msg") as HTMLElement);
  go.addEventListener("click", async () => {
    const title = (document.getElementById("col-title") as HTMLInputElement).value.trim();
    if (!title) { toast("请填写合集标题"); return; }
    go.disabled = true;
    try {
      const r = await LLM.createCollection(title, (document.getElementById("col-desc") as HTMLTextAreaElement).value.trim());
      toast("✓ 已创建合集");
      close();
      location.hash = "#/col/" + encodeURIComponent(r.id);
    } catch (e2) {
      msg.textContent = (e2 as any)?.message || String(e2);
      toast("创建失败：" + ((e2 as any)?.message || e2));
      go.disabled = false;
    }
  });
}

export async function collectionsPage(): Promise<void> {
  setMeta("合集 · 模法师 Promptly", "浏览社区成员整理的提示词合集，把同类模板收进一个合集方便发现与回看。");
  ctx.appEl().innerHTML = `
    <a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a>
    <div class="flex items-center justify-between mt-3">
      <h1 class="section-title" style="font-size:1.7rem;">📚 合集</h1>
      <button id="col-new" class="btn btn-primary btn-sm">＋ 新建合集</button>
    </div>
    <p class="muted mt-2" style="font-size:.85rem;">把同类提示词收进一个合集，方便自己回看，也方便别人发现好内容。</p>
    <div id="col-wrap" class="mt-4">加载中…</div>
  `;
  const newBtn = (document.getElementById("col-new") as HTMLButtonElement);
  if (newBtn) newBtn.addEventListener("click", () => openCreateCollectionModal());
  await loadCollections();
}

async function loadCollections(): Promise<void> {
  const wrap = (document.getElementById("col-wrap") as HTMLElement);
  if (!wrap) return;
  try {
    const rows = await LLM.communityCollections();
    if (!rows.length) {
      wrap.innerHTML = '<p class="muted">还没有合集，点右上角「新建合集」创建第一个吧。</p>';
      return;
    }
    wrap.innerHTML = rows.map(collectionCard).join("");
    wrap.querySelectorAll(".col-card").forEach(c => c.addEventListener("click", () => {
      location.hash = "#/col/" + encodeURIComponent(c.getAttribute("data-id"));
    }));
  } catch (e) {
    wrap.innerHTML = '<p class="muted">加载失败：' + esc((e as any).message) + '</p>';
  }
}

export async function collectionDetailPage(id: string): Promise<void> {
  setMeta("合集详情 · 模法师 Promptly", "查看合集内的提示词模板。");
  ctx.appEl().innerHTML = `<a href="#/collections" class="back-link" onclick="goBack();return false;">← 返回合集</a><div class="mt-3 muted">加载中…</div>`;
  let data: any;
  try { data = await LLM.collectionDetail(id); }
  catch (e) {
    ctx.appEl().innerHTML = `<a href="#/collections" class="back-link" onclick="goBack();return false;">← 返回合集</a><p class="mt-3">加载失败：${esc((e as any).message)}</p>`;
    return;
  }
  const items = data.items || [];
  ctx.appEl().innerHTML = `
    <a href="#/collections" class="back-link" onclick="goBack();return false;">← 返回合集</a>
    <div class="mt-3">
      <div class="flex items-center gap-2">
        <span class="pill pill-violet">📚 合集</span>
        <span class="text-xs muted">${data.authorId ? `<a href="#/u/${esc(data.authorId)}" class="author-link">${esc(data.author)}</a>` : esc(data.author)} · ${items.length} 个模板</span>
      </div>
      <h1 class="section-title" style="font-size:1.5rem;margin-top:8px;">${esc(data.title)}</h1>
      ${data.description ? `<p class="muted" style="font-size:.9rem;margin-top:6px;">${esc(data.description)}</p>` : ""}
    </div>
    <div id="col-items" class="mt-4">${items.length ? items.map((r: any) => communityCard(r, "square")).join("") : '<p class="muted">这个合集还没有模板。</p>'}</div>
  `;
  const wrap = (document.getElementById("col-items") as HTMLElement);
  if (wrap && items.length) {
    wrap.querySelectorAll(".cm-card").forEach(c => c.addEventListener("click", () => {
      location.hash = "#/c/" + encodeURIComponent(c.getAttribute("data-id"));
    }));
    wrap.querySelectorAll(".cm-report").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      reportDialog(b.getAttribute("data-id"), b.getAttribute("data-title"));
    }));
  }
}
