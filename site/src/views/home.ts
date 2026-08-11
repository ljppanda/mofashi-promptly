// views/home.ts — 首页 / 行业页 / 模板卡片（Component 模式）。
import { TEMPLATES } from "../templates.js";
import { LLM } from "../llm.js";
import { ctx } from "../core/ctx.js";
import { esc, setMeta } from "../core/ui.js";
import { ICON } from "../core/config.js";
import { handleGenerate } from "./generate.js";
import { communityCard } from "./community.js";
import { openPreviewModal } from "./preview.js";

function industries(): string[] {
  const out: string[] = [];
  TEMPLATES.forEach(t => { if (out.indexOf(t.industry) === -1) out.push(t.industry); });
  return out;
}
function countFor(ind: string) { return TEMPLATES.filter(t => t.industry === ind).length; }
export function iconFor(i: string) { return ICON[i] || "📁"; }

// 职业/行业垂类落地页引导文案（提案3）：SEO + 适用场景，便于搜索流量承接。
export const INDUSTRY_INTRO: Record<string, { blurb: string; scenes: string[] }> = {
  "法律": { blurb: "合同审查、法律咨询、文书起草——把专业法务能力沉淀成可复用的提示词模板，让 AI 按你的约束给出有据可依的建议。", scenes: ["合同风险审查", "法律咨询问答", "起诉状 / 答辩状起草", "条款解读"] },
  "医疗健康": { blurb: "健康科普、问诊话术、随访计划——在合规边界内生成专业又易懂的健康内容，帮助患者真正看懂、用得上。", scenes: ["健康科普文案", "用药指导话术", "饮食 / 运动计划", "医患沟通"] },
  "职场办公": { blurb: "汇报、邮件、会议纪要、周报——把重复办公写作交给模板，你只管拍板决策，不必再为措辞纠结。", scenes: ["周报 / 月报", "邮件起草", "会议纪要", "PPT 大纲"] },
  "教育培训": { blurb: "教案、习题、讲义、学习规划——为不同学段与学科快速生成教学材料，老师把精力放在因材施教上。", scenes: ["教案设计", "随堂习题", "知识点讲义", "学习路径规划"] },
  "电商运营": { blurb: "商品文案、直播话术、详情页、投放创意——批量产出能转化、有卖点的表达，告别对着空白页发呆。", scenes: ["商品标题 / 详情", "直播带货话术", "种草笔记", "促销海报文案"] },
  "金融": { blurb: "研报摘要、投教内容、理财话术、风控提示——专业且审慎的金融表达，AI 帮你把复杂信息讲清楚。", scenes: ["研报摘要", "投教科普", "理财话术", "风险提示"] },
  "写作创作": { blurb: "小说、文案、诗歌、脚本——给创作配一套可调控风格与结构的提示词，灵感不再卡在开头。", scenes: ["小说 / 短篇", "短视频脚本", "品牌文案", "诗歌 / 随笔"] },
  "编程开发": { blurb: "代码生成、审查、重构、文档——把工程经验固化成可复用提示词，让 AI 按团队规范写代码。", scenes: ["代码生成", "Code Review", "重构建议", "技术文档"] },
  "其他": { blurb: "没有合适的分类？自定义一个模板，把任意场景的Know-How 固化成可复用的提示词。", scenes: ["通用写作", "自定义流程", "知识整理", "创意脑暴"] },
};

