// views/community.ts — 社区广场 / 详情 / 审核台 / 发布 / 举报（Component 模式）。
// 社区详情页的测试沙盒与评分逻辑（cSend/cClear/cRate/cLoadRate/highlightStarsC）也置于本模块，
// 与模板详情页共享 refine 改写逻辑（来自 refine.ts），避免循环依赖。
import { ctx } from "../core/ctx.js";
import { esc, setMeta, toast, confirmDialog, fmtUsage, fmtRelative } from "../core/ui.js";
import { ALL_INDUSTRIES } from "../core/config.js";
import { LLM } from "../llm.js";
import { Store } from "../store.js";
import { openRefineBox, closeRefineBox, handleRefine, communityRefineCtx } from "./refine.js";
import { openPreviewModal } from "./preview.js";
import { loadSummary, renderIndustryDist, iconFor } from "./home.js"; // 提案2：社区新鲜度信号（今日新增 N 条）
import { openOptimizeModal } from "./optimize.js"; // r9：社区卡片「🔧 优化」入口（复用 F13）

// r9：把社区模板派生为「我的模板」（带来源标记），复用 F11 Remix 闭环；详情页与列表卡片共用
export function remixToMine(row: any, prompt?: string): void {
  const tpl: any = {
    slug: "fork-" + row.id + "-" + Date.now().toString(36),
    title: row.title + "（派生）",
    industry: row.industry,
    task: "社区派生",
    summary: row.note || "从社区派生的提示词",
    tags: row.tags || [],
    prompt: prompt !== undefined ? prompt : row.prompt,
    variables: [],
    mine: true,
    generated: false,
    forkedFrom: row.id,
    forkedFromTitle: row.title,
  };
  Store.addMine(tpl);
  toast("✓ 已派生到「我的模板」，可直接编辑改造");
  location.hash = "#/t/" + tpl.slug; // 跳详情页（canEdit 因 forkedFrom 为真），改造后可再「发布到社区」
}

// 公开前重复确认（#6 反垃圾去重）：后端在 publish-now 命中相似模板时返回 needsConfirm，
// 这里弹确认框，用户确认后带 confirmDuplicate 重调才真正公开。返回最终状态供调用方决定是否刷新列表。
function publishNowWithDupCheck(id: string): Promise<"published" | "cancelled" | "error"> {
  return new Promise((resolve) => {
    (async () => {
      try {
        const res = await LLM.communityPublishNow(id);
        if (res && res.needsConfirm) {
          const names = (res.similar || []).map((s: any) => s.title).join("、");
          confirmDialog(
            "社区已有相似模板",
            "公开前发现 " + (res.similar || []).length + " 条高度相似的公开模板：\n" + names + "\n\n为避免重复投稿，确认仍要公开吗？",
            async () => {
              await LLM.communityPublishNow(id, true);
              toast("✓ 已公开到社区广场");
              resolve("published");
            },
            { confirmLabel: "仍要公开", cancelLabel: "取消", danger: false, onCancel: () => { toast("已取消公开（避免重复投稿）"); resolve("cancelled"); } }
          );
          return;
        }
        toast("✓ 已公开到社区广场");
        resolve("published");
      } catch (e) {
        toast("公开失败：" + (e as any).message);
        resolve("error");
      }
    })();
  });
}

// 行业主题色（封面占位图渐变）：无封面时按行业给出视觉区分，提升列表视觉吸引力
const INDUSTRY_PH: Record<string, string> = {
  "写作创作": "linear-gradient(135deg,#d98c7a,#b5564a)",
  "编程开发": "linear-gradient(135deg,#7fa69a,#3f6b5a)",
  "职场办公": "linear-gradient(135deg,#c9a36b,#9a7233)",
  "教育培训": "linear-gradient(135deg,#d8b06a,#b07f2e)",
  "电商运营": "linear-gradient(135deg,#d98f6f,#b5532f)",
  "金融": "linear-gradient(135deg,#b5805a,#7a4a2b)",
  "医疗健康": "linear-gradient(135deg,#7fa6a0,#3f6f68)",
  "法律": "linear-gradient(135deg,#9a9484,#5a5343)",
};
export function industryPh(ind: string): string {
  return INDUSTRY_PH[ind] || "linear-gradient(135deg,#b5805a,#7a4a2b)";
}

