// views/home.ts — 首页 / 行业页 / 模板卡片（Component 模式）。
import { TEMPLATES } from "../templates.js";
import { LLM } from "../llm.js";
import { ctx } from "../core/ctx.js";
import { esc, setMeta } from "../core/ui.js";
import { ICON } from "../core/config.js";
import { handleGenerate } from "./generate.js";

function industries(): string[] {
  const out: string[] = [];
  TEMPLATES.forEach(t => { if (out.indexOf(t.industry) === -1) out.push(t.industry); });
  return out;
}
function countFor(ind: string) { return TEMPLATES.filter(t => t.industry === ind).length; }
export function iconFor(i: string) { return ICON[i] || "📁"; }

// 模板卡片（首页 / 行业页复用）
export function card(t: any): string {
  const badge = t.imported
    ? '<span class="pill pill-green">导入</span>'
    : (t.generated ? '<span class="pill pill-amber">AI 生成</span>' : "");
  return `<a href="#/t/${encodeURIComponent(t.slug)}" class="card tpl-card">
    <div class="flex items-center justify-between">
      <span class="pill pill-violet">${esc(t.industry)}</span>
      <span class="text-xs muted">${esc(t.task)} ${badge}</span>
    </div>
    <h3>${esc(t.title)}</h3>
    <p>${esc(t.summary)}</p>
  </a>`;
}

// 首页
export function home(): void {
  setMeta("模法师 Promptly · AI 提示词模板架构师", "说一句话，AI 帮你生成可复用的高质量提示词模板。采用 F1→F2 两阶段范式，把模板与实例分离。");
  const inds = industries();
  const totalCount = TEMPLATES.length;
  ctx.appEl().innerHTML = `
    <!-- Hero -->
    <section class="hero">
      <span class="hero-eyebrow">✦ AI 提示词模板架构师</span>
      <h1 class="hero-title brand-title">说一句话，<span class="text-gradient">生成可复用的</span>高质量提示词模板</h1>
      <p class="hero-sub">描述你的需求，内置 Agent 会用「状态机 + 模板库检索 + 自审校验」帮你产出可填空、填完即专业的提示词骨架。</p>
      <div class="gen-row">
        <select id="gen-industry" class="select">${inds.map(i => `<option>${esc(i)}</option>`).join("")}</select>
        <input id="gen-input" class="input" placeholder="例如：帮我写一个让 AI 扮演营养师、给我做每周饮食计划的模板">
        <button id="gen-btn" class="btn btn-primary">⚡ 生成模板</button>
        <button id="gen-stop" class="btn btn-danger" style="display:none">■ 停止</button>
      </div>
      <div id="gen-msg" class="muted" style="font-size:.8rem;margin-top:10px;"></div>
      <div id="gen-steps" class="gen-steps" style="display:none;margin-top:12px;"></div>
      <div id="gen-rag" class="gen-rag" style="display:none;"></div>
      <pre id="gen-live" class="code-box" style="display:none;margin-top:12px;"></pre>
      <a id="gen-open" href="#" class="btn btn-primary" style="display:none;margin-top:14px;">✨ 打开模板，生成你的提示词 →</a>
      <p class="muted" style="font-size:.8rem;margin-top:10px;">当前调用模型：<span style="font-weight:600;color:var(--slate)">${esc(LLM.effectiveLabel())}</span></p>
    </section>

    <!-- 统计条 -->
    <div class="stat-row">
      <div><div class="stat-num">${totalCount} <span class="u">个</span></div><div class="stat-label">精选提示词模板</div></div>
      <div><div class="stat-num">${inds.length} <span class="u">类</span></div><div class="stat-label">覆盖行业场景</div></div>
      <div><div class="stat-num">18 <span class="u">家</span></div><div class="stat-label">可选模型服务商</div></div>
    </div>

    <!-- 为什么不一样 -->
    <section class="section">
      <h2 class="section-title">为什么不一样</h2>
      <p class="section-sub">不是简单套个提示词，而是一套「会检索、会自检、会迭代」的模板生产流水线。</p>
      <div class="feat-grid">
        <div class="feat">
          <div class="feat-ico">🤖</div>
          <h4>Agent 状态机</h4>
          <p>澄清意图 → 检索范例 → 起草 → 自审 → 精炼，五步流水线全程可视化，看得见每一步在干什么。</p>
        </div>
        <div class="feat">
          <div class="feat-ico">🔎</div>
          <h4>模板库检索 (RAG)</h4>
          <p>生成前先从 100+ 精选模板中向量检索相似范例，让产出「有据可依」，而非凭空编造结构。</p>
        </div>
        <div class="feat">
          <div class="feat-ico">✅</div>
          <h4>规则自审校验</h4>
          <p>自动检查「角色/背景/任务/格式」四段齐、变量定义与占位一致，不过关就打回重写。</p>
        </div>
        <div class="feat">
          <div class="feat-ico">✍️</div>
          <h4>模型代写具体内容</h4>
          <p>模板是「提示词生成器」：你只给一句目标，模型在思考中把角色、情境、问题、示例动态写好，产出可直接用的提示词。</p>
        </div>
      </div>
    </section>

    <!-- 示例模板文件 -->
    <section class="section">
      <h2 class="section-title">示例模板文件</h2>
      <p class="section-sub">下载查看模板格式，或导入到「我的模板」继续编辑。</p>
      <div class="flex flex-wrap gap-2" style="margin-top:14px;">
        <a href="/samples/legal-advisor.json" download="legal-advisor.json" class="btn btn-ghost btn-sm">⚖️ 法律顾问.json</a>
        <a href="/samples/code-review.json" download="code-review.json" class="btn btn-ghost btn-sm">💻 代码审查.json</a>
        <a href="/samples/family-doctor.json" download="family-doctor.json" class="btn btn-ghost btn-sm">🩺 家庭医生.json</a>
        <a href="/samples/product-copy.json" download="product-copy.json" class="btn btn-ghost btn-sm">🛒 商品文案.json</a>
      </div>
    </section>

    <!-- 怎么用 -->
    <section class="section">
      <h2 class="section-title">怎么用</h2>
      <div class="steps">
        <div class="step-item"><div class="step-no">1</div><div><h4>一句话描述需求</h4><p>在上方输入你的场景与目标，选好行业倾向。</p></div></div>
        <div class="step-item"><div class="step-no">2</div><div><h4>AI 生成可复用模板</h4><p>Agent 检索范例、起草并自审，产出结构化的提示词模板。</p></div></div>
        <div class="step-item"><div class="step-no">3</div><div><h4>说目标，模型追问确认后写并运行</h4><p>进任一模板，先说目标；若说得不够清，模型会追问几个关键点让你点选确认，再据此写出可直接用的提示词。还能一键把提示词发给模型演示真实回答，复制 / 下载 / 收藏随时用。</p></div></div>
      </div>
    </section>

    <!-- 热门模板 Top5 -->
    <div id="hot-strip" class="mt-5"></div>

    <!-- 搜索 -->
    <div style="margin-top:36px;">
      <input id="search" class="input" placeholder="🔍 搜索模板（标题 / 标签 / 行业）">
    </div>

    <!-- 行业宫格 -->
    <h2 class="section-title" style="margin-top:32px;">按行业浏览</h2>
    <div class="ind-grid" style="margin-top:14px;">
      ${inds.map(i => `<a href="#/i/${encodeURIComponent(i)}" class="ind-cell">
        <span class="ind-emoji">${iconFor(i)}</span>
        <span class="ind-name">${esc(i)}</span>
        <span class="ind-count">${countFor(i)} 个</span>
      </a>`).join("")}
    </div>

    <h2 class="section-title" style="margin-top:32px;">全部模板</h2>
    <div id="list" class="grid sm:grid-cols-2 gap-3" style="margin-top:14px;"></div>
  `;
  renderList("");
  loadHotStrip();
  (document.getElementById("search") as HTMLInputElement).addEventListener("input", e => renderList((e.target as HTMLInputElement).value));
  (document.getElementById("gen-btn") as HTMLButtonElement).addEventListener("click", handleGenerate);
  (document.getElementById("gen-input") as HTMLInputElement).addEventListener("keydown", e => { if (e.key === "Enter") handleGenerate(); });
  (document.getElementById("gen-stop") as HTMLButtonElement).addEventListener("click", () => { if (ctx.genController) ctx.genController.abort(); });
}