// 拉取公开聚合指标（/metrics/summary），用于首页信任条 / 社区分布 / 新鲜度。失败则静默降级。
export async function loadSummary(): Promise<any> {
  try {
    const r = await fetch("/metrics/summary");
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// 把「按行业分布」渲染成横向计数条
export function renderIndustryDist(el: HTMLElement | null, counts: { industry: string; count: number }[] | undefined): void {
  if (!el) return;
  if (!counts || !counts.length) { el.innerHTML = ""; return; }
  const max = Math.max(...counts.map(c => c.count));
  el.innerHTML = `<div class="ttl" style="margin-bottom:10px;">📊 社区模板按行业分布</div>` + counts.map(c => {
    const pct = max ? Math.round((c.count / max) * 100) : 0;
    return `<a href="#/i/${encodeURIComponent(c.industry)}" style="display:flex;align-items:center;gap:10px;text-decoration:none;margin:7px 0;">
      <span style="width:84px;font-size:.82rem;color:var(--slate);flex:none;">${iconFor(c.industry)} ${esc(c.industry)}</span>
      <span style="flex:1;height:10px;background:var(--brand-50,#eef2ff);border-radius:6px;overflow:hidden;">
        <span style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:6px;"></span>
      </span>
      <span style="width:34px;text-align:right;font-size:.8rem;color:var(--muted,#64748b);flex:none;">${c.count}</span>
    </a>`;
  }).join("");
}

// 角色化用户证言（提案5）：不编造实名 / 机构背书，仅以角色呈现典型用法
const TESTIMONIALS: { emoji: string; role: string; tag: string; quote: string }[] = [
  { emoji: "💻", role: "独立开发者", tag: "把需求写成可复用提示词", quote: "以前每次写需求文档都要从头想结构，现在一句话生成模板，再填目标就能产出可直接用的提示词，省下一大半沟通成本。" },
  { emoji: "🛒", role: "电商运营", tag: "批量产出卖点文案", quote: "商品详情、直播话术、种草笔记都用同一套模板批量生成，风格统一还能按活动快速改，上架速度快了很多。" },
  { emoji: "⚖️", role: "法律从业者", tag: "合同审查提效", quote: "把常见的审查要点固化成模板，AI 按我的约束逐条比对，初筛效率明显提升，我只复核关键风险。" },
];

// 数字千分位格式化
function fmtNum(n: number): string {
  return (n || 0).toLocaleString("zh-CN");
}

// 行业落地页 → 首页「生成自定义模板」时预选行业
let pendingIndustry = "";
export function setPendingIndustry(i: string): void { pendingIndustry = i; }

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

    <!-- 信任条（动态数来自 /metrics/summary，失败降级为静态） -->
    <div class="stat-row">
      <div><div class="stat-num">${totalCount} <span class="u">个</span></div><div class="stat-label">精选提示词模板</div></div>
      <div><div class="stat-num">${inds.length} <span class="u">类</span></div><div class="stat-label">覆盖行业场景</div></div>
      <div><div class="stat-num"><span id="trust-uses">—</span> <span class="u">次</span></div><div class="stat-label">提示词被使用</div></div>
      <div><div class="stat-num"><span id="trust-community">—</span> <span class="u">条</span></div><div class="stat-label">社区已发布</div></div>
    </div>
    <div id="trust-line" class="muted" style="font-size:.82rem;margin-top:10px;"></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:12px;font-size:.82rem;color:#475569;">
      <span>🔒 <b>API Key 仅存你本机浏览器</b>，平台不托管额度、不拿你的数据训练</span>
      <span>🧩 <b>19 家主流模型直连</b>，自带 Key 即用</span>
      <a href="#/models" style="color:#6d28d9;font-weight:600;">查看支持的模型 →</a>
    </div>

    <!-- 3 步上手（报告 r10 #3：降低首访门槛） -->
    <section class="section" style="padding-top:8px;">
      <h2 class="section-title" style="font-size:1.3rem;margin-top:18px;">3 步上手</h2>
      <p class="section-sub">从「一段话」到「可复用的模板」，只要三步。</p>
      <div class="feat-grid">
        <div class="feat" style="cursor:default;">
          <div class="feat-ico">🧩</div>
          <h4>① 选 / 写模板</h4>
          <p>一句话生成（F1），或从首页模板库、社区挑一条带 <code>{{变量}}</code> 的骨架。</p>
        </div>
        <div class="feat" style="cursor:default;">
          <div class="feat-ico">✍️</div>
          <h4>② 填变量生成</h4>
          <p>填完占位符，F2 自动实例化成可直接发给模型的成品提示词（含七段生产级结构）。</p>
        </div>
        <div class="feat" style="cursor:default;">
          <div class="feat-ico">🚀</div>
          <h4>③ 试跑 / 优化 / 发布</h4>
          <p>本地试跑验证、AI 一键优化、派生改造，满意了发布到社区共享。</p>
        </div>
      </div>
      <div style="margin-top:14px;">
        <a href="#/guide" class="btn btn-ghost btn-sm">📖 不懂「变量化 / 生产级结构」？看 5 分钟入门 →</a>
      </div>
    </section>

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

    <!-- 用户证言（提案5 · 角色化社会证明，不编造实名/机构背书） -->
    <section class="section">
      <h2 class="section-title">他们这样用模法师</h2>
      <p class="section-sub">从创作者到职场人，把重复性脑力活固化成可复用模板。</p>
      <div class="grid sm:grid-cols-3 gap-3 mt-3">
        ${TESTIMONIALS.map(t => `<div class="card tpl-card">
          <p style="font-size:.9rem;line-height:1.65;color:var(--slate);">"${esc(t.quote)}"</p>
          <div class="flex items-center gap-2 mt-3">
            <span style="font-size:1.4rem;">${t.emoji}</span>
            <div><div style="font-weight:600;font-size:.85rem;">${esc(t.role)}</div><div class="text-xs muted">${esc(t.tag)}</div></div>
          </div>
        </div>`).join("")}
      </div>
    </section>

    <!-- 社区按行业分布（提案3） -->
    <section class="section">
      <div id="ind-dist" class="card" style="padding:16px 18px;"></div>
    </section>

    <!-- 热门模板 Top5（内置精选） -->
    <div id="hot-strip" class="mt-5"></div>

    <!-- 大家都在用（社区热门模板，带封面社会证明） -->
    <div id="hot-community" class="mt-5"></div>

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
  loadCommunityStrip();
  // 从行业落地页点「生成自定义模板」回来时，预选行业并聚焦输入框
  if (pendingIndustry) {
    const sel = (document.getElementById("gen-industry") as HTMLSelectElement | null);
    if (sel && [...sel.options].some(o => o.value === pendingIndustry)) sel.value = pendingIndustry;
    const gi = (document.getElementById("gen-input") as HTMLInputElement | null);
    if (gi) setTimeout(() => gi.focus(), 60);
    pendingIndustry = "";
  }
  // 信任条 / 社区分布 / 新鲜度（提案5+3+2）来自 /metrics/summary
  loadSummary().then(s => {
    if (!s) return;
    const u = document.getElementById("trust-uses"); if (u) u.textContent = fmtNum(s.totalUses);
    const c = document.getElementById("trust-community"); if (c) c.textContent = fmtNum(s.communityPublished);
    const line = document.getElementById("trust-line");
    if (line) line.innerHTML = `🌟 <b>${fmtNum(s.creators)}</b> 位创作者已发布 · ✨ 今日社区新增 <b>${s.todayPublished}</b> 条 · ⭐ 收藏 <b>${fmtNum(s.totalFavorites)}</b> 次`;
    renderIndustryDist(document.getElementById("ind-dist"), s.industryCounts);
  });
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
      <div class="grid sm:grid-cols-2 gap-3 mt-3">${rows.map(r => {
        const tpl = TEMPLATES.find(t => t.slug === r.id);
        const tryBtn = tpl ? `<button class="btn btn-primary btn-sm hot-try" data-id="${esc(r.id)}" style="margin-top:8px;">🚀 试跑</button>` : "";
        return `<a href="#/t/${encodeURIComponent(r.id)}" class="card tpl-card hot" data-id="${esc(r.id)}">
          <div class="flex items-center justify-between"><span class="pill pill-violet">${esc(r.industry)}</span><span class="text-xs muted">🔥 ${Math.round(r.heat)} · ★ ${r.avgRating ? r.avgRating.toFixed(1) : "—"}</span></div>
          <h3>${esc(r.title)}</h3>
          ${tryBtn}
        </a>`;
      }).join("")}</div>`;
    el.querySelectorAll(".hot-try").forEach(b => b.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = b.getAttribute("data-id");
      const tpl = TEMPLATES.find(t => t.slug === id);
      if (tpl) openPreviewModal(tpl);
      else location.hash = "#/t/" + encodeURIComponent(id || "");
    }));
  } catch { /* 热度榜不可用时首页不报错 */ }
}

// 首页“大家都在用”（社区热门模板，带封面社会证明，与上方内置「热门模板」互补）
export async function loadCommunityStrip(): Promise<void> {
  const el = (document.getElementById("hot-community") as HTMLElement);
  if (!el) return;
  try {
    const rows: any[] = await LLM.communityList({ status: "published", sort: "heat", limit: 6 });
    if (!rows || !rows.length) return;
    el.innerHTML = `<h2 class="section-title" style="margin-top:8px;">🌟 大家都在用</h2>
      <p class="muted" style="font-size:.82rem;margin-top:4px;">社区里最受欢迎的模板，点开即可试跑或派生。</p>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">${rows.map((r: any) => communityCard(r, "rec")).join("")}</div>`;
    // 卡片点击跳详情（communityCard 在非 mine/square 下只展示，不挂操作按钮）
    el.querySelectorAll(".cm-card").forEach(c => c.addEventListener("click", () => {
      const id = c.getAttribute("data-id");
      if (id) location.hash = "#/c/" + encodeURIComponent(id);
    }));
    // 首页社区卡片「🚀 试跑」常驻入口（rec 分支已渲染 cm-try，对标 Gemini open-in-playground）
    el.querySelectorAll(".cm-try").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = b.getAttribute("data-id");
      const r = (rows || []).find(x => x.id === id);
      if (r) openPreviewModal(r);
    }));
  } catch { /* 社区列表不可用时首页不报错 */ }
}
export function industry(name: string): void {
  const list = TEMPLATES.filter(t => t.industry === name);
  const intro = INDUSTRY_INTRO[name] || INDUSTRY_INTRO["其他"];
  setMeta(`${name}提示词模板 · 模法师 Promptly`, `${intro.blurb} 浏览${name}行业的 AI 提示词模板，一键生成、克隆到你的模板库。`);
  ctx.appEl().innerHTML = `
    <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
    <div class="flex items-center gap-3" style="margin-top:10px;">
      <span style="font-size:2rem;">${iconFor(name)}</span>
      <div>
        <h1 class="section-title" style="font-size:1.7rem;margin:0;">${esc(name)} 提示词模板</h1>
        <p class="muted" style="font-size:.82rem;margin-top:2px;">共 ${list.length} 个精选模板 · <a href="#/community" style="color:var(--brand);">看社区同行业内容 →</a></p>
      </div>
    </div>
    <p class="slate" style="margin-top:14px;line-height:1.7;font-size:.92rem;">${esc(intro.blurb)}</p>
    <div class="flex flex-wrap gap-2" style="margin-top:12px;">
      ${intro.scenes.map(s => `<span class="tag" style="background:#fff;border:1px solid var(--brand-100,#e0e7ff);">${esc(s)}</span>`).join("")}
    </div>
    <div class="flex gap-2 mt-3 flex-wrap items-center">
      <button id="ind-gen" class="btn btn-primary btn-sm">⚡ 用 AI 生成自定义${esc(name)}模板</button>
      <a href="#/community" class="btn btn-ghost btn-sm">🏠 社区广场</a>
    </div>
    <h2 class="section-title" style="margin-top:28px;font-size:1.15rem;">${esc(name)} · 精选模板</h2>
    <div class="grid sm:grid-cols-2 gap-3 mt-3">${list.map(card).join("")}</div>
  `;
  const gb = (document.getElementById("ind-gen") as HTMLButtonElement | null);
  if (gb) gb.addEventListener("click", () => { setPendingIndustry(name); location.hash = "#/"; });
}