// ---------- 社区分享（M18） ----------
// 发布弹窗：从详情页 / 我的模板复用。prefill: {title, industry, tags, prompt, note, author, cover}
let summaryCache: any = null; // 缓存 /metrics/summary，供新鲜度信号使用
export function openPublishForm(prefill: any): void {
  prefill = prefill || {};
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `
    <div class="modal-card card">
      <div class="ttl">📣 发布到社区（先进入你的草稿，公开后即可在广场可见）</div>
      <div class="muted" style="font-size:.78rem;margin-top:4px;">发布的是「提示词 / 模板正文」，他人可克隆到自己的模板库或直接在沙盒里测试。</div>
      <div class="mt-3">
        <label class="text-sm font-medium">标题</label>
        <input id="pf-title" class="input" style="margin-top:4px;" value="${esc(prefill.title || "")}" placeholder="给这条提示词起个名字" />
      </div>
      <div class="flex gap-3 mt-3">
        <div style="flex:1;">
          <label class="text-sm font-medium">行业</label>
          <select id="pf-industry" class="select" style="margin-top:4px;width:100%;">${ALL_INDUSTRIES.map(i => `<option value="${esc(i)}" ${i === (prefill.industry || "其他") ? "selected" : ""}>${esc(i)}</option>`).join("")}</select>
        </div>
        <div style="flex:1;">
          <label class="text-sm font-medium">作者（可选）</label>
          <input id="pf-author" class="input" style="margin-top:4px;" placeholder="匿名" value="${esc(prefill.author || "")}" />
        </div>
      </div>
      <div class="mt-3">
        <label class="text-sm font-medium">标签（逗号分隔，可选）</label>
        <input id="pf-tags" class="input" style="margin-top:4px;" value="${esc((prefill.tags || []).join("、"))}" placeholder="如：法律、合同、咨询" />
      </div>
      <div class="mt-3">
        <label class="text-sm font-medium">留言（可选，告诉大家适合什么场景）</label>
        <textarea id="pf-note" class="input" rows="2" style="margin-top:4px;">${esc(prefill.note || "")}</textarea>
      </div>
      <div class="mt-3">
        <label class="text-sm font-medium">封面图链接（可选）</label>
        <input id="pf-cover" class="input" style="margin-top:4px;" value="${esc(prefill.cover || "")}" placeholder="粘贴图片 URL（http(s) 或 data:image），留空则显示行业占位图" />
      </div>
      <div class="mt-3">
        <label class="text-sm font-medium">提示词正文（将发布的内容）</label>
        <pre id="pf-prompt" class="code-box" style="margin-top:4px;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;">${esc(prefill.prompt || "")}</pre>
      </div>
      <div id="pf-msg" class="muted" style="font-size:.78rem;margin-top:8px;"></div>
      <div class="flex gap-2 mt-3 flex-wrap items-center">
        <button id="pf-submit" class="btn btn-primary btn-sm">📤 发布到我的草稿</button>
        <button id="pf-cancel" class="btn btn-ghost btn-sm">取消</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  const cancelBtn = (document.getElementById("pf-cancel") as HTMLButtonElement);
  if (cancelBtn) cancelBtn.addEventListener("click", close);
  const submitBtn = (document.getElementById("pf-submit") as HTMLButtonElement);
  if (submitBtn) submitBtn.addEventListener("click", async () => {
    const title = (document.getElementById("pf-title") as HTMLInputElement).value.trim();
    const prompt = (prefill.prompt || "").trim();
    if (!title) { (document.getElementById("pf-msg") as HTMLElement).textContent = "请填写标题。"; return; }
    if (!prompt) { (document.getElementById("pf-msg") as HTMLElement).textContent = "没有可发布的提示词正文。"; return; }
    const tags = (document.getElementById("pf-tags") as HTMLInputElement).value.split(/[,，、]/).map(s => s.trim()).filter(Boolean).slice(0, 8);
    const author = (document.getElementById("pf-author") as HTMLInputElement).value.trim() || "匿名";
    const note = (document.getElementById("pf-note") as HTMLTextAreaElement).value.trim();
    const cover = (document.getElementById("pf-cover") as HTMLInputElement).value.trim();
    const industry = (document.getElementById("pf-industry") as HTMLSelectElement).value;
    submitBtn.disabled = true; submitBtn.style.opacity = ".55";
    (document.getElementById("pf-msg") as HTMLElement).textContent = "发布中…";
    try {
      const pubRes = await LLM.communityPublish({ id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), title, industry, author, tags, note, cover, prompt });
      close();
      toast("✓ 已发布到草稿「" + title + "」，去社区广场-我的发布里点「公开」即可上架");
      // 发布去重（C3）：后端附带的相似模板提示，不打断流程
      if (pubRes && pubRes.similar && pubRes.similar.length) {
        setTimeout(() => toast("⚠ 社区已有相似模板：" + pubRes.similar.map((s: any) => s.title).join("、")), 800);
      }
    } catch (e) {
      (document.getElementById("pf-msg") as HTMLElement).textContent = "发布失败：" + (e as any).message;
      submitBtn.disabled = false; submitBtn.style.opacity = "1";
    }
  });
}

// 举报弹窗（社区广场已公开内容）
export function reportDialog(id: string, title: string): void {
  if (!LLM.authIsAuthed()) {
    toast("举报需先登录");
    window.Auth!.ensure().then((t) => { if (t) reportDialog(id, title); });
    return;
  }
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `
    <div class="modal-card card" style="max-width:420px;">
      <div class="ttl">⚠ 举报内容</div>
      <p class="slate" style="margin-top:8px;font-size:.85rem;">${esc(title)}</p>
      <label class="block text-sm font-medium mb-1 mt-3" style="color:var(--slate)">举报原因</label>
      <select id="rd-reason" class="select" style="width:100%;">
        <option value="违规/不良信息">违规 / 不良信息</option>
        <option value="涉嫌抄袭">涉嫌抄袭</option>
        <option value="内容质量差">内容质量差</option>
        <option value="重复/垃圾">重复 / 垃圾信息</option>
        <option value="其他">其他</option>
      </select>
      <label class="block text-sm font-medium mb-1 mt-3" style="color:var(--slate)">补充说明（可选）</label>
      <textarea id="rd-detail" class="input" rows="3" style="width:100%;" placeholder="补充细节，帮助管理员判断…"></textarea>
      <div class="flex gap-2 mt-4 flex-wrap items-center">
        <button id="rd-yes" class="btn btn-danger btn-sm">提交举报</button>
        <button id="rd-no" class="btn btn-ghost btn-sm">取消</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  const no = (document.getElementById("rd-no") as HTMLButtonElement);
  if (no) no.addEventListener("click", close);
  const yes = (document.getElementById("rd-yes") as HTMLButtonElement);
  if (yes) yes.addEventListener("click", async () => {
    yes.disabled = true; yes.style.opacity = ".55";
    const reason = (document.getElementById("rd-reason") as HTMLSelectElement).value;
    const detail = (document.getElementById("rd-detail") as HTMLTextAreaElement).value.trim();
    try {
      await LLM.communityReport(id, reason, detail);
      toast("✓ 举报已提交，管理员会处理");
      close();
    } catch (e2) {
      toast("举报失败：" + ((e2 as any) && (e2 as any).message ? (e2 as any).message : e2));
      yes.disabled = false; yes.style.opacity = "1";
    }
  });
}

// F36 社区量级背书条：用全站聚合指标（/metrics/summary）做「社会证明」，零后端改动。
// 展示公开提示词数 / 累计使用数 / 累计收藏数，给新访客即时信任感（report-2026-08-18 #3）。
function fmtNum(n: number | undefined): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + "万";
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function renderScaleBar(s: any): void {
  const el = document.getElementById("cm-scale-bar");
  if (!el) return;
  if (!s) { el.innerHTML = ""; return; }
  const pub = fmtNum(s.communityPublished);
  const uses = fmtNum(s.totalUses);
  const fav = fmtNum(s.totalFavorites);
  const creators = s.creators ? fmtNum(s.creators) : null;
  const items = [
    { num: pub, label: "公开提示词" },
    { num: uses, label: "累计使用" },
    { num: fav, label: "累计收藏" },
  ];
  const chips = items.map((it, i) =>
    `<div class="cm-scale-item">
       <div class="cm-scale-num">${it.num}</div>
       <div class="cm-scale-label">${it.label}</div>
     </div>${i < items.length - 1 ? '<span class="cm-scale-sep"></span>' : ""}`
  ).join("");
  const tail = creators ? ` · 来自 <b>${creators}</b> 位创作者` : "";
  el.innerHTML = `
    <div class="cm-scale-head">
      <span class="cm-scale-kicker">📣 社区数据 · 真实量级</span>
    </div>
    <div class="cm-scale-grid">${chips}</div>
    <div class="cm-scale-foot">这些提示词已被真实使用与收藏${tail}，变量化模板，填一句目标即可生成</div>
  `;
}