export function renderList(q: string): void {
  q = (q || "").trim().toLowerCase();
  const list = TEMPLATES.filter(t => {
    if (!q) return true;
    return (t.title + t.summary + t.industry + (t.tags || []).join(" ")).toLowerCase().includes(q);
  });
  const el = (document.getElementById("list") as HTMLElement);
  if (!el) return;
  el.innerHTML = list.length
    ? list.map(card).join("")
    : '<p class="text-slate-400 text-sm">没有匹配的模板。</p>';
}

// 首页“热门模板 Top5”
export async function loadHotStrip(): Promise<void> {
  const el = (document.getElementById("hot-strip") as HTMLElement);
  if (!el) return;
  try {
    const rows = await (await fetch("/metrics/board?sort=heat&limit=5")).json();
    if (!rows || !rows.length) return;
    el.innerHTML = `<h2 class="section-title" style="margin-top:8px;">🔥 热门模板</h2>
      <div class="grid sm:grid-cols-2 gap-3 mt-3">${rows.map(r => `<a href="#/t/${encodeURIComponent(r.id)}" class="card tpl-card hot">
        <div class="flex items-center justify-between"><span class="pill pill-violet">${esc(r.industry)}</span><span class="text-xs muted">🔥 ${Math.round(r.heat)} · ★ ${r.avgRating ? r.avgRating.toFixed(1) : "—"}</span></div>
        <h3>${esc(r.title)}</h3>
      </a>`).join("")}</div>`;
  } catch { /* 热度榜不可用时首页不报错 */ }
}

// 行业页
export function industry(name: string): void {
  const list = TEMPLATES.filter(t => t.industry === name);
  ctx.appEl().innerHTML = `
    <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
    <h1 class="section-title" style="font-size:1.7rem;margin-top:10px;">${iconFor(name)} ${esc(name)}</h1>
    <p class="muted" style="margin-top:6px;">共 ${list.length} 个模板</p>
    <div class="grid sm:grid-cols-2 gap-3 mt-4">${list.map(card).join("")}</div>
  `;
}