export async function community(): Promise<void> {
  setMeta("社区广场 · 模法师 Promptly", "浏览社区成员分享的 AI 提示词模板，克隆、测试、评分、评论。");
  ctx.appEl().innerHTML = `
    <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
    <h1 class="section-title" style="font-size:1.7rem;margin-top:8px;">社区广场</h1>
    <div id="cm-scale-bar" class="cm-scale-bar mt-3"></div>
    <div class="flex items-center gap-2 mt-3 flex-wrap">
      <button class="btn btn-ghost btn-sm tab-btn active" data-tab="square">🏠 社区广场</button>
      <button class="btn btn-ghost btn-sm tab-btn" data-tab="mine">📂 我的发布</button>
      ${LLM.isAdmin() ? '<button class="btn btn-ghost btn-sm tab-btn" data-tab="mod">🛡 审核台</button>' : ""}
      <a href="#/collections" class="btn btn-ghost btn-sm" style="margin-left:auto;">📚 合集</a>
    </div>
    <div class="flex items-center gap-2 mt-3 flex-wrap">
      <input id="cm-q" class="input" style="flex:1;min-width:160px;" placeholder="搜索标题 / 行业 / 标签 / 正文…" />
      <button id="cm-search" class="btn btn-ghost btn-sm">🔍 搜索</button>
      <select id="cm-industry" class="select" style="width:auto;">
        <option value="全部">全部行业</option>
        ${ALL_INDUSTRIES.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join("")}
      </select>
      <select id="cm-sort" class="select" style="width:auto;">
        <option value="heat">最热</option>
        <option value="new">最新</option>
        <option value="rating">评分最高</option>
        <option value="favorites">收藏最多</option>
        <option value="uses">使用最多</option>
      </select>
    </div>
    <div id="cm-tags" class="cm-tagcloud mt-3"></div>
    <div id="cm-stats" class="community-stats mt-3"></div>
    <div id="cm-ind-dist" class="mt-3"></div>
    <div id="cm-wrap" class="mt-4">加载中…</div>
  `;
  let tab = "square";
  const qEl = (document.getElementById("cm-q") as HTMLInputElement);
  const _hs = (window as any).__headerSearch;
  if (_hs) { (window as any).__headerSearch = undefined; qEl.value = _hs; }
  const sortEl = (document.getElementById("cm-sort") as HTMLSelectElement);
  const industryEl = (document.getElementById("cm-industry") as HTMLSelectElement);
  async function load() {
    const wrap = (document.getElementById("cm-wrap") as HTMLElement);
    if (!wrap) return;
    if (tab === "mod") { await moderationConsole(load); return; }
    wrap.innerHTML = "加载中…";
    try {
      let rows: any[];
      if (tab === "mine") rows = await LLM.communityMine();
      else rows = await LLM.communityList({ status: "published", sort: sortEl.value, q: qEl.value.trim(), industry: (industryEl && industryEl.value !== "全部") ? industryEl.value : "" });
      if (!rows.length) {
        wrap.innerHTML = tab === "mine"
          ? '<p class="muted">你还没有发布任何提示词。在模板详情页或「我的模板」点「发布到社区」即可创建草稿。</p>'
          : '<p class="muted">社区广场还空空如也，去发布第一条吧！</p>';
        return;
      }
      wrap.innerHTML = rows.map(r => communityCard(r, tab)).join("");
      const industries = new Set(rows.map((r: any) => r.industry).filter(Boolean));
      const statsEl = (document.getElementById("cm-stats") as HTMLElement);
      if (statsEl) {
        let extra = "";
        if (tab === "square" && summaryCache && summaryCache.todayPublished) extra = ` · ✨ 今日新增 <b>${summaryCache.todayPublished}</b> 条`;
        statsEl.innerHTML = `📚 社区共 <b>${rows.length}</b> 条提示词 · 覆盖 <b>${industries.size}</b> 个行业${extra} · 变量化模板，填一句目标即可生成`;
      }
      // 行业×数量聚合计数（report-2026-08-12 #5）：基于当前列表本地聚合，点击跳行业落地页
      const indMap: Record<string, number> = {};
      rows.forEach((r: any) => { const k = r.industry || "其他"; indMap[k] = (indMap[k] || 0) + 1; });
      const indCounts: { industry: string; count: number }[] = Object.keys(indMap)
        .sort((a, b) => indMap[b] - indMap[a])
        .map(k => ({ industry: k, count: indMap[k] }));
      renderIndustryDist(document.getElementById("cm-ind-dist"), indCounts);
      // 标签云（提案③）：按当前列表标签出现频率排序，点击即按该标签过滤
      const tagCount: Record<string, number> = {};
      (rows || []).forEach((r: any) => (r.tags || []).forEach((t: any) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
      const tagsArr = Object.entries(tagCount).sort((a: any, b: any) => b[1] - a[1]).slice(0, 20).map(([t, c]) => ({ t, c }));
      const tagEl = (document.getElementById("cm-tags") as HTMLElement);
      if (tagEl) {
        tagEl.innerHTML = tagsArr.length
          ? `<span class="muted" style="font-size:.75rem;margin-right:6px;">🔖 热门标签</span>` + tagsArr.map((x: any) => `<button class="cm-tag" data-tag="${esc(x.t)}">#${esc(x.t)} <span class="cm-tag-c">${x.c}</span></button>`).join("")
          : "";
        tagEl.querySelectorAll(".cm-tag").forEach(b => b.addEventListener("click", () => {
          if (qEl) qEl.value = b.getAttribute("data-tag") || "";
          load();
        }));
      }
      wrap.querySelectorAll(".cm-card").forEach(c => c.addEventListener("click", () => { location.hash = "#/c/" + encodeURIComponent(c.getAttribute("data-id")); }));
      if (tab === "mine") {
        wrap.querySelectorAll(".cm-publish").forEach(b => b.addEventListener("click", async (e) => {
          e.stopPropagation();
          const st = await publishNowWithDupCheck(b.getAttribute("data-id"));
          if (st === "published") load();
        }));
        wrap.querySelectorAll(".cm-unpublish").forEach(b => b.addEventListener("click", async (e) => {
          e.stopPropagation();
          await LLM.communityUnpublish(b.getAttribute("data-id"));
          toast("已退回草稿");
          load();
        }));
        wrap.querySelectorAll(".cm-del").forEach(b => b.addEventListener("click", async (e) => {
          e.stopPropagation();
          const id = b.getAttribute("data-id");
          confirmDialog("删除这条社区提示词？", "删除后无法恢复，草稿和已公开内容都会一并移除。", async () => {
            try {
              await LLM.communityDelete(id);
              toast("✓ 已删除");
              load();
            } catch (err) {
              toast("删除失败：" + ((err as any) && (err as any).message ? (err as any).message : err));
            }
          });
        }));
      }
      wrap.querySelectorAll(".cm-report").forEach(b => b.addEventListener("click", (e) => {
        e.stopPropagation();
        reportDialog(b.getAttribute("data-id"), b.getAttribute("data-title"));
      }));
      // 列表卡片「🚀 试跑」：复用 F20 示例预览逻辑（用户自带 Key，本地流式跑），降低决策成本
      wrap.querySelectorAll(".cm-try").forEach(b => b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = b.getAttribute("data-id");
        const r = (rows || []).find((x: any) => x.id === id);
        if (r) openPreviewModal(r);
      }));
      // r9：列表卡片「🍴 派生」——复用 F11 Remix 闭环，fork 到我的模板
      wrap.querySelectorAll(".cm-fork").forEach(b => b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = b.getAttribute("data-id");
        const r = (rows || []).find((x: any) => x.id === id);
        if (r) remixToMine(r);
      }));
      // r9：列表卡片「🔧 优化」——复用 F13 一键优化，采用时自动存为我的模板副本（不改写原社区模板）
      wrap.querySelectorAll(".cm-opt").forEach(b => b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = b.getAttribute("data-id");
        const r = (rows || []).find((x: any) => x.id === id);
        if (r) openOptimizeModal({ ...r, slug: r.slug || ("opt-" + r.id) });
      }));
      // F35-② 列表卡片「📤 分享」：打开外部 AI 平台预填弹层（纯前端）
      wrap.querySelectorAll(".cm-share").forEach(b => b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = b.getAttribute("data-id");
        const r = (rows || []).find((x: any) => x.id === id);
        if (r) openShareMenu(r);
      }));
    } catch (e) {
      const msg = (e as any) && (e as any).message ? (e as any).message : String(e);
      // 未登录查看「我的发布」：友好引导登录，而非生硬地报 401
      if (tab === "mine" && /401|未授权|请先登录|登录/.test(msg)) {
        wrap.innerHTML = `
          <div style="padding:16px;border:1px solid var(--brand-100);background:#fff7ed;border-radius:10px;">
            <div style="font-weight:600;">🔐 请登录后查看你的发布</div>
            <p class="muted" style="font-size:.85rem;margin-top:8px;line-height:1.6;">登录后即可看到你发布的草稿与已公开模板，并能公开 / 撤回 / 删除。</p>
            <button id="mine-login" class="btn btn-primary btn-sm" style="margin-top:8px;">登录 / 注册</button>
          </div>`;
        const lb = document.getElementById("mine-login");
        if (lb && window.Auth && window.Auth.ensure) lb.addEventListener("click", () => {
          window.Auth!.ensure().then((t) => { if (t) load(); });
        });
        return;
      }
      wrap.innerHTML = '<p class="muted">加载失败：' + esc(msg) + '</p>';
    }
  }
  document.querySelectorAll("#app .tab-btn").forEach(b => b.addEventListener("click", () => {
    tab = b.getAttribute("data-tab") || "square";
    document.querySelectorAll("#app .tab-btn").forEach(x => x.classList.toggle("active", x === b));
    load();
  }));
  const searchBtn = (document.getElementById("cm-search") as HTMLButtonElement);
  if (searchBtn) searchBtn.addEventListener("click", load);
  if (qEl) qEl.addEventListener("keydown", e => { if (e.key === "Enter") load(); });
  if (sortEl) sortEl.addEventListener("change", load);
  if (industryEl) industryEl.addEventListener("change", load);
  // 提案2：拉取聚合指标，到达后刷新广场以显示「今日新增 N 条」；F36 先渲染量级背书条
  loadSummary().then(s => { summaryCache = s; renderScaleBar(s); if (tab === "square") load(); });
  // 已有缓存时立即渲染背书条，避免空白等待
  if (summaryCache) renderScaleBar(summaryCache);
  load();
}

export async function moderationConsole(reload: () => void | Promise<void>): Promise<void> {
  const wrap = (document.getElementById("cm-wrap") as HTMLElement);
  if (!wrap) return;
  wrap.innerHTML = "加载中…";
  if (!LLM.isAdmin()) {
    wrap.innerHTML = '<p class="muted">审核台仅管理员可见，请先在「设置」中用管理员口令登录。</p>';
    return;
  }
  let data: any;
  try { data = await LLM.communityModeration(); }
  catch (e) { wrap.innerHTML = '<p class="muted">加载失败：' + esc((e as any).message) + '</p>'; return; }
  const drafts = data.drafts || [];
  const reports = data.reports || [];
  const log = data.log || [];
  const draftHtml = drafts.length
    ? drafts.map((r: any) => communityCard(r, "mine")).join("")
    : '<p class="muted">暂无待公开的草稿。</p>';
  const reportHtml = reports.length
    ? reports.map((rp: any) => `
      <div class="card tpl-card" style="margin-top:10px;">
        <div class="flex items-center justify-between">
          <span class="pill pill-violet">${esc(rp.title)}</span>
          <span class="text-xs muted">${new Date(rp.createdAt).toLocaleString()}</span>
        </div>
        <div class="mt-1" style="font-size:.85rem;">举报原因：<b>${esc(rp.reason)}</b></div>
        ${rp.detail ? `<div class="muted" style="font-size:.78rem;margin-top:4px;">${esc(rp.detail)}</div>` : ""}
        <div class="flex gap-2 mt-2 flex-wrap items-center">
          <button class="btn btn-danger btn-sm cm-takedown" data-id="${esc(rp.itemId)}" data-rid="${esc(rp.id)}">🚫 下架并处理</button>
          <button class="btn btn-ghost btn-sm cm-dismiss" data-rid="${esc(rp.id)}">忽略</button>
        </div>
      </div>`).join("")
    : '<p class="muted">暂无举报。</p>';
  const logHtml = log.length
    ? log.map((l: any) => {
        const aMap: any = { publish_draft: "提交草稿", publish_public: "公开", publish_blocked: "审核拦截", takedown: "管理员下架" };
        const a = aMap[l.action] || l.action;
        const tag = l.safe
          ? '<span class="pill" style="background:#dcfce7;color:#15803d;">通过</span>'
          : '<span class="pill" style="background:#fee2e2;color:#b91c1c;">拦截/下架</span>';
        const eng = l.engine ? `<span class="muted" style="font-size:.72rem;"> · ${esc(l.engine)}</span>` : "";
        const rs = (l.reasons && l.reasons.length) ? `<div class="muted" style="font-size:.74rem;margin-top:3px;">${l.reasons.map((x: any) => esc(x)).join("；")}</div>` : "";
        return `<div class="card tpl-card" style="margin-top:8px;padding:10px 12px;">
          <div class="flex items-center justify-between">
            <span style="font-size:.85rem;"><b>${esc(a)}</b> · ${esc(l.itemTitle)} ${tag}${eng}</span>
            <span class="text-xs muted">${new Date(l.createdAt).toLocaleString()}</span>
          </div>${rs}
        </div>`;
      }).join("")
    : '<p class="muted">暂无审核记录。</p>';
  wrap.innerHTML = `
    <div class="ttl" style="margin-top:6px;">📝 待公开草稿（${drafts.length}）</div>
    ${draftHtml}
    <div class="ttl mt-4">⚠ 被举报内容（${reports.length}）</div>
    ${reportHtml}
    <div class="ttl mt-4">🧾 审核日志（最近 ${log.length} 条）</div>
    ${logHtml}
  `;
  wrap.querySelectorAll(".cm-publish").forEach(b => b.addEventListener("click", async () => {
    const st = await publishNowWithDupCheck(b.getAttribute("data-id"));
    if (st === "published") reload();
  }));
  wrap.querySelectorAll(".cm-unpublish").forEach(b => b.addEventListener("click", async () => {
    await LLM.communityUnpublish(b.getAttribute("data-id"));
    toast("已退回草稿");
    reload();
  }));
  wrap.querySelectorAll(".cm-del").forEach(b => b.addEventListener("click", async () => {
    const id = b.getAttribute("data-id");
    confirmDialog("删除这条社区提示词？", "删除后无法恢复，草稿和已公开内容都会一并移除。", async () => {
      await LLM.communityDelete(id);
      reload();
    });
  }));
  wrap.querySelectorAll(".cm-takedown").forEach(b => b.addEventListener("click", async () => {
    const id = b.getAttribute("data-id");
    const rid = b.getAttribute("data-rid");
    confirmDialog("下架这条内容？", "将从社区广场移除并标记为已处理（审核日志记录）。", async () => {
      await LLM.communityTakedown(id, "被举报下架");
      if (rid) { try { await LLM.communityReportResolve(rid, "resolved"); } catch (e) {} }
      toast("已下架并处理");
      reload();
    });
  }));
  wrap.querySelectorAll(".cm-dismiss").forEach(b => b.addEventListener("click", async () => {
    const rid = b.getAttribute("data-rid");
    try { await LLM.communityReportResolve(rid, "dismissed"); } catch (e) {}
    toast("已忽略该举报");
    reload();
  }));
}

export function communityCard(r: any, tab: string): string {
  const tagHtml = (r.tags || []).map((t: any) => `<span class="text-xs tag mr-1">#${esc(t)}</span>`).join("");
  const coverHtml = r.cover
    ? `<div class="tpl-cover" style="padding:0;background:${industryPh(r.industry)}"><img class="tpl-cover-img" src="${esc(r.cover)}" alt="" loading="lazy" onerror="this.style.display='none'" /></div>`
    : `<div class="tpl-cover" style="background:${industryPh(r.industry)}"><span class="tpl-cover-emoji">${iconFor(r.industry)}</span><span class="tpl-cover-name">${esc(r.industry)}</span></div>`;
  const relTime = fmtRelative(r.publishedAt || r.createdAt);
  const isOfficial = r.author === "模法师官方";
  const authorHtml = r.authorId ? `<a href="#/u/${esc(r.authorId)}" class="author-link">${esc(r.author)}</a>` : esc(r.author);
  const ratingStr = r.avgRating ? r.avgRating.toFixed(1) + (r.ratingCount ? ` (${r.ratingCount})` : "") : "—";
  const showTags = tab !== "home";
  const actions = tab === "mine"
    ? `<div class="flex gap-2 mt-2 flex-wrap items-center">
         ${r.status === "draft"
           ? '<button class="btn btn-primary btn-sm cm-publish" data-id="' + esc(r.id) + '">🌟 公开</button>'
           : '<button class="btn btn-ghost btn-sm cm-unpublish" data-id="' + esc(r.id) + '">↩ 撤回</button>'}
         <button class="btn btn-ghost btn-sm cm-del" data-id="' + esc(r.id) + '">🗑 删除</button>
         <span class="muted" style="font-size:.72rem;">${r.status === "draft" ? "草稿（仅自己可见）" : "已公开"}</span>
       </div>`
        : (tab === "square"
        ? `<div class="flex gap-2 mt-2 flex-wrap items-center">
             <button class="btn btn-primary btn-sm cm-try" data-id="${esc(r.id)}">🚀 试跑</button>
             <button class="btn btn-ghost btn-sm cm-fork" data-id="${esc(r.id)}">🍴 派生</button>
             <button class="btn btn-ghost btn-sm cm-opt" data-id="${esc(r.id)}">🔧 优化</button>
             <button class="btn btn-ghost btn-sm cm-report" data-id="${esc(r.id)}" data-title="${esc(r.title)}">⚠ 举报</button>
             <button class="btn btn-ghost btn-sm cm-share" data-id="${esc(r.id)}">📤 分享</button>
             <span class="muted" style="font-size:.72rem;">已公开</span>
           </div>`
        : (tab === "home"
          ? `<div class="flex gap-2 mt-2">
               <button class="btn btn-primary btn-sm cm-try" data-id="${esc(r.id)}">🚀 试跑</button>
               <button class="btn btn-ghost btn-sm cm-fork" data-id="${esc(r.id)}">🍴 派生</button>
               <button class="btn btn-ghost btn-sm cm-share" data-id="${esc(r.id)}">📤 分享</button>
             </div>`
          : `<div class="flex gap-2 mt-2 flex-wrap items-center">
             <button class="btn btn-primary btn-sm cm-try" data-id="${esc(r.id)}">🚀 试跑</button>
             <button class="btn btn-ghost btn-sm cm-fork" data-id="${esc(r.id)}">🍴 派生</button>
             <button class="btn btn-ghost btn-sm cm-share" data-id="${esc(r.id)}">📤 分享</button>
             <span class="muted" style="font-size:.72rem;">点开看完整卡片</span>
           </div>`));
  return `<div class="card tpl-card tpl-card--cover cm-card" data-id="${esc(r.id)}" style="cursor:pointer;overflow:hidden;">
    ${coverHtml}
    <div class="tpl-body">
      <div class="flex items-center justify-between" style="gap:8px;">
        <span class="pill ${isOfficial ? 'pill-official' : 'pill-community'}">${isOfficial ? '官方' : '社区'}</span>
        <span class="pill pill-diff diff-${r.difficulty === '专家' ? 3 : r.difficulty === '进阶' ? 2 : 1}">${esc(r.difficulty || '入门')}</span>
        <span class="text-xs muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${authorHtml} · ★ ${ratingStr}${relTime ? ' · ' + esc(relTime) : ''}</span>
      </div>
      <h3>${esc(r.title)}</h3>
      ${showTags ? `<div class="mt-1">${tagHtml}</div>` : ""}
      <div class="cm-stats muted">🔥 ${r.uses} 次使用 · ⭐ ${r.favorites} 收藏${r.note && showTags ? " · " + esc(r.note) : ""}</div>
      ${actions}
    </div>
  </div>`;
}

// ---------- F35-② 分享到外部 AI 平台（纯前端，零服务端） ----------
// 把提示词预填进各平台新对话 URL；过长则降级为「复制原文 + 打开首页」，避免 URL 被截断。
type SharePlatform = { key: string; name: string; icon: string; preset: boolean };
const SHARE_PLATFORMS: SharePlatform[] = [
  { key: "chatgpt", name: "ChatGPT", icon: "🟢", preset: true },
  { key: "claude", name: "Claude", icon: "🟣", preset: true },
  { key: "gemini", name: "Gemini", icon: "🔷", preset: true },
  { key: "perplexity", name: "Perplexity", icon: "🟠", preset: true },
  { key: "doubao", name: "豆包", icon: "🔵", preset: true },
  { key: "kimi", name: "Kimi", icon: "🟡", preset: false },
  { key: "yuanbao", name: "元宝", icon: "🟦", preset: false },
  { key: "copilot", name: "Copilot", icon: "🪟", preset: true },
];
const SHARE_URL_MAX = 1800; // 预填参数编码后安全上限（字节），超出则降级

function buildShareUrl(key: string, encText: string, longText: boolean): string {
  if (longText) {
    const home: Record<string, string> = {
      chatgpt: "https://chatgpt.com/", claude: "https://claude.ai/new", gemini: "https://gemini.google.com/app",
      perplexity: "https://www.perplexity.ai/", doubao: "https://www.doubao.com/chat", kimi: "https://kimi.moonshot.cn/",
      yuanbao: "https://yuanbao.tencent.com/", copilot: "https://copilot.microsoft.com/",
    };
    return home[key] || "https://chatgpt.com/";
  }
  const q = `?q=${encText}`;
  switch (key) {
    case "chatgpt": return `https://chatgpt.com/?prompt=${encText}`;
    case "claude": return `https://claude.ai/new${q}`;
    case "gemini": return `https://gemini.google.com/app${q}`;
    case "perplexity": return `https://www.perplexity.ai/${q}`;
    case "doubao": return `https://www.doubao.com/chat${q}`;
    case "copilot": return `https://copilot.microsoft.com/${q}`;
    case "kimi": return "https://kimi.moonshot.cn/";
    case "yuanbao": return "https://yuanbao.tencent.com/";
    default: return "https://chatgpt.com/";
  }
}

export function openShareMenu(r: any): void {
  const title = r?.title || "提示词";
  const text = r?.prompt || "";
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `
    <div class="modal-card card share-card">
      <div class="ttl">📤 把「${esc(title)}」送到 AI 平台</div>
      <div class="muted" style="font-size:.78rem;margin-top:4px;">点下面的平台，会打开一个已预填提示词的新对话（长提示词自动改为「复制原文 + 打开首页」，粘贴即用）。</div>
      <div class="share-grid">
        ${SHARE_PLATFORMS.map(p => `<button class="share-item" data-key="${p.key}"><span class="share-ico">${p.icon}</span><span>${esc(p.name)}</span>${p.preset ? "" : '<span class="share-tag">首页</span>'}</button>`).join("")}
      </div>
      <div class="flex gap-2 mt-3 items-center">
        <button id="share-copy" class="btn btn-primary btn-sm">📋 复制提示词原文</button>
        <button id="share-cancel" class="btn btn-ghost btn-sm">关闭</button>
      </div>
      <div id="share-msg" class="muted" style="font-size:.75rem;margin-top:6px;"></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => {
    window.removeEventListener("hashchange", onHash);
    ov.remove();
  };
  const onHash = () => close();
  window.addEventListener("hashchange", onHash, { once: true });
  const msg = () => ov.querySelector("#share-msg") as HTMLElement;
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  (ov.querySelector("#share-cancel") as HTMLElement)?.addEventListener("click", close);
  (ov.querySelector("#share-copy") as HTMLElement)?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); msg().textContent = "✓ 已复制到剪贴板"; }
    catch { msg().textContent = "复制失败，请手动选择正文复制"; }
  });
  ov.querySelectorAll(".share-item").forEach(b => b.addEventListener("click", () => {
    const key = b.getAttribute("data-key") || "chatgpt";
    const plat = SHARE_PLATFORMS.find(p => p.key === key);
    const name = plat?.name || key;
    const enc = encodeURIComponent(text);
    const longText = enc.length > SHARE_URL_MAX;
    const url = buildShareUrl(key, enc, longText);
    const preset = !!plat?.preset;
    // 预填场景：平台支持 URL 预填且文本不超长 → 直接打开已填好提示词的新对话
    // 粘贴场景：非预填平台（Kimi/元宝）或文本过长 → 一定复制原文，并用长 toast 明确提示 Ctrl+V
    window.open(url, "_blank", "noopener");
    if (preset && !longText) {
      toast(`✓ 已打开 ${name}，提示词已预填，直接发送即可`, 3500);
    } else {
      const why = !preset ? `${name} 暂不支持自动预填` : `提示词较长（${text.length} 字）`;
      navigator.clipboard?.writeText(text)
        .then(() => toast(`✓ 已复制提示词原文 · ${why} · 去 ${name} 页面按 Ctrl+V 粘贴`, 6000))
        .catch(() => toast(`⚠ 自动复制失败，请先点下方「复制提示词原文」再粘贴到 ${name}`, 6000));
    }
    setTimeout(close, 500);
  }));
}

export async function communityDetail(id: string): Promise<void> {
  ctx.appEl().innerHTML = `<a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a><div class="mt-3 muted">加载中…</div>`;
  let row: any;
  try { row = await LLM.communityDetail(id); }
  catch (e) {
    ctx.appEl().innerHTML = `<a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a><p class="mt-3">加载失败：${esc((e as any).message)}</p>`;
    return;
  }
  const tagHtml = (row.tags || []).map((t: any) => `<span class="text-xs tag mr-1">#${esc(t)}</span>`).join("");
  ctx.appEl().innerHTML = `
    <a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a>
    <div class="mt-3">
      <h1 class="section-title" style="font-size:1.6rem;">${esc(row.title)}</h1>
      <div class="muted" style="font-size:.85rem;margin-top:6px;">${row.author === "模法师官方" ? '<span class="pill pill-official">官方</span> ' : '<span class="pill pill-community">社区</span> '}<span class="pill pill-violet">${esc(row.industry)}</span><span class="pill pill-diff diff-${row.difficulty === '专家' ? 3 : row.difficulty === '进阶' ? 2 : 1}">${esc(row.difficulty || '入门')}</span>${row.version ? ' <span class="pill pill-version">' + esc(row.version) + '</span>' : ''} · 作者 ${row.authorId ? `<a href="#/u/${esc(row.authorId)}" class="author-link">${esc(row.author)}</a>` : esc(row.author)} · ${row.status === "draft" ? "草稿" : "已公开"}${fmtRelative(row.publishedAt || row.createdAt) ? " · " + esc(fmtRelative(row.publishedAt || row.createdAt)) : ""}</div>
      ${row.cover ? `<img class="cm-cover" src="${esc(row.cover)}" alt="" style="margin-top:10px;border-radius:10px;max-height:240px;width:100%;object-fit:cover;" onerror="this.style.display='none'" />` : `<div class="cm-cover-ph" style="background:${industryPh(row.industry)};margin-top:10px;"><span>${esc((row.title || "?").slice(0, 1))}</span></div>`}
    </div>
    <div class="mt-2">${tagHtml}</div>
    ${row.recommendModel ? `<p class="muted" style="margin-top:8px;font-size:.82rem;">🎯 适配：${esc(row.difficulty || '入门')}级 · 推荐 ${esc(row.recommendModel)}</p>` : ""}
    ${row.note ? `<p class="slate" style="margin-top:10px;line-height:1.6;">${esc(row.note)}</p>` : ""}
    <div class="card tpl-card" style="margin-top:16px;">
      <div id="cm-prompt-label" class="live-label" style="margin-bottom:6px;">📋 当前提示词</div>
      <div class="ttl">📄 提示词正文</div>
      <pre id="cm-prompt-body" class="code-box" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;">${esc(row.prompt)}</pre>
    </div>
    <div class="card tpl-card" style="margin-top:16px;">
      <div class="ttl">⭐ 评分</div>
      <div id="cm-rate-stars" class="rate-stars">${[1, 2, 3, 4, 5].map(n => `<span class="star" data-n="${n}">★</span>`).join("")}</div>
      <div id="cm-rate-info" class="muted" style="font-size:.78rem;margin-top:6px;">加载评分中…</div>
    </div>
    <div class="flex gap-2 mt-3 flex-wrap items-center">
      <button id="cm-clone" class="btn btn-primary btn-sm">🍴 派生 / Remix</button>
      <button id="cm-fav" class="btn btn-ghost btn-sm">⭐ 收藏</button>
      <button id="cm-test-open" class="btn btn-ghost btn-sm">🧪 测试这个提示词</button>
      <button id="cm-prev" class="btn btn-ghost btn-sm">🚀 一键试跑</button>
      <button id="cm-addcol" class="btn btn-ghost btn-sm">📚 加入合集</button>
      <button id="cm-share" class="btn btn-ghost btn-sm">📤 分享</button>
      ${row.status === "published" ? '<button id="cm-report" class="btn btn-ghost btn-sm">⚠ 举报</button>' : ""}
    </div>
    <div id="cm-test-wrap" class="card tpl-card" style="margin-top:16px;display:none;">
      <div class="flex items-center justify-between">
        <div class="ttl">🧪 测试这个提示词（把它当作系统设定，自由提问，多轮对话）</div>
        <div class="flex gap-2 items-center">
          <button id="cm-refine-open" class="btn btn-ghost btn-sm">✏️ 不满意？让 AI 改进</button>
          <button id="cm-test-clear" class="btn btn-ghost btn-sm">清空对话</button>
        </div>
      </div>
      <div id="cm-test-log" class="test-log"></div>
      <div class="test-input-row">
        <textarea id="cm-test-input" class="input" rows="2" placeholder="在这里输入你的问题，回车发送（Shift+Enter 换行）…"></textarea>
        <div class="flex gap-2 items-center">
          <button id="cm-test-send" class="btn btn-primary btn-sm">发送</button>
        </div>
      </div>
      <div id="cm-test-usage" class="muted" style="font-size:.75rem;margin-top:6px;"></div>

      <div id="cm-refine-box" class="refine-box" style="display:none;">
        <div class="ttl">✏️ 对这条提示词不满意？描述问题，AI 帮你改写</div>
        <textarea id="cm-refine-feedback" class="input" rows="3" style="margin-top:8px;" placeholder="例如：回答太啰嗦、没有按我要求的表格格式输出、语气太生硬、没先问清我的需求就给方案、容易跑题……"></textarea>
        <div class="flex gap-2 mt-3 flex-wrap items-center">
          <button id="cm-refine-go" class="btn btn-primary btn-sm">🔧 分析并改写</button>
          <button id="cm-refine-cancel" class="btn btn-ghost btn-sm">取消</button>
        </div>
        <div id="cm-refine-steps" class="gen-steps" style="display:none;margin-top:12px;"></div>
        <pre id="cm-refine-live" class="code-box" style="display:none;margin-top:12px;"></pre>
        <div id="cm-refine-result" class="refine-result" style="display:none;margin-top:12px;"></div>
      </div>
    </div>
    <div id="cm-msg" class="muted" style="font-size:.78rem;margin-top:12px;"></div>
    <div class="card tpl-card" style="margin-top:16px;">
      <div class="ttl">💬 评论 <span id="cm-comment-count" class="muted" style="font-size:.75rem;"></span></div>
      <div id="cm-comments" class="mt-2"></div>
      <div class="flex gap-2 mt-3 items-start">
        <textarea id="cm-comment-input" class="input" rows="2" style="flex:1;" placeholder="发表你的看法…（需登录）"></textarea>
        <button id="cm-comment-send" class="btn btn-primary btn-sm" style="align-self:flex-end;">发送</button>
      </div>
    </div>
  `;

  setMeta(row.title, (row.note || row.prompt || "").slice(0, 120));
  cLoadRate(row);
  // 评论区（C1）
  const loadComments = async (itemId: string) => {
    const box = (document.getElementById("cm-comments") as HTMLElement);
    const cnt = (document.getElementById("cm-comment-count") as HTMLElement);
    if (!box) return;
    try {
      const cs = await LLM.communityComments(itemId);
      cnt.textContent = cs.length ? "（" + cs.length + "）" : "";
      box.innerHTML = cs.length ? cs.map((c: any) => `
        <div class="comment-item" style="padding:8px 0;border-top:1px solid var(--brand-100);">
          <div class="flex items-center justify-between">
            <span style="font-size:.82rem;"><b>${esc(c.author)}</b></span>
            <span class="text-xs muted">${new Date(c.createdAt).toLocaleString()}</span>
          </div>
          <div style="font-size:.85rem;margin-top:3px;white-space:pre-wrap;word-break:break-word;">${esc(c.content)}</div>
        </div>`).join("") : '<p class="muted" style="font-size:.78rem;">还没有评论，来抢沙发～</p>';
    } catch (e) {
      box.innerHTML = '<p class="muted" style="font-size:.78rem;">评论加载失败：' + esc((e as any).message) + '</p>';
    }
  };
  loadComments(row.id);
  const commentSend = (document.getElementById("cm-comment-send") as HTMLButtonElement);
  const commentInput = (document.getElementById("cm-comment-input") as HTMLTextAreaElement);
  if (commentSend && commentInput) {
    const doSend = async () => {
      const text = commentInput.value.trim();
      if (!text) return;
      commentSend.disabled = true;
      try {
        await LLM.communityComment(row.id, text);
        commentInput.value = "";
        toast("✓ 评论已发布");
        await loadComments(row.id);
      } catch (e: any) {
        toast("✗ " + (e.message || "评论失败"));
      } finally {
        commentSend.disabled = false;
      }
    };
    commentSend.addEventListener("click", doSend);
    commentInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });
  }
  document.querySelectorAll("#cm-rate-stars .star").forEach(s => s.addEventListener("click", () => cRate(row, Number(s.getAttribute("data-n")))));
  const cloneBtn = (document.getElementById("cm-clone") as HTMLButtonElement);
  if (cloneBtn) cloneBtn.addEventListener("click", () => remixToMine(row, ctx.cCurrentPrompt));
  const favBtn = (document.getElementById("cm-fav") as HTMLButtonElement);
  const reportBtn = (document.getElementById("cm-report") as HTMLButtonElement);
  if (reportBtn) reportBtn.addEventListener("click", () => reportDialog(row.id, row.title));
  let faved = Store.hasCommunityFav(row.id);
  const renderFav = () => {
    favBtn.textContent = faved ? "✓ 已收藏" : "⭐ 收藏";
    favBtn.classList.toggle("btn-primary", faved);
    favBtn.classList.toggle("btn-ghost", !faved);
  };
  renderFav();
  if (favBtn) favBtn.addEventListener("click", async () => {
    faved = !faved;
    Store.setCommunityFav(row.id, faved);
    await LLM.communityFavorite(row.id, faved ? 1 : -1).catch(() => {});
    renderFav();
  });

  // 社区版测试沙盒状态：复用模块级 cState / cCurrentPrompt，并切到社区版 refine 上下文
  ctx.cState = { msgs: [], ctl: null };
  ctx.cCurrentPrompt = row.prompt;
  const cmPrev = (document.getElementById("cm-prev") as HTMLButtonElement);
  if (cmPrev) cmPrev.addEventListener("click", () => openPreviewModal(row));
  const cmAddCol = (document.getElementById("cm-addcol") as HTMLButtonElement);
  if (cmAddCol) cmAddCol.addEventListener("click", () => openAddToCollectionModal(row.id));
  const shareBtn = (document.getElementById("cm-share") as HTMLButtonElement);
  if (shareBtn) shareBtn.addEventListener("click", () => openShareMenu(row));
  ctx.refineCtx = communityRefineCtx();
  const testOpen = (document.getElementById("cm-test-open") as HTMLButtonElement);
  if (testOpen) testOpen.addEventListener("click", () => {
    const w = (document.getElementById("cm-test-wrap") as HTMLElement);
    if (w) w.style.display = "block";
    const log = (document.getElementById("cm-test-log") as HTMLElement);
    if (log && !log.children.length) log.innerHTML = '<div class="test-empty muted">对话已开始 —— 输入问题，模型会按上面的提示词作答。</div>';
    const inp = (document.getElementById("cm-test-input") as HTMLTextAreaElement);
    if (inp) inp.focus();
    LLM.communityUse(row.id, 1).catch(() => {});
  });
  const sendBtn = (document.getElementById("cm-test-send") as HTMLButtonElement);
  if (sendBtn) sendBtn.addEventListener("click", () => cSend(ctx.cState));
  const clearBtn = (document.getElementById("cm-test-clear") as HTMLButtonElement);
  if (clearBtn) clearBtn.addEventListener("click", () => cClear(ctx.cState));
  const input = (document.getElementById("cm-test-input") as HTMLTextAreaElement);
  if (input) input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); cSend(ctx.cState); } });
  // F5 改写（社区版）：与模板详情页共用同一套 refine 逻辑，靠 refineCtx 区分
  const cRefineOpen = (document.getElementById("cm-refine-open") as HTMLButtonElement);
  if (cRefineOpen) cRefineOpen.addEventListener("click", openRefineBox);
  const cRefineGo = (document.getElementById("cm-refine-go") as HTMLButtonElement);
  if (cRefineGo) cRefineGo.addEventListener("click", handleRefine);
  const cRefineCancel = (document.getElementById("cm-refine-cancel") as HTMLButtonElement);
  if (cRefineCancel) cRefineCancel.addEventListener("click", closeRefineBox);
}

// 加入合集弹窗（C4，报告 #2）：列出我的合集，可把当前模板加入/移出，也可当场新建合集。
// 需登录；未登录时后端返回 401，这里捕获并提示去登录。
export async function openAddToCollectionModal(itemId: string): Promise<void> {
  if (!LLM.authIsAuthed()) { toast("请先登录后再加入合集"); return; }
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.id = "addcol-overlay";
  ov.innerHTML = `
    <div class="modal-card card" style="max-width:560px;width:94%;max-height:90vh;overflow:auto;">
      <div class="flex items-center justify-between">
        <div class="ttl">📚 加入合集</div>
        <button id="addcol-close" class="btn btn-ghost btn-sm">关闭</button>
      </div>
      <p class="muted mt-2" style="font-size:.8rem;">把这条模板收进你的合集；勾选「新建合集」可顺便建一个。仅你能增删自己合集的成员。</p>
      <div id="addcol-list" class="mt-3">加载中…</div>
      <div class="mt-3" style="border-top:1px solid var(--brand-100);padding-top:12px;">
        <label class="text-sm font-medium" style="color:var(--slate)">新建合集（可选）</label>
        <input id="addcol-new" class="input" style="margin-top:4px;" placeholder="合集标题，留空则不新建" maxlength="120" />
        <button id="addcol-new-go" class="btn btn-ghost btn-sm mt-2">＋ 建并加入</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  (document.getElementById("addcol-close") as HTMLButtonElement)?.addEventListener("click", close);

  const listEl = (document.getElementById("addcol-list") as HTMLElement);
  const newInput = (document.getElementById("addcol-new") as HTMLInputElement);
  const newGo = (document.getElementById("addcol-new-go") as HTMLButtonElement);

  async function render(): Promise<void> {
    let mine: any[] = [];
    try { mine = await LLM.myCollections(); } catch (e: any) {
      listEl.innerHTML = '<p class="muted">加载失败：' + esc(e?.message || e) + '</p>';
      return;
    }
    // 逐个合集查成员关系（个人合集数量通常很少，可接受）
    const rows = await Promise.all(mine.map(async (c: any) => {
      let inIt = false;
      try { const d = await LLM.collectionDetail(c.id); inIt = (d.items || []).some((i: any) => i.id === itemId); } catch { /* ignore */ }
      return { ...c, inIt };
    }));
    if (!rows.length) listEl.innerHTML = '<p class="muted">你还没有合集，下面填个标题就能新建。</p>';
    else listEl.innerHTML = rows.map(c => `
      <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--brand-100);">
        <span>${esc(c.title)} <span class="muted" style="font-size:.72rem;">· ${c.itemCount || 0} 个</span></span>
        <button class="btn btn-sm ${c.inIt ? "btn-primary" : "btn-ghost"} addcol-toggle" data-id="${esc(c.id)}" data-init="${c.inIt ? "1" : "0"}">${c.inIt ? "✓ 已加入" : "加入"}</button>
      </div>`).join("");
    listEl.querySelectorAll(".addcol-toggle").forEach(b => b.addEventListener("click", async () => {
      const id = b.getAttribute("data-id");
      const wasIn = b.getAttribute("data-init") === "1";
      try {
        if (wasIn) await LLM.collectionRemoveItem(id, itemId);
        else await LLM.collectionAddItem(id, itemId);
        toast(wasIn ? "已移出合集" : "✓ 已加入合集");
        render();
      } catch (e2: any) { toast("操作失败：" + (e2?.message || e2)); }
    }));
  }

  newGo.addEventListener("click", async () => {
    const title = newInput.value.trim();
    if (!title) { toast("请填写合集标题，或选择一个已有合集"); return; }
    try {
      const c = await LLM.createCollection(title, "");
      await LLM.collectionAddItem(c.id, itemId);
      toast("✓ 已创建并加入合集");
      close();
      location.hash = "#/col/" + encodeURIComponent(c.id);
    } catch (e2: any) { toast("创建失败：" + (e2?.message || e2)); }
  });

  await render();
}

// ---------- 社区详情页测试沙盒 + 评分 ----------
export function appendTestBubbleTo(log: HTMLElement | null, text: string, role: string): void {
  if (!log) return;
  const b = document.createElement("div");
  b.className = "test-bubble " + role;
  const t = document.createElement("div");
  t.className = "test-bubble-text";
  t.textContent = text;
  b.appendChild(t);
  log.appendChild(b);
  log.scrollTop = log.scrollHeight;
}

export function cSend(state: { msgs: any[]; ctl: AbortController | null }): void {
  const input = (document.getElementById("cm-test-input") as HTMLTextAreaElement);
  const log = (document.getElementById("cm-test-log") as HTMLElement);
  const m = (document.getElementById("cm-msg") as HTMLElement);
  const sendBtn = (document.getElementById("cm-test-send") as HTMLButtonElement);
  const usageEl = (document.getElementById("cm-test-usage") as HTMLElement);
  if (!input || !log) return;
  const text = input.value.trim();
  if (!text) return;
  if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = ".55"; }
  state.msgs.push({ role: "user", content: text });
  input.value = "";
  appendTestBubbleTo(log, text, "user");
  const emptyEl = log.querySelector(".test-empty");
  if (emptyEl) emptyEl.remove();
  const aBubble = document.createElement("div");
  aBubble.className = "test-bubble assistant";
  const aText = document.createElement("div");
  aText.className = "test-bubble-text";
  aBubble.appendChild(aText);
  log.appendChild(aBubble);
  log.scrollTop = log.scrollHeight;
  state.ctl = new AbortController();
  let full = "";
  if (m) m.textContent = "模型回复中…";
  const onToken = (chunk: string) => { if (chunk) { full += chunk; aText.textContent = full; log.scrollTop = log.scrollHeight; } };
  (async () => {
    try {
      const res = await LLM.chatWithPrompt(ctx.cCurrentPrompt, state.msgs, onToken, state.ctl!.signal);
      full = res.text || full;
      aText.textContent = full;
      state.msgs.push({ role: "assistant", content: full });
      if (res.usage && usageEl) usageEl.textContent = "📊 " + fmtUsage(res.usage, res.elapsedMs);
      if (m) m.textContent = "✓ 已回复（可继续追问）。";
    } catch (e) {
      aText.textContent = (full ? full + "\n\n" : "") + "✗ 测试失败：" + (e as any).message;
      if (m) m.textContent = "测试失败：" + (e as any).message;
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = "1"; }
      state.ctl = null;
      if (input) input.focus();
    }
  })();
}

export function cClear(state: { msgs: any[]; ctl: AbortController | null }): void {
  state.msgs = [];
  const log = (document.getElementById("cm-test-log") as HTMLElement);
  if (log) log.innerHTML = '<div class="test-empty muted">对话已清空 —— 重新输入问题开始测试。</div>';
  const usageEl = (document.getElementById("cm-test-usage") as HTMLElement);
  if (usageEl) usageEl.textContent = "";
}

export function highlightStarsC(id: string): void {
  const stars = (document.getElementById("cm-rate-stars") as HTMLElement);
  if (!stars) return;
  const my = Store.getRating(id) || 0;
  stars.querySelectorAll(".star").forEach(s => s.classList.toggle("on", Number(s.getAttribute("data-n")) <= my));
}

export function cLoadRate(row: any): void {
  const info = (document.getElementById("cm-rate-info") as HTMLElement);
  if (!info) return;
  highlightStarsC(row.id);
  const my = Store.getRating(row.id);
  info.textContent = `当前均分 ${row.avgRating}/10 分 · ${row.ratingCount || 0} 人评分` + (my ? ` · 你给了 ${my} 星` : "");
}

export function cRate(row: any, score: number): void {
  const prev = Store.getRating(row.id);
  LLM.communityRate(row.id, score, prev).then(r => {
    Store.setRating(row.id, score);
    const info = (document.getElementById("cm-rate-info") as HTMLElement);
    if (info) info.textContent = `当前均分 ${r.avgRating}/10 分 · ${r.ratingCount || 0} 人评分 · 你给了 ${score} 星`;
    highlightStarsC(row.id);
    const m = (document.getElementById("cm-msg") as HTMLElement);
    if (m) { m.textContent = "已评分 " + score + " 星 ✓"; setTimeout(() => { if (m) m.textContent = ""; }, 2000); }
  }).catch(e => { const m = (document.getElementById("cm-msg") as HTMLElement); if (m) m.textContent = "评分失败：" + (e as any).message; });
}
