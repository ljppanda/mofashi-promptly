// 应用主逻辑：哈希路由 + 各页面渲染
import { TEMPLATES } from "./templates.js";
import { Store } from "./store.js";
import { LLM } from "./llm.js";
(function () {
  "use strict";
  const app = () => (document.getElementById("app") as HTMLElement);

  // 当前详情页模板（模块级，供生成提示词/下载复用）
  let current = null;
  // 流式生成的中断控制器
  let genController = null;
  // 用模板生成提示词（模型代写）的中断控制器
  let useController = null;
  // 交互式访谈（F3）状态：已确认的问答、当前轮次
  let useQa = [];
  let useRound = 0;
  const MAX_CLARIFY_ROUNDS = 3;
  // 把生成的提示词直接发给模型运行看结果的流式中断控制器
  let runController = null;
  let testMessages = [];   // 测试沙盒的多轮对话历史 {role, content}
  let testController = null; // 测试沙盒的停止控制器
  let refineController = null; // 动态改写（F5）的停止控制器
  // 改写功能（F5）的「页面上下文」：模板详情页与社区详情页共用同一套 refine 逻辑，靠 ctx 区分元素与状态
  let refineCtx = null;
  // 社区详情页测试沙盒状态（与模板详情页的 testMessages/testController 对应，独立一份避免互相污染）
  let cState = { msgs: [], ctl: null };
  let cCurrentPrompt = ""; // 社区测试中「当前正在测的提示词」，初始为 row.prompt，采用改进版后会被替换
  // 路由栈：前进压栈、返回弹栈，让“返回”回到真正的前一页（而非主页）
  let routeStack = [];
  let currentHash = null;
  // 热度榜当前排序维度
  let currentSort = "heat";
  // 模板稳定 id：优先 slug（内置/导入/生成），其次 id
  function tplId(t) { return t && (t.slug || t.id) ? (t.slug || t.id) : null; }
  // 热度指标上报（fire-and-forget，失败静默）
  function metricBump(id, type, delta, title, industry) {
    if (!id) return;
    fetch("/metrics/bump", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, type, delta, title, industry }) }).catch(() => {});
  }
  function metricRate(id, score, prev, title, industry) {
    if (!id) return;
    fetch("/metrics/rate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, score, prev: prev || 0, title, industry }) }).catch(() => {});
  }
  function goBack() {
    if (routeStack.length >= 2) location.hash = routeStack[routeStack.length - 2];
    else location.hash = "#/";
  }
  window.goBack = goBack;

  // token 用量格式化展示
  function fmtUsage(u, ms) {
    if (!u) return "";
    const p = [];
    p.push("输入 " + (u.inputTokens || 0));
    p.push("输出 " + (u.outputTokens || 0));
    if (u.cacheReadTokens) p.push("缓存命中 " + u.cacheReadTokens);
    if (u.cacheCreateTokens) p.push("缓存写入 " + u.cacheCreateTokens);
    if (u.totalTokens) p.push("合计 " + u.totalTokens);
    p.push("耗时 " + (ms / 1000).toFixed(1) + "s");
    return p.join(" · ");
  }
  // AI 生成的草稿（仅内存，刷新即丢，v1 可接受）
  window.__draft = window.__draft || null;

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 鉴权客户端（真实多用户 + 超级管理员）：登录/注册，令牌存 localStorage。
  // 社区写操作经 LLM.* 方法自动携带令牌；缺失/失效时由 ensure() 弹窗登录并重试。
  function applyAuth(r) {
    window.Auth.token = r.token || "";
    window.Auth.username = r.username || "";
    window.Auth.role = r.role || "user";
    try {
      localStorage.setItem("ppt_auth", window.Auth.token);
      localStorage.setItem("ppt_auth_user", window.Auth.username);
      localStorage.setItem("ppt_auth_role", window.Auth.role);
    } catch { /* ignore */ }
  }
  function openLoginModal() {
    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "modal-overlay";
      ov.innerHTML = `
        <div class="modal-card card" style="max-width:380px;">
          <div class="ttl">🔐 登录</div>
          <p class="slate" style="margin-top:10px;line-height:1.6;font-size:.85rem;">登录后可发布到社区、评分、收藏、举报。管理员用用户名 <b>admin</b> + 服务器口令登录。</p>
          <input id="auth-user" class="input" style="margin-top:10px;" placeholder="用户名" autocomplete="username" />
          <input id="auth-pass" type="password" class="input" style="margin-top:8px;" placeholder="密码 / 管理员口令" autocomplete="current-password" />
          <div id="auth-msg" class="muted" style="font-size:.78rem;margin-top:8px;color:#dc2626;"></div>
          <div class="flex gap-2 mt-4 flex-wrap items-center">
            <button id="auth-ok" class="btn btn-primary btn-sm">登录</button>
            <button id="auth-cancel" class="btn btn-ghost btn-sm">取消</button>
            <a id="auth-to-reg" href="javascript:;" style="margin-left:auto;font-size:.8rem;">没有账号？注册</a>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      const userEl = (document.getElementById("auth-user") as HTMLInputElement);
      const input = (document.getElementById("auth-pass") as HTMLInputElement);
      const msg = (document.getElementById("auth-msg") as HTMLElement);
      const ok = (document.getElementById("auth-ok") as HTMLButtonElement);
      const cancel = (document.getElementById("auth-cancel") as HTMLButtonElement);
      const toReg = (document.getElementById("auth-to-reg") as HTMLAnchorElement);
      const submit = async () => {
        const username = (userEl && userEl.value || "").trim();
        const pass = input.value;
        if (!username || !pass) { msg.textContent = "请输入用户名和密码"; return; }
        ok.disabled = true; ok.style.opacity = ".6";
        try {
          const r = await LLM.authLogin(username, pass);
          applyAuth(r);
          close(); resolve(r.token);
        } catch (e) {
          msg.textContent = e.message || "登录失败";
          ok.disabled = false; ok.style.opacity = "1";
        }
      };
      ok.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      if (userEl) userEl.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      cancel.addEventListener("click", () => { close(); resolve(null); });
      ov.addEventListener("click", (e) => { if (e.target === ov) { close(); resolve(null); } });
      if (toReg) toReg.addEventListener("click", (e) => { e.preventDefault(); close(); resolve(openRegisterModal()); });
      setTimeout(() => { if (userEl) userEl.focus(); }, 30);
    });
  }
  function openRegisterModal() {
    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "modal-overlay";
      ov.innerHTML = `
        <div class="modal-card card" style="max-width:380px;">
          <div class="ttl">📝 注册账号</div>
          <p class="slate" style="margin-top:10px;line-height:1.6;font-size:.85rem;">用户名 3-30 位（字母/数字/下划线/中文），密码至少 8 位。</p>
          <input id="reg-user" class="input" style="margin-top:10px;" placeholder="用户名" autocomplete="username" />
          <input id="reg-pass" type="password" class="input" style="margin-top:8px;" placeholder="密码（至少 8 位）" autocomplete="new-password" />
          <input id="reg-pass2" type="password" class="input" style="margin-top:8px;" placeholder="确认密码" autocomplete="new-password" />
          <div id="reg-msg" class="muted" style="font-size:.78rem;margin-top:8px;color:#dc2626;"></div>
          <div class="flex gap-2 mt-4 flex-wrap items-center">
            <button id="reg-ok" class="btn btn-primary btn-sm">注册</button>
            <button id="reg-cancel" class="btn btn-ghost btn-sm">取消</button>
            <a id="reg-to-login" href="javascript:;" style="margin-left:auto;font-size:.8rem;">已有账号？登录</a>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const close = () => ov.remove();
      const userEl = (document.getElementById("reg-user") as HTMLInputElement);
      const passEl = (document.getElementById("reg-pass") as HTMLInputElement);
      const pass2El = (document.getElementById("reg-pass2") as HTMLInputElement);
      const msg = (document.getElementById("reg-msg") as HTMLElement);
      const ok = (document.getElementById("reg-ok") as HTMLButtonElement);
      const cancel = (document.getElementById("reg-cancel") as HTMLButtonElement);
      const toLogin = (document.getElementById("reg-to-login") as HTMLAnchorElement);
      const submit = async () => {
        const username = (userEl && userEl.value || "").trim();
        const pass = passEl.value;
        const pass2 = pass2El.value;
        if (pass !== pass2) { msg.textContent = "两次密码不一致"; return; }
        ok.disabled = true; ok.style.opacity = ".6";
        try {
          const r = await LLM.authRegister(username, pass);
          applyAuth(r);
          toast("✓ 注册成功，已自动登录");
          close(); resolve(r.token);
        } catch (e) {
          msg.textContent = e.message || "注册失败";
          ok.disabled = false; ok.style.opacity = "1";
        }
      };
      ok.addEventListener("click", submit);
      [userEl, passEl, pass2El].forEach((el) => { if (el) el.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }); });
      cancel.addEventListener("click", () => { close(); resolve(null); });
      ov.addEventListener("click", (e) => { if (e.target === ov) { close(); resolve(null); } });
      if (toLogin) toLogin.addEventListener("click", (e) => { e.preventDefault(); close(); resolve(openLoginModal()); });
      setTimeout(() => { if (userEl) userEl.focus(); }, 30);
    });
  }
  window.Auth = {
    token: (function () { try { return localStorage.getItem("ppt_auth") || ""; } catch { return ""; } })(),
    username: (function () { try { return localStorage.getItem("ppt_auth_user") || ""; } catch { return ""; } })(),
    role: (function () { try { return localStorage.getItem("ppt_auth_role") || ""; } catch { return ""; } })(),
    isAuthed() { return !!this.token; },
    isAdmin() { return this.role === "admin"; },
    ensure() {
      if (this.token) {
        return fetch("/api/auth/me", { headers: { "x-auth-token": this.token } })
          .then((r) => (r.ok ? this.token : openLoginModal()))
          .catch(() => openLoginModal());
      }
      return openLoginModal();
    },
    logout() {
      this.token = ""; this.username = ""; this.role = "";
      try { localStorage.removeItem("ppt_auth"); localStorage.removeItem("ppt_auth_user"); localStorage.removeItem("ppt_auth_role"); } catch { /* ignore */ }
    },
  };

  function industries() {
    const out = [];
    TEMPLATES.forEach(t => { if (out.indexOf(t.industry) === -1) out.push(t.industry); });
    return out;
  }
  function countFor(ind) { return TEMPLATES.filter(t => t.industry === ind).length; }
  const ICON = {
    "法律": "⚖️", "医疗健康": "🩺", "职场办公": "💼", "教育培训": "🎓",
    "电商运营": "🛒", "金融": "💰", "写作创作": "✍️", "编程开发": "💻"
  };
  function iconFor(i) { return ICON[i] || "📁"; }

  // 固定行业分类（8 个主力 + “其他”，供详情页让用户自定义归类）
  const ALL_INDUSTRIES = ["法律", "医疗健康", "职场办公", "教育培训", "电商运营", "金融", "写作创作", "编程开发", "其他"];

  function findTemplate(slug) {
    // 种子模板（templates.js）优先；其次"我的模板 / AI 草稿"（localStorage，刷新不丢）；最后回退到当前会话内存草稿
    if (!slug) return null;
    const seed = TEMPLATES.find(t => t.slug === slug);
    if (seed) return seed;
    const fromStore = Store.findAny(slug);
    return fromStore || (window.__draft && window.__draft.slug === slug ? window.__draft : null);
  }

  // 用模板生成成品提示词时，模板的 {{占位}} 由模型在思考中动态写具体，无需用户填表。

  // ---------- 卡片 ----------
  function card(t) {
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

  // ---------- 首页 ----------
  function home() {
    setMeta("模法师 Promptly · AI 提示词模板架构师", "说一句话，AI 帮你生成可复用的高质量提示词模板。采用 F1→F2 两阶段范式，把模板与实例分离。");
    const inds = industries();
    const totalCount = TEMPLATES.length;
    app().innerHTML = `
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
        <a id="gen-open" href="#" class="btn-link" style="display:none;margin-top:12px;">查看生成的模板 →</a>
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
          <a href="samples/legal-advisor.json" download class="btn btn-ghost btn-sm">⚖️ 法律顾问.json</a>
          <a href="samples/code-review.json" download class="btn btn-ghost btn-sm">💻 代码审查.json</a>
          <a href="samples/family-doctor.json" download class="btn btn-ghost btn-sm">🩺 家庭医生.json</a>
          <a href="samples/product-copy.json" download class="btn btn-ghost btn-sm">🛒 商品文案.json</a>
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
    (document.getElementById("gen-stop") as HTMLButtonElement).addEventListener("click", () => { if (genController) genController.abort(); });
  }

  function renderList(q) {
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

  // 思考过程时间线状态
  let activeStepKey = "";
  let thinkLog = {};
  const STEP_HINT = {
    clarify: "分析你的需求，判断还缺哪些关键信息；必要时会主动追问你确认",
    retrieve: "在模板库与社区广场里做向量检索，找出语义最相似的范例作为参考",
    draft: "结合参考范例与你的需求，起草模板骨架、变量与约束",
    validate: "对照规则自审：角色 / 背景 / 任务 / 格式 四段是否齐全",
    finalize: "精炼措辞、统一格式，输出最终成果",
    analyze: "对照你的反馈与实际测试表现，定位原提示词的具体不足与改写方向",
    rewrite: "保留好的部分，针对反馈逐条改写，输出完整新版提示词",
  };

  // 状态机步骤条：把 Agent 的节点事件可视化（升级为实时思考时间线）
  // 生成模板（F1）的五步状态机
  const GEN_STEPS_5 = [
    { k: "clarify", label: "① 澄清意图" },
    { k: "retrieve", label: "② 检索范例" },
    { k: "draft", label: "③ 起草模板" },
    { k: "validate", label: "④ 自审校验" },
    { k: "finalize", label: "⑤ 精炼产出" },
  ];
  // 用模板生成提示词（F2，模型代写）的三步状态机
  const GEN_STEPS_3 = [
    { k: "retrieve", label: "① 检索范例" },
    { k: "draft", label: "② 撰写提示词" },
    { k: "finalize", label: "③ 精炼定稿" },
  ];
  // 根据反馈动态改写提示词（F5）：分析不足 → 改写
  const REFINE_STEPS = [
    { k: "analyze", label: "① 分析不足" },
    { k: "rewrite", label: "② 改写提示词" },
  ];

  // 展示 RAG 召回的参考范例（让“agent 有依据”可见）
  function renderRagRefs(refs) {
    const el = (document.getElementById("gen-rag") as HTMLElement);
    if (!el) return;
    if (!refs || !refs.length) { el.style.display = "none"; el.innerHTML = ""; return; }
    el.style.display = "block";
    el.innerHTML = `<div class="ttl">🔎 已从模板库与社区广场检索到 ${refs.length} 个相似范例作为参考</div>` +
      `<div style="display:flex;flex-wrap:wrap;gap:6px;">` +
      refs.map((r) => `<span class="tag" style="background:#fff;border:1px solid var(--brand-100);">${r.source === "community" ? '<b style="color:#16a34a">社区</b> · ' : ""}${esc(r.title)}<span class="muted"> · ${esc(r.industry)}</span></span>`).join("") +
      `</div>`;
  }

  function renderGenSteps(activeKey, steps, containerId = "gen-steps") {
    const el = document.getElementById(containerId || "gen-steps");
    if (!el) return;
    const list = steps || GEN_STEPS_5;
    if (activeKey && activeKey !== "__done__") activeStepKey = activeKey;
    el.style.display = "block";
    const actIdx = list.findIndex((s) => s.k === activeStepKey);
    el.innerHTML = '<div class="timeline">' + list.map((s) => {
      const curIdx = list.findIndex((x) => x.k === s.k);
      let state = "pending";
      if (activeKey === "__done__") state = "done";
      else if (curIdx < actIdx) state = "done";
      else if (curIdx === actIdx) state = "active";
      const hint = (state === "active" || state === "done") ? (STEP_HINT[s.k] || "") : "";
      const thinks = (thinkLog[s.k] || []).map((t) => `<div class="think-line">${esc(t)}</div>`).join("");
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
  function appendThink(text, containerId = "gen-steps") {
    if (!text) return;
    if (!thinkLog[activeStepKey]) thinkLog[activeStepKey] = [];
    thinkLog[activeStepKey].push(text);
    const base = containerId || "gen-steps";
    const box = document.querySelector('#' + base + ' .step[data-step="' + activeStepKey + '"] .step-think');
    if (box) {
      const d = document.createElement("div");
      d.className = "think-line";
      d.textContent = text;
      box.appendChild(d);
      try { box.scrollIntoView({ block: "nearest" }); } catch (e) {}
    }
  }

  async function handleGenerate() {
    const msg = (document.getElementById("gen-msg") as HTMLElement);
    const live = (document.getElementById("gen-live") as HTMLElement);
    const genBtn = (document.getElementById("gen-btn") as HTMLButtonElement);
    const stopBtn = (document.getElementById("gen-stop") as HTMLButtonElement);
    const openBtn = (document.getElementById("gen-open") as HTMLAnchorElement);
    const industry = (document.getElementById("gen-industry") as HTMLSelectElement).value;
    const sentence = (document.getElementById("gen-input") as HTMLInputElement).value.trim();
    if (!sentence) { msg.textContent = "请先描述你的需求。"; return; }
    live.style.display = "block";
    live.textContent = "";
    renderRagRefs(null);
    thinkLog = {}; activeStepKey = "";
    msg.textContent = "Agent 运行中（展示状态机流程）…";
    renderGenSteps("clarify", GEN_STEPS_5);
    openBtn.style.display = "none";
    genBtn.disabled = true; genBtn.style.opacity = ".55";
    stopBtn.style.display = "inline-flex";
    genController = new AbortController();
    try {
      const onGenToken = (chunk, done) => {
        if (chunk) live.textContent += chunk;
        if (done) live.textContent += "\n\n✓ 生成完成";
      };
      // 把 Agent 节点事件映射到步骤条
      const onNode = (name) => {
        if (name === "meta") { renderGenSteps("clarify", GEN_STEPS_5); return; }
        if (name === "result") { renderGenSteps("__done__", GEN_STEPS_5); return; }
        renderGenSteps(name, GEN_STEPS_5);
      };
      const onThink = (text) => { appendThink(text); };
      const onContext = (refs) => { renderRagRefs(refs); };
      let res;
      try {
        // 优先走服务端 Agent（RAG + 自审 + 流式）；仅当服务端不可用时，回退到浏览器直连（效果一致）
        res = await LLM.generateViaAgent(industry, sentence, onGenToken, onNode, genController.signal, onContext, onThink);
      } catch (e) {
        const m = (e && e.message) || "";
        if (/API 错误|401|Authentication|api ?key|invalid|key/i.test(m)) throw e;
        live.textContent += "\n（服务端 Agent 暂不可用，已自动改用浏览器直连生成）";
        renderGenSteps("draft", GEN_STEPS_5);
        appendThink("已切换浏览器直连，正在调用模型生成模板（此模式下不展示中间思考）…");
        res = await LLM.generateTemplate(industry, sentence, onGenToken, genController.signal);
      }
      // 展示 token 消耗
      renderGenSteps("__done__", GEN_STEPS_5);
      if (res.usage) live.textContent += "\n\n📊 " + fmtUsage(res.usage, res.elapsedMs);
      else live.textContent += "\n耗时 " + (res.elapsedMs / 1000).toFixed(1) + "s";
      // 把用量带到详情页持久展示
      res.tpl._genUsage = res.usage;
      res.tpl._genElapsed = res.elapsedMs;
      if (!res.tpl.slug) res.tpl.slug = "gen-" + Date.now(); // 保证稳定 id，便于热度榜/收藏按 id 累计
      window.__draft = res.tpl;
      Store.saveDraft(res.tpl); // 持久化草稿，刷新后仍可找回
      // 不再自动跳转：保留状态机流程可见，由用户点「查看生成的模板」进入详情
      msg.textContent = "✓ 已生成模板：「" + (res.tpl.title || "未命名") + "」";
      openBtn.href = "#/t/" + res.tpl.slug;
      openBtn.style.display = "inline-block";
    } catch (e) {
      if (genController && genController.signal.aborted) {
        live.textContent += "\n\n■ 已停止生成";
        msg.textContent = "已停止生成。";
      } else {
        live.textContent += "\n\n✗ 生成失败：" + e.message;
        msg.textContent = "生成失败：" + e.message;
      }
    } finally {
      genBtn.disabled = false; genBtn.style.opacity = "1";
      stopBtn.style.display = "none";
      genController = null;
    }
  }

  // ---------- 行业页 ----------
  function industry(name) {
    const list = TEMPLATES.filter(t => t.industry === name);
    app().innerHTML = `
      <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
      <h1 class="section-title" style="font-size:1.7rem;margin-top:10px;">${iconFor(name)} ${esc(name)}</h1>
      <p class="muted" style="margin-top:6px;">共 ${list.length} 个模板</p>
      <div class="grid sm:grid-cols-2 gap-3 mt-4">${list.map(card).join("")}</div>
    `;
  }

  // ---------- 详情页 ----------
  function detail(slug) {
    const tpl = findTemplate(slug);
    if (!tpl) { app().innerHTML = '<p>模板不存在或已失效（AI 草稿刷新后需重新生成）。</p>'; return; }
    // 深拷贝，避免修改行业分类时污染全局种子对象或内存草稿
    current = JSON.parse(JSON.stringify(tpl));
    testMessages = []; testController = null; // 进入新模板时清空测试沙盒对话
    const isMine = Store.hasMine(slug);
    setMeta(tpl.title, (tpl.summary || tpl.task || "").slice(0, 120));
    const tagHtml = (tpl.tags || []).map(t => `<span class="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded mr-1">#${esc(t)}</span>`).join("");
    const industryOpts = ALL_INDUSTRIES.map(i =>
      `<option value="${esc(i)}" ${i === tpl.industry ? "selected" : ""}>${esc(i)}</option>`
    ).join("");
    const dimsHtml = (tpl.variables && tpl.variables.length)
      ? tpl.variables.map(v => `<span class="tag">${esc(v.label)}</span>`).join("")
      : '<span class="muted">通用专家提示词（角色 + 结构由模板固定）</span>';

    app().innerHTML = `
      <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
      <div class="mt-3">
        <h1 class="section-title" style="font-size:1.7rem;">${esc(tpl.title)}</h1>
        <div class="muted" style="font-size:.85rem;margin-top:6px;"><span id="meta-industry">${esc(tpl.industry)}</span> · ${esc(tpl.task)}
          ${tpl.generated ? '<span class="pill pill-amber" style="margin-left:4px;">AI 生成</span>' : ""}</div>
        ${current._genUsage ? `<div class="mt-2 inline-flex items-center gap-1 text-xs" style="color:var(--slate);background:#f1f5f9;padding:4px 10px;border-radius:8px;">📊 模板生成：${esc(fmtUsage(current._genUsage, current._genElapsed || 0))}</div>` : ""}
      </div>
      <div class="flex flex-wrap items-center gap-2 mt-3">
        <label class="text-sm font-medium" style="color:var(--slate)">所属分类</label>
        <select id="set-industry" class="select" style="width:auto;padding:7px 12px;">${industryOpts}</select>
        ${tpl.generated ? '<span class="text-xs muted">AI 生成模板可在此改到任意分类</span>' : ""}
      </div>
      <p class="slate" style="margin-top:10px;line-height:1.6;">${esc(tpl.summary)}</p>
      <div class="mt-2">${tagHtml}</div>
      ${tpl.sources && tpl.sources.length ? `<div class="gen-rag" style="margin-top:14px;"><div class="ttl">📚 该模板生成时参考了 ${tpl.sources.length} 个模板库范例</div><div style="display:flex;flex-wrap:wrap;gap:6px;">${tpl.sources.map(s => `<span class="tag" style="background:#fff;border:1px solid var(--brand-100);">${esc(s.title)}<span class="muted"> · ${esc(s.industry)}</span></span>`).join("")}</div></div>` : ""}

      <div class="card tpl-card" style="margin-top:18px;">
        <div class="ttl">🧩 这个模板会自动帮你覆盖（由 AI 在生成时动态写具体）</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">${dimsHtml}</div>
      </div>

      <div class="card tpl-card" style="margin-top:16px;">
        <div class="ttl">📄 模板正文（可复用的「提示词骨架」）</div>
        <pre class="code-box" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;">${esc(tpl.prompt || "（此模板为通用专家提示词，无固定骨架，由模型在生成时动态撰写具体内容）")}</pre>
        <div class="muted" style="font-size:.78rem;margin-top:6px;">↑ 这是「可复用的模板骨架」（含 {{占位变量}}），本身不能直接发给 AI。在下方填入你的具体目标，即可把它填成一份可直接用的成品提示词。</div>
      </div>

      <div class="card tpl-card" style="margin-top:16px;">
        <div class="ttl">⭐ 给这个模板评分</div>
        <div id="rate-stars" class="rate-stars">
          ${[1,2,3,4,5].map(n => `<span class="star" data-n="${n}">★</span>`).join("")}
        </div>
        <div id="rate-info" class="muted" style="font-size:.78rem;margin-top:6px;">加载评分中…</div>
      </div>

      <div class="card tpl-card" style="margin-top:16px;">
        <h2 class="section-title" style="font-size:1.1rem;">用这个模板，生成你的专属提示词</h2>
        <p class="muted" style="font-size:.82rem;margin-top:6px;">上面的模板只是「骨架」，这里把它变成你能直接用的成品：先说一句你的目标；如果还说不清，模型会主动追问几个关键点让你点选确认，信息齐了再据此写出具体、可直接复制去问 AI 的提示词——你不用手动填任何模板字段。</p>
        <textarea id="use-goal" class="input" rows="3" style="margin-top:10px;" placeholder="填你的具体目标，AI 会把它套进上面的模板，写出可直接用的提示词。例如：房东要扣我押金，我想写个专业的法律咨询提问，问清楚他有没有权扣、我能要回多少、要准备什么证据"></textarea>
        <div class="flex gap-2 mt-3 flex-wrap items-center">
          <button id="use-btn" class="btn btn-primary">✨ 生成提示词</button>
          <button id="use-stop" class="btn btn-danger" style="display:none">■ 停止</button>
          <button id="save-btn" class="btn btn-ghost">${isMine ? "★ 已收藏" : "☆ 收藏到我的模板"}</button>
          <button id="dl-tpl-btn" class="btn btn-ghost btn-sm">下载此模板</button>
        </div>
        <div id="use-clarify" style="margin-top:14px;display:none;"></div>
        <div id="gen-steps" class="gen-steps" style="display:none;margin-top:12px;"></div>
        <div id="gen-rag" class="gen-rag" style="display:none;"></div>
        <div id="use-live-label" class="live-label" style="display:none;margin-top:12px;">📋 成品提示词</div>
        <pre id="use-live" class="code-box" style="display:none;margin-top:8px;"></pre>
        <div id="use-actions" class="flex gap-2 mt-3 flex-wrap items-center" style="display:none;">
          <button id="use-run" class="btn btn-primary btn-sm">🧪 测试这个提示词</button>
          <button id="use-copy" class="btn btn-ghost btn-sm">复制提示词</button>
          <button id="use-dl-md" class="btn btn-ghost btn-sm">下载 .md</button>
          <button id="use-dl-txt" class="btn btn-ghost btn-sm">下载 .txt</button>
          <button id="use-publish" class="btn btn-ghost btn-sm">📣 发布到社区</button>
          <span id="use-usage" class="muted" style="font-size:.75rem;"></span>
        </div>
      </div>
      <div id="use-run-wrap" class="card tpl-card" style="margin-top:16px;display:none;">
        <div class="flex items-center justify-between">
          <div class="ttl">🧪 测试这个提示词（把它当作系统设定，自由提问，多轮对话）</div>
          <div class="flex gap-2 items-center">
            <button id="refine-open" class="btn btn-ghost btn-sm">✏️ 不满意？让 AI 改进</button>
            <button id="test-clear" class="btn btn-ghost btn-sm">清空对话</button>
          </div>
        </div>
        <details class="test-prompt-box" style="margin-top:8px;">
          <summary>📋 当前正在测试的提示词（点击展开）</summary>
          <pre id="test-prompt" class="code-box" style="margin-top:6px;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;"></pre>
        </details>
        <div id="test-log" class="test-log"></div>
        <div class="test-input-row">
          <textarea id="test-input" class="input" rows="2" placeholder="在这里输入你的问题，回车发送（Shift+Enter 换行）…"></textarea>
          <div class="flex gap-2 items-center">
            <button id="test-send" class="btn btn-primary btn-sm">发送</button>
            <button id="use-run-stop" class="btn btn-danger btn-sm" style="display:none">■ 停止</button>
          </div>
        </div>
        <div id="use-run-usage" class="muted" style="font-size:.75rem;margin-top:6px;"></div>

        <div id="refine-box" class="refine-box" style="display:none;">
          <div class="ttl">✏️ 对这条提示词不满意？描述问题，AI 帮你改写</div>
          <textarea id="refine-feedback" class="input" rows="3" style="margin-top:8px;" placeholder="例如：回答太啰嗦、没有按我要求的表格格式输出、语气太生硬、没先问清我的预算就给方案、容易跑题……"></textarea>
          <div class="flex gap-2 mt-3 flex-wrap items-center">
            <button id="refine-go" class="btn btn-primary btn-sm">🔧 分析并改写</button>
            <button id="refine-cancel" class="btn btn-ghost btn-sm">取消</button>
          </div>
          <div id="refine-steps" class="gen-steps" style="display:none;margin-top:12px;"></div>
          <pre id="refine-live" class="code-box" style="display:none;margin-top:12px;"></pre>
          <div id="refine-result" class="refine-result" style="display:none;margin-top:12px;"></div>
        </div>
      </div>
      <div id="msg" class="muted" style="font-size:.78rem;margin-top:12px;"></div>
    `;

    (document.getElementById("use-btn") as HTMLButtonElement).addEventListener("click", handleUse);
    const stopU = (document.getElementById("use-stop") as HTMLButtonElement);
    if (stopU) stopU.addEventListener("click", () => { if (useController) useController.abort(); });
    (document.getElementById("save-btn") as HTMLButtonElement).addEventListener("click", toggleSave);
    (document.getElementById("dl-tpl-btn") as HTMLButtonElement).addEventListener("click", downloadTemplate);
    (document.getElementById("use-copy") as HTMLButtonElement).addEventListener("click", copyUsePrompt);
    (document.getElementById("use-dl-md") as HTMLButtonElement).addEventListener("click", () => downloadUsePrompt("md"));
    (document.getElementById("use-dl-txt") as HTMLButtonElement).addEventListener("click", () => downloadUsePrompt("txt"));
    const runBtn = (document.getElementById("use-run") as HTMLButtonElement);
    if (runBtn) runBtn.addEventListener("click", handleTestChat);
    const publishBtn = (document.getElementById("use-publish") as HTMLButtonElement);
    if (publishBtn) publishBtn.addEventListener("click", () => {
      openPublishForm({
        title: tpl.title,
        industry: current.industry || tpl.industry,
        tags: tpl.tags || [],
        prompt: current._lastPrompt || tpl.prompt,
        note: tpl.summary || "",
      });
    });
    const runStop = (document.getElementById("use-run-stop") as HTMLButtonElement);
    if (runStop) runStop.addEventListener("click", () => { if (testController) testController.abort(); });
    const testSend = (document.getElementById("test-send") as HTMLButtonElement);
    if (testSend) testSend.addEventListener("click", sendTestMessage);
    const testClear = (document.getElementById("test-clear") as HTMLButtonElement);
    if (testClear) testClear.addEventListener("click", clearTestChat);
    // 本页（模板详情）使用模板版 refine 上下文，供 F5 改写逻辑区分元素/状态
    refineCtx = templateRefineCtx();
    const refineOpen = (document.getElementById("refine-open") as HTMLButtonElement);
    if (refineOpen) refineOpen.addEventListener("click", openRefineBox);
    const refineGo = (document.getElementById("refine-go") as HTMLButtonElement);
    if (refineGo) refineGo.addEventListener("click", handleRefine);
    const refineCancel = (document.getElementById("refine-cancel") as HTMLButtonElement);
    if (refineCancel) refineCancel.addEventListener("click", closeRefineBox);
    const testInput = (document.getElementById("test-input") as HTMLTextAreaElement);
    if (testInput) testInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTestMessage(); }
    });

    // 用户自定义归类：改行业分类后实时更新头部显示，保存时一并写入
    const indSel = (document.getElementById("set-industry") as HTMLSelectElement);
    if (indSel) {
      indSel.addEventListener("change", e => {
        current.industry = (e.target as HTMLInputElement).value;
        const meta = (document.getElementById("meta-industry") as HTMLElement);
        if (meta) meta.textContent = current.industry;
        const m = (document.getElementById("msg") as HTMLElement);
        if (m && !Store.hasMine(current.slug)) m.textContent = "已选择分类：" + current.industry + "（收藏后生效）";
      });
    }

    // 评分：星星点选 + 拉取当前评分
    const stars = (document.getElementById("rate-stars") as HTMLElement);
    if (stars) {
      stars.querySelectorAll(".star").forEach(s => s.addEventListener("click", () => {
        rateTemplate(Number(s.getAttribute("data-n")));
      }));
    }
    loadRateInfo(tplId(current));
  }

  // 高亮用户已选/将选的星数
  function highlightStars(n) {
    const stars = (document.getElementById("rate-stars") as HTMLElement);
    if (!stars) return;
    stars.querySelectorAll(".star").forEach(s => {
      s.classList.toggle("on", Number(s.getAttribute("data-n")) <= n);
    });
  }

  // 提交评分（带本人上次评分做差值，避免重复计数）
  function rateTemplate(score) {
    const id = tplId(current);
    if (!id) return;
    const prev = Store.getRating(id);
    metricRate(id, score, prev, current.title, current.industry);
    Store.setRating(id, score);
    highlightStars(score);
    loadRateInfo(id);
    const m = (document.getElementById("msg") as HTMLElement);
    if (m) { m.textContent = "已评分 " + score + " 星 ✓"; setTimeout(() => { if (m) m.textContent = ""; }, 2000); }
  }

  // 拉取并展示该模板的累计评分（均分 + 人数）
  async function loadRateInfo(id) {
    const info = (document.getElementById("rate-info") as HTMLElement);
    if (!info || !id) return;
    highlightStars(Store.getRating(id) || 0);
    try {
      const r = await fetch("/metrics?id=" + encodeURIComponent(id));
      if (!r.ok) { info.textContent = "（暂无评分）"; return; }
      const e = await r.json();
      const avg = e.avgRating != null ? e.avgRating : 0;
      const my = Store.getRating(id);
      info.textContent = `当前均分 ${avg} 星 · ${e.ratingCount || 0} 人评分` + (my ? ` · 你给了 ${my} 星` : "");
    } catch {
      info.textContent = "（评分加载失败）";
    }
  }

  // 把"原始目标 + 已确认问答"拼成完整 brief（模型不可用时兜底）
  function buildCombinedGoal(goal, qa) {
    if (!qa || !qa.length) return goal;
    return goal + "\n\n（用户确认的关键信息）\n" + qa.map((h, i) => `${i + 1}) ${h.question} → ${h.answer}`).join("\n");
  }

  // 用模板生成成品提示词：先访谈确认信息，再让模型代写（F3 + F2 串联）
  async function handleUse() {
    const msg = (document.getElementById("msg") as HTMLElement);
    const live = (document.getElementById("use-live") as HTMLElement);
    const goal = ((document.getElementById("use-goal") as HTMLTextAreaElement).value || "").trim();
    if (!goal) { msg.textContent = "请先描述你的目标。"; return; }

    const useBtn = (document.getElementById("use-btn") as HTMLButtonElement);
    if (useBtn) { useBtn.disabled = true; useBtn.style.opacity = ".55"; } // 锁定按钮，防止重复提交
    live.style.display = "none";
    live.textContent = "";
    (document.getElementById("use-actions") as HTMLElement).style.display = "none";
    (document.getElementById("gen-rag") as HTMLElement).style.display = "none";
    msg.textContent = "分析中，请稍候…";
    useQa = [];
    useRound = 0;
    // 注意：use-btn 在整个「访谈 + 代写」流程结束前保持禁用，
    // 由 startUseGeneration 的 finally 在生成完成后恢复，避免重复触发。
    await runInterviewRound(goal, msg, live);
  }

  // 单轮访谈：调 /agent/clarify，complete 则进入生成，否则渲染问题让用户确认
  async function runInterviewRound(goal, msg, live) {
    const clarifyBox = (document.getElementById("use-clarify") as HTMLElement);
    const sel = new AbortController();
    useController = sel;
    let data;
    try {
      // 先渲染"思考中"面板（步骤条 + 实时思考流），避免访谈阶段黑屏
      clarifyBox.style.display = "block";
      clarifyBox.innerHTML = `
        <div class="clarify-head">🤖 模型正在分析你的需求，确认需要补充的关键信息…</div>
        <div class="timeline" id="clarify-think">
          <div class="step done">
            <div class="step-dot">✓</div>
            <div class="step-body"><div class="step-title">读取模板定位与你的目标</div></div>
          </div>
          <div class="step active" id="think-clarify">
            <div class="step-dot"></div>
            <div class="step-body">
              <div class="step-title">识别缺失的关键信息</div>
              <div class="step-hint">分析你的需求，判断还缺哪些关键信息（受众 / 形式 / 约束 / 语气等）；必要时主动追问你确认</div>
              <div class="step-think" id="clarify-think-stream"></div>
            </div>
          </div>
        </div>
        <div id="clarify-q"></div>`;
      const thinkStream = (document.getElementById("clarify-think-stream") as HTMLElement);
      const onNode = (name) => { if (name === "clarify") { const el = (document.getElementById("think-clarify") as HTMLElement); if (el) el.classList.add("is-active"); } };
      const onThink = (text) => {
        if (thinkStream) { const line = document.createElement("div"); line.className = "think-line"; line.textContent = "▸ " + text; thinkStream.appendChild(line); }
      };
      data = await LLM.clarifyViaAgent(current, goal, useQa, sel.signal, onNode, onThink);
    } catch (e) {
      if (sel.signal.aborted) return; // 用户中止访谈，什么都不做
      // 访谈不可用（无 Key 等）：直接按原始目标生成
      msg.textContent = "访谈不可用，直接生成…";
      return startUseGeneration(goal, msg, live);
    }
    if (data.complete || useRound >= MAX_CLARIFY_ROUNDS) {
      const enriched = (data.enrichedGoal && data.enrichedGoal.trim()) ? data.enrichedGoal : buildCombinedGoal(goal, useQa);
      return startUseGeneration(enriched, msg, live);
    }
    renderClarifyQuestions(data.questions, goal, msg, live);
  }

  // 渲染本轮问题：每个选项 chip 可点选，也允许自由补充；确认后收集答案进入下一轮
  function renderClarifyQuestions(questions, goal, msg, live) {
    // 先把访谈"思考步"标记完成，并保留思考过程可见（不覆盖）
    const thinkItem = (document.getElementById("think-clarify") as HTMLElement);
    if (thinkItem) {
      thinkItem.classList.remove("active");
      thinkItem.classList.add("done");
      const dot = thinkItem.querySelector(".step-dot");
      if (dot) dot.innerHTML = "✓";
    }
    const qBox = (document.getElementById("clarify-q") as HTMLElement);
    const roundLabel = useRound + 1;
    const qText = questions.map(q => q.question);
    const historyHtml = useQa.length
      ? `<div class="qa-history">` + useQa.map((h, i) =>
          `<div class="qa-row"><div class="qa-q">${i + 1}. ${esc(h.question)}</div><div class="qa-a">→ ${esc(h.answer)}</div></div>`).join("") + `</div>`
      : "";
    const qHtml = questions.map((q, qi) => {
      const opts = q.options.map(o => `<button type="button" class="opt-chip" data-qi="${qi}">${esc(o)}</button>`).join("");
      return `<div class="q-card" data-qi="${qi}">
        <div class="q-title">${esc(q.question)}</div>
        <div class="opt-row" data-qi="${qi}">${opts}</div>
        <input class="input q-free" data-qi="${qi}" placeholder="或自己补充…">
      </div>`;
    }).join("");
    if (qBox) qBox.innerHTML = `
      <div class="clarify-head">🤖 第 ${roundLabel} 轮确认 · 点选项或自行填写，补全后点「确认」${useRound >= MAX_CLARIFY_ROUNDS - 1 ? "（最后一轮）" : ""}</div>
      ${historyHtml}
      ${qHtml}
      <div class="flex gap-2 mt-3 flex-wrap items-center">
        <button id="clarify-ok" class="btn btn-primary btn-sm">✓ 确认并继续</button>
        <button id="clarify-skip" class="btn btn-ghost btn-sm">跳过追问，直接生成</button>
      </div>`;

    const selState = {}; // qi -> {q, a}
    if (qBox) qBox.querySelectorAll(".opt-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        const qi = btn.getAttribute("data-qi");
        qBox.querySelector(`.opt-row[data-qi="${qi}"]`).querySelectorAll(".opt-chip").forEach(b => b.classList.remove("sel"));
        btn.classList.add("sel");
        selState[qi] = { q: qText[qi], a: btn.textContent };
        const free = qBox.querySelector<HTMLInputElement>(`.q-free[data-qi="${qi}"]`);
        if (free) free.value = "";
      });
    });
    if (qBox) qBox.querySelectorAll<HTMLInputElement>(".q-free").forEach(inp => {
      inp.addEventListener("input", () => {
        const qi = inp.getAttribute("data-qi");
        if (inp.value.trim()) { selState[qi] = { q: qText[qi], a: inp.value.trim() }; }
        else if (selState[qi] && selState[qi].a === inp.value.trim()) { delete selState[qi]; }
      });
    });
    (document.getElementById("clarify-skip") as HTMLButtonElement).addEventListener("click", () => {
      const okBtn = (document.getElementById("clarify-ok") as HTMLButtonElement);
      const skipBtn = (document.getElementById("clarify-skip") as HTMLButtonElement);
      if (okBtn) okBtn.disabled = true;
      if (skipBtn) { skipBtn.disabled = true; skipBtn.style.opacity = ".55"; } // 锁定，防重复提交
      if (qBox) qBox.innerHTML = '<div class="clarify-head">🤖 正在生成你的提示词，请稍候…<span class="spinner"></span></div>';
      startUseGeneration(buildCombinedGoal(goal, useQa), msg, live);
    });
    (document.getElementById("clarify-ok") as HTMLButtonElement).addEventListener("click", () => {
      const answers = Object.keys(selState).map(k => ({ question: selState[k].q, answer: selState[k].a }));
      if (!answers.length) { msg.textContent = "请至少选择或修改一项，或点「跳过」。"; return; }
      const okBtn = (document.getElementById("clarify-ok") as HTMLButtonElement);
      const skipBtn = (document.getElementById("clarify-skip") as HTMLButtonElement);
      if (okBtn) { okBtn.disabled = true; okBtn.style.opacity = ".55"; } // 锁定本轮，防重复提交
      if (skipBtn) skipBtn.disabled = true;
      useQa = useQa.concat(answers);
      useRound++;
      if (qBox) qBox.innerHTML = '<div class="clarify-head">🤖 正在生成下一轮确认问题，请稍候…<span class="spinner"></span></div>';
      runInterviewRound(goal, msg, live);
    });
  }

  // 进入生成：把"目标 + 已确认问答"交给 /agent/use 代写成品提示词
  async function startUseGeneration(goal, msg, live) {
    const clarifyBox = (document.getElementById("use-clarify") as HTMLElement);
    clarifyBox.style.display = "none";
    clarifyBox.innerHTML = "";
    if (useQa.length) {
      clarifyBox.style.display = "block";
      clarifyBox.innerHTML = `<div class="clarify-done">✓ 已确认 ${useQa.length} 项关键信息，正在据此生成提示词…</div>`;
    }
    const btn = (document.getElementById("use-btn") as HTMLButtonElement);
    const stopBtn = (document.getElementById("use-stop") as HTMLButtonElement);
    const actions = (document.getElementById("use-actions") as HTMLElement);
    live.style.display = "block";
    live.textContent = "";
    actions.style.display = "none";
    // 主卡片标题：进入生成时重置为「成品提示词」（避免沿用上一次的「改进版」标记）
    const liveLabel = (document.getElementById("use-live-label") as HTMLElement);
    if (liveLabel) { liveLabel.style.display = "block"; liveLabel.textContent = "📋 成品提示词"; liveLabel.className = "live-label"; }
    msg.textContent = "模型代写中（检索范例 → 撰写 → 定稿）…";
    thinkLog = {}; activeStepKey = "";
    renderGenSteps("retrieve", GEN_STEPS_3);
    btn.disabled = true; btn.style.opacity = ".55";
    stopBtn.style.display = "inline-flex";
    useController = new AbortController();
    current._lastPrompt = "";
    try {
      const onToken = (chunk) => { if (chunk) live.textContent += chunk; };
      const onNode = (name) => {
        if (name === "meta") { renderGenSteps("retrieve", GEN_STEPS_3); return; }
        if (name === "result") { renderGenSteps("__done__", GEN_STEPS_3); return; }
        renderGenSteps(name, GEN_STEPS_3);
      };
      const onThink = (text) => { appendThink(text); };
      const onContext = (refs) => { renderRagRefs(refs); };
      let res;
      try {
        res = await LLM.useTemplateViaAgent(current, goal, onToken, onNode, useController.signal, onContext, onThink);
      } catch (e) {
        const m = (e && e.message) || "";
        if (/API 错误|401|Authentication|api ?key|invalid|key/i.test(m)) throw e;
        live.textContent += "\n（服务端 Agent 暂不可用，已自动改用浏览器直连生成）";
        renderGenSteps("draft", GEN_STEPS_3);
        appendThink("已切换浏览器直连，正在调用模型代写提示词…");
        res = await LLM.useTemplate(current, goal, onToken, useController.signal);
      }
      current._lastPrompt = res.prompt || "";
      metricBump(tplId(current), "use", 1, current.title, current.industry);
      renderGenSteps("__done__", GEN_STEPS_3);
      const usageEl = (document.getElementById("use-usage") as HTMLElement);
      if (res.usage) usageEl.textContent = "📊 " + fmtUsage(res.usage, res.elapsedMs);
      actions.style.display = "flex";
      msg.textContent = "✓ 已生成成品提示词（模型已结合你确认的信息写好具体内容）。";
    } catch (e) {
      if (useController && useController.signal.aborted) {
        live.textContent += "\n\n■ 已停止生成";
        msg.textContent = "已停止生成。";
      } else {
        live.textContent += "\n\n✗ 生成失败：" + e.message;
        msg.textContent = "生成失败：" + e.message;
      }
    } finally {
      btn.disabled = false; btn.style.opacity = "1";
      stopBtn.style.display = "none";
      useController = null;
    }
  }

  // 测试沙盒：把生成的成品提示词当作"系统设定"，与用户多轮自由对话，实时判断提示词好不好用
  function handleTestChat() {
    const wrap = (document.getElementById("use-run-wrap") as HTMLElement);
    const promptEl = (document.getElementById("test-prompt") as HTMLElement);
    if (!wrap || !promptEl) return;
    wrap.style.display = "block";
    promptEl.textContent = current._lastPrompt || "（尚未生成提示词）";
    if (!current._lastPrompt) {
      const m = (document.getElementById("msg") as HTMLElement);
      if (m) m.textContent = "请先生成提示词再测试。";
      return;
    }
    const log = (document.getElementById("test-log") as HTMLElement);
    if (log && !log.children.length && !testMessages.length) {
      log.innerHTML = '<div class="test-empty muted">对话已开始 —— 在下方输入问题，模型会按上面的提示词作答。可连续追问，检验提示词是否好用。</div>';
    }
    const input = (document.getElementById("test-input") as HTMLTextAreaElement);
    if (input) input.focus();
  }

  function appendTestBubble(text, role) {
    const log = (document.getElementById("test-log") as HTMLElement);
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

  function clearTestChat() {
    testMessages = [];
    const log = (document.getElementById("test-log") as HTMLElement);
    if (log) log.innerHTML = '<div class="test-empty muted">对话已清空 —— 重新输入问题开始测试。</div>';
    const usageEl = (document.getElementById("use-run-usage") as HTMLElement);
    if (usageEl) usageEl.textContent = "";
  }

  async function sendTestMessage() {
    const input = (document.getElementById("test-input") as HTMLTextAreaElement);
    const log = (document.getElementById("test-log") as HTMLElement);
    const m = (document.getElementById("msg") as HTMLElement);
    const sendBtn = (document.getElementById("test-send") as HTMLButtonElement);
    const stopBtn = (document.getElementById("use-run-stop") as HTMLButtonElement);
    const usageEl = (document.getElementById("use-run-usage") as HTMLElement);
    if (!input || !log) return;
    const text = input.value.trim();
    if (!text) return;
    if (!current._lastPrompt) { if (m) m.textContent = "请先生成提示词再测试。"; return; }

    // 锁定发送 + 显示停止，防重复提交
    if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = ".55"; }
    if (stopBtn) stopBtn.style.display = "inline-flex";

    testMessages.push({ role: "user", content: text });
    input.value = "";
    appendTestBubble(text, "user");

    const emptyEl = log.querySelector(".test-empty");
    if (emptyEl) emptyEl.remove();

    // 创建 assistant 流式气泡占位
    const aBubble = document.createElement("div");
    aBubble.className = "test-bubble assistant";
    const aText = document.createElement("div");
    aText.className = "test-bubble-text";
    aBubble.appendChild(aText);
    log.appendChild(aBubble);
    log.scrollTop = log.scrollHeight;

    testController = new AbortController();
    let full = "";
    if (m) m.textContent = "模型回复中…";
    try {
      const onToken = (chunk) => {
        if (chunk) { full += chunk; aText.textContent = full; log.scrollTop = log.scrollHeight; }
      };
      const res = await LLM.chatWithPrompt(current._lastPrompt, testMessages, onToken, testController.signal);
      full = res.text || full;
      aText.textContent = full;
      testMessages.push({ role: "assistant", content: full });
      if (res.usage) usageEl.textContent = "📊 " + fmtUsage(res.usage, res.elapsedMs);
      if (m) m.textContent = "✓ 已回复（可继续追问，检验提示词效果）。";
    } catch (e) {
      if (testController && testController.signal.aborted) {
        aText.textContent = (full ? full + "\n\n" : "") + "■ 已停止";
        if (m) m.textContent = "已停止。";
      } else {
        aText.textContent = (full ? full + "\n\n" : "") + "✗ 测试失败：" + e.message;
        if (m) m.textContent = "测试失败：" + e.message;
      }
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = "1"; }
      if (stopBtn) stopBtn.style.display = "none";
      testController = null;
      if (input) input.focus();
    }
  }

  // ---------- F5：测试不满意 -> 提反馈 -> 动态改写提示词 ----------
  // 两页（模板详情 / 社区详情）共用本套逻辑，靠 refineCtx 区分元素 id 与状态访问器
  function openRefineBox() {
    const ctx = refineCtx;
    if (!ctx) return;
    const box = document.getElementById(ctx.boxId);
    const fb = document.getElementById(ctx.feedbackId) as HTMLInputElement;
    const steps = document.getElementById(ctx.stepsId);
    const live = document.getElementById(ctx.liveId);
    const result = document.getElementById(ctx.resultId);
    if (steps) { steps.style.display = "none"; steps.innerHTML = ""; }
    if (live) { live.style.display = "none"; live.textContent = ""; }
    if (result) { result.style.display = "none"; result.innerHTML = ""; }
    if (box) box.style.display = "block";
    if (fb) { fb.focus(); }
  }
  function closeRefineBox() {
    const ctx = refineCtx;
    if (!ctx) return;
    const box = document.getElementById(ctx.boxId);
    const fb = document.getElementById(ctx.feedbackId) as HTMLInputElement;
    if (box) box.style.display = "none";
    if (fb) fb.value = "";
  }

  async function handleRefine() {
    const ctx = refineCtx;
    if (!ctx) return;
    const fb = document.getElementById(ctx.feedbackId) as HTMLInputElement;
    const live = document.getElementById(ctx.liveId);
    const result = document.getElementById(ctx.resultId);
    const goBtn = document.getElementById(ctx.goId) as HTMLButtonElement;
    const cancelBtn = document.getElementById(ctx.cancelId) as HTMLButtonElement;
    const m = document.getElementById(ctx.msgId);
    const feedback = fb ? fb.value.trim() : "";
    if (!feedback) { if (m) m.textContent = "请先描述你希望改进的地方。"; return; }
    if (!ctx.getPrompt()) { if (m) m.textContent = "请先查看提示词再改写。"; return; }

    if (goBtn) { goBtn.disabled = true; goBtn.style.opacity = ".55"; }
    if (cancelBtn) { cancelBtn.disabled = true; }
    if (result) { result.style.display = "none"; result.innerHTML = ""; }
    if (live) { live.style.display = "none"; live.textContent = ""; }
    thinkLog = {}; activeStepKey = "";
    renderGenSteps("analyze", REFINE_STEPS, ctx.stepsId);
    if (m) m.textContent = "分析中，请稍候…";

    refineController = new AbortController();
    const onNode = (name) => {
      if (name === "result") { renderGenSteps("__done__", REFINE_STEPS, ctx.stepsId); return; }
      renderGenSteps(name, REFINE_STEPS, ctx.stepsId);
    };
    const onThink = (text) => appendThink(text, ctx.stepsId);
    const onToken = (chunk) => {
      if (chunk) {
        if (live) { live.style.display = "block"; live.textContent += chunk; }
      }
    };
    try {
      let res;
      try {
        res = await LLM.refinePrompt(ctx.getPrompt(), feedback, ctx.getTestMessages(), onToken, onNode, onThink, refineController.signal);
      } catch (e) {
        const em = (e && e.message) || "";
        if (/API 错误|401|Authentication|api ?key|invalid|key/i.test(em)) throw e;
        // 服务端 Agent 不可用 -> 浏览器直连兜底
        if (live) { live.style.display = "none"; live.textContent = ""; }
        res = await LLM.refinePromptDirect(ctx.getPrompt(), feedback, ctx.getTestMessages(), onToken, onNode, onThink, refineController.signal);
      }
      if (live) live.style.display = "none"; // 用干净的审阅视图取代实时草稿
      renderGenSteps("__done__", REFINE_STEPS, ctx.stepsId);
      showRefineResult(res.prompt);
      if (m) m.textContent = "✓ AI 已生成改写版提示词，请在下方审阅。";
    } catch (e) {
      if (refineController && refineController.signal.aborted) {
        if (m) m.textContent = "已停止改写。";
      } else {
        if (live) { live.style.display = "block"; live.textContent += "\n\n✗ 改写失败：" + e.message; }
        if (m) m.textContent = "改写失败：" + e.message;
      }
    } finally {
      if (goBtn) { goBtn.disabled = false; goBtn.style.opacity = "1"; }
      if (cancelBtn) cancelBtn.disabled = false;
      refineController = null;
    }
  }

  // 展示 AI 改写后的新版提示词，让用户对比审阅并选择采用 / 放弃
  function showRefineResult(newPrompt) {
    const ctx = refineCtx;
    if (!ctx) return;
    const box = document.getElementById(ctx.resultId);
    if (!box) return;
    box.style.display = "block";
    box.innerHTML = `
      <div class="ttl">✅ AI 已生成「改进版」提示词（下方为完整新版，审阅后决定是否替换）</div>
      <pre class="code-box" id="refine-new" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow:auto;">${esc(newPrompt)}</pre>
      <div class="flex gap-2 mt-3 flex-wrap items-center">
        <button id="refine-apply" class="btn btn-primary btn-sm">✓ 采用并替换</button>
        <button id="refine-discard" class="btn btn-ghost btn-sm">放弃本次改写</button>
        <span class="muted" style="font-size:.75rem;">采用后将替换当前测试提示词，并重置测试对话以便重新验证效果</span>
      </div>`;
    (document.getElementById("refine-apply") as HTMLButtonElement).addEventListener("click", () => applyRefine(newPrompt));
    (document.getElementById("refine-discard") as HTMLButtonElement).addEventListener("click", () => {
      box.style.display = "none"; box.innerHTML = "";
      const mm = document.getElementById(ctx.msgId);
      if (mm) { mm.textContent = "已放弃本次改写。"; setTimeout(() => { if (mm) mm.textContent = ""; }, 2000); }
    });
  }

  // 采用改写版：替换当前提示词 -> 更新测试提示词展示 -> 重置测试对话为分隔标记
  function applyRefine(newPrompt) {
    const ctx = refineCtx;
    if (!ctx) return;
    ctx.setPrompt(newPrompt);
    const tp = ctx.testPromptId ? document.getElementById(ctx.testPromptId) : null;
    if (tp) tp.textContent = newPrompt;
    // 同步刷新上方主"提示词正文"卡片，否则替换后顶部仍显示最初版本
    const live = document.getElementById(ctx.promptCardId);
    if (live) { live.textContent = newPrompt; live.style.display = "block"; }
    // 同步把主卡片标题标记为「改进版提示词」，让视觉上明确已切换
    const liveLabel = document.getElementById(ctx.promptLabelId);
    if (liveLabel) { liveLabel.textContent = "✨ 改进版提示词"; liveLabel.className = "live-label live-label-updated"; }
    ctx.setTestMessages([]);
    ctx.resetController();
    const log = document.getElementById(ctx.testLogId);
    if (log) log.innerHTML = '<div class="test-divider">—— 已切换为「改进版」提示词，下面用新问题重新验证效果 ——</div>';
    const usageEl = document.getElementById(ctx.usageId);
    if (usageEl) usageEl.textContent = "";
    const rb = document.getElementById(ctx.resultId);
    if (rb) { rb.style.display = "none"; rb.innerHTML = ""; }
    const steps = document.getElementById(ctx.stepsId);
    if (steps) { steps.style.display = "none"; steps.innerHTML = ""; }
    const rbox = document.getElementById(ctx.boxId);
    if (rbox) { rbox.style.display = "none"; const fb = document.getElementById(ctx.feedbackId) as HTMLInputElement; if (fb) fb.value = ""; }
    const m = document.getElementById(ctx.msgId);
    if (m) { m.textContent = "✓ 已采用改进版提示词，可重新测试。"; setTimeout(() => { if (m) m.textContent = ""; }, 2500); }
  }

  // 模板详情页的 refine 上下文（元素 id 与状态访问器）
  function templateRefineCtx() {
    return {
      getPrompt: () => current._lastPrompt,
      setPrompt: (p) => { current._lastPrompt = p; },
      getTestMessages: () => testMessages,
      setTestMessages: (m) => { testMessages = m; },
      resetController: () => { testController = null; },
      testLogId: "test-log",
      promptCardId: "use-live",
      promptLabelId: "use-live-label",
      testPromptId: "test-prompt",
      usageId: "use-run-usage",
      stepsId: "refine-steps",
      resultId: "refine-result",
      liveId: "refine-live",
      boxId: "refine-box",
      feedbackId: "refine-feedback",
      goId: "refine-go",
      cancelId: "refine-cancel",
      msgId: "msg",
    };
  }
  // 社区详情页的 refine 上下文
  function communityRefineCtx() {
    return {
      getPrompt: () => cCurrentPrompt,
      setPrompt: (p) => { cCurrentPrompt = p; },
      getTestMessages: () => cState.msgs,
      setTestMessages: (m) => { cState.msgs = m; },
      resetController: () => { cState.ctl = null; },
      testLogId: "cm-test-log",
      promptCardId: "cm-prompt-body",
      promptLabelId: "cm-prompt-label",
      testPromptId: null,
      usageId: "cm-test-usage",
      stepsId: "cm-refine-steps",
      resultId: "cm-refine-result",
      liveId: "cm-refine-live",
      boxId: "cm-refine-box",
      feedbackId: "cm-refine-feedback",
      goId: "cm-refine-go",
      cancelId: "cm-refine-cancel",
      msgId: "cm-msg",
    };
  }

  function copyUsePrompt() {
    const text = current._lastPrompt || "";
    if (!text) { const m = (document.getElementById("msg") as HTMLElement); if (m) m.textContent = "还没有生成提示词。"; return; }
    const m = (document.getElementById("msg") as HTMLElement);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => { m.textContent = "已复制提示词 ✓"; setTimeout(() => { if (m) m.textContent = ""; }, 2000); },
        () => { m.textContent = "复制失败，请手动选择文本复制。"; }
      );
    } else {
      m.textContent = "当前环境不支持自动复制，请手动选择。";
    }
  }

  function downloadUsePrompt(fmt) {
    const text = current._lastPrompt || "";
    if (!text) { const m = (document.getElementById("msg") as HTMLElement); if (m) m.textContent = "还没有生成提示词。"; return; }
    const mime = fmt === "md" ? "text/markdown" : "text/plain";
    const fname = (current.slug || "prompt") + (fmt === "md" ? ".md" : ".txt");
    const blob = new Blob([text], { type: mime + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const m = (document.getElementById("msg") as HTMLElement);
    if (m) { m.textContent = "已下载 " + fname + " ✓"; setTimeout(() => { if (m) m.textContent = ""; }, 2500); }
  }

  // 下载模板本身（可复用的"生成器"定义），便于收藏/分享/二次导入
  function downloadTemplate() {
    const def = {
      title: current.title, industry: current.industry, task: current.task,
      summary: current.summary || "", tags: current.tags || [],
      variables: current.variables || [], prompt: current.prompt
    };
    const blob = new Blob([JSON.stringify(def, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = (current.slug || "template") + ".template.json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const m = (document.getElementById("msg") as HTMLElement);
    if (m) { m.textContent = "已下载模板 JSON ✓"; setTimeout(() => { if (m) m.textContent = ""; }, 2500); }
  }

  function toggleSave() {
    const id = tplId(current);
    if (Store.hasMine(current.slug)) {
      Store.removeMine(current.slug);
      (document.getElementById("save-btn") as HTMLButtonElement).textContent = "☆ 收藏到我的模板";
      metricBump(id, "favorite", -1, current.title, current.industry);
    } else {
      Store.addMine(current);
      (document.getElementById("save-btn") as HTMLButtonElement).textContent = "★ 已收藏";
      metricBump(id, "favorite", 1, current.title, current.industry);
    }
  }

  // ---------- 导入模板（与下载形成闭环） ----------
  function openImportFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = () => { if (inp.files && inp.files[0]) importTemplate(inp.files[0]); };
    inp.click();
  }

  // 把任意已知格式归一化为模板定义：支持“模板定义 JSON”(含 prompt) 与 “成品 OpenAI JSON”(含 messages)
  function normalizeImport(d) {
    if (d && typeof d.prompt === "string") {
      return {
        title: d.title || "导入的模板",
        industry: d.industry || "其他",
        task: d.task || "自定义",
        summary: d.summary || "",
        tags: Array.isArray(d.tags) ? d.tags : [],
        variables: Array.isArray(d.variables) ? d.variables : [],
        prompt: d.prompt,
        slug: "", generated: false, imported: false
      };
    }
    if (d && Array.isArray(d.messages)) {
      const lastUser = d.messages.slice().reverse().find(m => m && m.role === "user");
      let content = "";
      if (lastUser) content = typeof lastUser.content === "string" ? lastUser.content : JSON.stringify(lastUser.content);
      return {
        title: d.title || "导入的提示词",
        industry: d.industry || "其他",
        task: "自定义",
        summary: "",
        tags: [],
        variables: [],
        prompt: content,
        slug: "", generated: false, imported: false
      };
    }
    return null;
  }

  function importTemplate(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        const obj = normalizeImport(data);
        if (!obj) { alert("无法识别的模板文件格式（需含 prompt 或 messages 字段）。"); return; }
        obj.slug = "import-" + Date.now();
        obj.generated = true;
        obj.imported = true;
        window.__draft = obj; // 走详情页渲染，可继续编辑 / 收藏
        Store.saveDraft(obj); // 持久化草稿，刷新后仍可找回
        location.hash = "#/t/" + obj.slug;
      } catch (e) {
        alert("解析失败：" + e.message);
      }
    };
    reader.onerror = () => alert("读取文件失败");
    reader.readAsText(file);
  }

  // ---------- 我的模板（按分类分组） ----------
  function myTemplates() {
    // 合并“我的模板”与“AI 草稿”（去重，我的模板优先），刷新后草稿也能在此找到
    const mine = Store.getMine();
    const drafts = Store.getDrafts().filter(d => !mine.some(m => m.slug === d.slug));
    const all = mine.concat(drafts);
    app().innerHTML = `
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
    app().querySelectorAll(".del-btn").forEach((b) => b.addEventListener("click", (e) => {
      e.preventDefault();
      const slug = b.getAttribute("data-slug");
      if (!confirm("确定删除该模板？删除后将从「我的模板」移除（热度榜统计不受影响）。")) return;
      if (Store.hasMine(slug)) Store.removeMine(slug);
      else Store.removeDraft(slug);
      myTemplates();
    }));
    app().querySelectorAll(".pub-btn").forEach((b) => b.addEventListener("click", (e) => {
      e.preventDefault();
      const slug = b.getAttribute("data-slug");
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
  function mineCard(t) {
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

  function groupedMineHtml(mine) {
    const groups = {};
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

  // ---------- 热度榜（M9） ----------
  async function board() {
    app().innerHTML = `
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
      currentSort = b.getAttribute("data-sort");
      renderBoard(currentSort);
    }));
    renderBoard(currentSort || "heat");
  }

  async function renderBoard(sort) {
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
      wrap.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>';
    }
  }

  // 首页“热门模板 Top5”
  async function loadHotStrip() {
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

  // ---------- 设置 ----------
  function settings() {
    const s = Store.getSettings();
    const provOpts = Object.keys(LLM.PROVIDERS).map(k =>
      `<option value="${k}">${LLM.PROVIDERS[k].label}</option>`
    ).join("");
    app().innerHTML = `
      <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
      <h1 class="section-title" style="font-size:1.7rem;margin-top:10px;">设置</h1>
      <div class="card card-pad" style="max-width:560px;margin-top:12px;">
        <div class="ttl">👤 登录 / 注册</div>
        <p class="text-xs muted mb-3">社区写操作（发布 / 评分 / 收藏 / 举报）需先登录；公开 / 下架 / 审核台仅管理员可用。当前状态：<b id="auth-state">${LLM.authIsAuthed() ? "已登录" : "未登录"}</b></p>
        <div class="flex gap-2">
          <button id="auth-login-btn" class="btn btn-primary btn-sm">${LLM.authIsAuthed() ? "切换账号" : "登录 / 注册"}</button>
          <button id="auth-logout-btn" class="btn btn-ghost btn-sm" style="${LLM.authIsAuthed() ? "" : "display:none;"}">退出登录</button>
        </div>
        <p class="text-xs muted mt-2">普通用户开放注册；管理员用服务端 <code style="background:#f1f5f9;padding:1px 5px;border-radius:5px;">.env</code> 的 APP_ADMIN_PASSPHRASE 口令登录（口令匹配也视为管理员）。账号仅用于社区身份与权限，模型 Key 仍保存在本机浏览器。</p>
      </div>
      <div class="card card-pad" style="max-width:560px;margin-top:16px;">
        <label class="block text-sm font-medium mb-1" style="color:var(--slate)">模型服务商</label>
        <select id="set-provider" class="select" style="margin-bottom:16px;">${provOpts}</select>

        <label class="block text-sm font-medium mb-1" style="color:var(--slate)">具体模型</label>
        <select id="set-model" class="select" style="margin-bottom:8px;"></select>
        <input id="set-custom" class="input" style="margin-bottom:4px;" placeholder="或自定义模型名（留空则用上方所选）" value="${esc(s.customModel || "")}">
        <p class="text-xs muted mb-4">选服务商会列出常用模型；也可去服务商控制台复制任意模型 ID 填到“自定义模型名”，完全自由。</p>

        <div id="secret-wrap" class="mb-4" style="display:none">
          <label class="block text-sm font-medium mb-1" style="color:var(--slate)">API Secret <span class="muted font-normal">（该服务商需要）</span></label>
          <input id="set-secret" type="password" class="input" placeholder="如百度文心需 secret" value="${esc(s.secret || "")}">
        </div>

        <label class="block text-sm font-medium mb-1" style="color:var(--slate)">API Key <span class="muted font-normal">（仅保存在本地浏览器）</span></label>
        <input id="set-key" type="password" class="input" style="margin-bottom:4px;" placeholder="sk-..." value="${esc(s.key || "")}">
        <p class="text-xs muted mb-4">Key 只存你本机 localStorage，不上传任何服务器。F1 / F2 由前端直连对应服务商（开启下方代理后改走代理）。</p>

        <hr class="divider" style="margin:16px 0;">
        <label class="flex items-center gap-2 mb-2 cursor-pointer">
          <input id="set-proxy" type="checkbox" class="w-4 h-4" ${s.useProxy ? "checked" : ""}>
          <span class="text-sm font-medium" style="color:var(--slate)">通过代理服务器调用（避免跨域 / 隐藏 Key）</span>
        </label>
        <input id="set-proxy-base" class="input" style="margin-bottom:4px;" placeholder="代理地址，如 http://localhost:8000" value="${esc(s.proxyBase || "")}">
        <p class="text-xs muted mb-4">开启后，所有 LLM 请求改走该代理的 <code style="background:#f1f5f9;padding:1px 5px;border-radius:5px;">/relay</code> 端点。同源代理可彻底避开浏览器跨域；Key 由代理转发，不暴露给前端直连。</p>

        <button id="set-save" class="btn btn-primary">保存</button>
        <span id="set-msg" class="text-xs" style="color:#16a34a;margin-left:12px;"></span>
        <p class="text-xs" style="color:var(--slate);margin-top:12px;">当前生效：<span id="eff" style="font-weight:600;">${esc(LLM.effectiveLabel())}</span></p>

        <hr class="divider" style="margin:16px 0;">
        <button id="set-test" class="btn btn-dark">测试连接</button>
        <span id="test-msg" class="text-xs" style="margin-left:12px;"></span>
        <p class="text-xs muted mt-2">填完 Key（和 Secret）后点一下，验证配置是否可用、实际调用的是哪个模型。无需先保存。</p>
      </div>
      <p class="text-xs muted mt-4">提示：部分国内模型需网络可直连；若不行，可开启上方代理模式。</p>
    `;
    const providerSel = (document.getElementById("set-provider") as HTMLSelectElement);
    function populateModels(p) {
      const prov = LLM.PROVIDERS[p];
      const sel = (document.getElementById("set-model") as HTMLSelectElement);
      sel.innerHTML = (prov.models || []).map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
      if (s.model && (prov.models || []).indexOf(s.model) !== -1) sel.value = s.model;
      const wrap = (document.getElementById("secret-wrap") as HTMLElement);
      if (prov.needSecret) wrap.style.display = "block"; else wrap.style.display = "none";
      const note = prov.note ? `<p class="text-xs text-slate-400 mt-1">${esc(prov.note)}</p>` : "";
      wrap.insertAdjacentHTML("afterend", note);
    }
    providerSel.value = (s.provider && LLM.PROVIDERS[s.provider]) ? s.provider : "openai";
    populateModels(providerSel.value);
    providerSel.addEventListener("change", e => {
      document.querySelectorAll("#secret-wrap ~ p.text-xs").forEach(n => n.remove());
      populateModels((e.target as HTMLInputElement).value);
    });
    (document.getElementById("set-save") as HTMLButtonElement).addEventListener("click", () => {
      const provider = providerSel.value;
      const model = (document.getElementById("set-model") as HTMLSelectElement).value;
      const customModel = (document.getElementById("set-custom") as HTMLInputElement).value.trim();
      const key = (document.getElementById("set-key") as HTMLInputElement).value.trim();
      const secret = (document.getElementById("set-secret") as HTMLInputElement) ? (document.getElementById("set-secret") as HTMLInputElement).value.trim() : "";
      const useProxy = (document.getElementById("set-proxy") as HTMLInputElement).checked;
      const proxyBase = (document.getElementById("set-proxy-base") as HTMLInputElement).value.trim();
      Store.saveSettings({ provider, model, customModel, key, secret, useProxy, proxyBase });
      (document.getElementById("set-msg") as HTMLElement).textContent = "已保存 ✓";
      (document.getElementById("eff") as HTMLElement).textContent = LLM.effectiveLabel();
    });

    // 登录/注册状态显示 + 切换账号 / 退出
    const authState = (document.getElementById("auth-state") as HTMLElement);
    const authLoginBtn = (document.getElementById("auth-login-btn") as HTMLButtonElement);
    const authLogoutBtn = (document.getElementById("auth-logout-btn") as HTMLButtonElement);
    const refreshAuthUI = () => {
      const on = LLM.authIsAuthed();
      const admin = LLM.isAdmin();
      const who = window.Auth.username || "用户";
      if (authState) authState.textContent = on ? (admin ? `已登录（管理员 ${who}）` : `已登录（${who}）`) : "未登录";
      if (authLoginBtn) authLoginBtn.textContent = on ? "切换账号" : "登录 / 注册";
      if (authLogoutBtn) authLogoutBtn.style.display = on ? "" : "none";
    };
    refreshAuthUI();
    if (authLoginBtn) authLoginBtn.addEventListener("click", async () => {
      const tok = await window.Auth.ensure();
      if (tok) refreshAuthUI();
    });
    if (authLogoutBtn) authLogoutBtn.addEventListener("click", () => {
      LLM.authLogout();
      refreshAuthUI();
      toast("已退出登录");
    });

    // 读取当前表单值为覆盖参数，供测试连接使用（无需先保存）
    function readForm() {
      const prov = providerSel.value;
      const secretEl = (document.getElementById("set-secret") as HTMLInputElement);
      return {
        provider: prov,
        model: (document.getElementById("set-model") as HTMLSelectElement).value,
        customModel: (document.getElementById("set-custom") as HTMLInputElement).value.trim(),
        key: (document.getElementById("set-key") as HTMLInputElement).value.trim(),
        secret: secretEl ? secretEl.value.trim() : ""
      };
    }

    (document.getElementById("set-test") as HTMLButtonElement).addEventListener("click", async () => {
      const btn = (document.getElementById("set-test") as HTMLButtonElement);
      const msg = (document.getElementById("test-msg") as HTMLElement);
      const over = readForm();
      btn.disabled = true;
      btn.textContent = "测试中…";
      msg.className = "text-xs ml-3 text-slate-400";
      msg.textContent = "正在连接 " + LLM.labelOf(over) + " …";
      try {
        const r = await LLM.testConnection(over);
        if (r.ok) {
          msg.className = "text-xs ml-3 text-green-600";
          msg.textContent = "✓ 连接成功 · 调用：" + r.label + (r.reply ? " · 模型回复：" + r.reply : "");
        } else {
          msg.className = "text-xs ml-3 text-red-600";
          msg.textContent = "✗ " + r.error;
        }
      } catch (e) {
        msg.className = "text-xs ml-3 text-red-600";
        msg.textContent = "✗ " + (e.message || e);
      } finally {
        btn.disabled = false;
        btn.textContent = "测试连接";
      }
    });
  }

  // ---------- 社区分享（M18） ----------
  // 发布弹窗：从详情页 / 我的模板复用。prefill: {title, industry, tags, prompt, note, author}
  function openPublishForm(prefill) {
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
      const industry = (document.getElementById("pf-industry") as HTMLSelectElement).value;
      submitBtn.disabled = true; submitBtn.style.opacity = ".55";
      (document.getElementById("pf-msg") as HTMLElement).textContent = "发布中…";
      try {
        const pubRes = await LLM.communityPublish({ id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), title, industry, author, tags, note, prompt });
        close();
        toast("✓ 已发布到草稿「" + title + "」，去社区广场-我的发布里点「公开」即可上架");
        // 发布去重（C3）：后端附带的相似模板提示，不打断流程
        if (pubRes && pubRes.similar && pubRes.similar.length) {
          setTimeout(() => toast("⚠ 社区已有相似模板：" + pubRes.similar.map((s: any) => s.title).join("、")), 800);
        }
      } catch (e) {
        (document.getElementById("pf-msg") as HTMLElement).textContent = "发布失败：" + e.message;
        submitBtn.disabled = false; submitBtn.style.opacity = "1";
      }
    });
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2800);
  }

  // 通用二次确认弹窗（替代浏览器原生 confirm，风格统一）
  function confirmDialog(title, message, onConfirm) {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `
      <div class="modal-card card" style="max-width:380px;">
        <div class="ttl">${esc(title)}</div>
        <p class="slate" style="margin-top:10px;line-height:1.6;font-size:.9rem;">${esc(message)}</p>
        <div class="flex gap-2 mt-4 flex-wrap items-center">
          <button id="cd-yes" class="btn btn-danger btn-sm">删除</button>
          <button id="cd-no" class="btn btn-ghost btn-sm">取消</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    const yes = (document.getElementById("cd-yes") as HTMLButtonElement);
    const no = (document.getElementById("cd-no") as HTMLButtonElement);
    if (no) no.addEventListener("click", close);
    if (yes) yes.addEventListener("click", async () => {
      yes.disabled = true; yes.style.opacity = ".55";
      try { await onConfirm(); } finally { close(); }
    });
  }

  // 举报弹窗（社区广场已公开内容）
  function reportDialog(id, title) {
    if (!LLM.authIsAuthed()) {
      toast("举报需先登录");
      window.Auth.ensure().then((t) => { if (t) reportDialog(id, title); });
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
        toast("举报失败：" + (e2 && e2.message ? e2.message : e2));
        yes.disabled = false; yes.style.opacity = "1";
      }
    });
  }

  async function community() {
    setMeta("社区广场 · 模法师 Promptly", "浏览社区成员分享的 AI 提示词模板，克隆、测试、评分、评论。");
    app().innerHTML = `
      <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
      <h1 class="section-title" style="font-size:1.7rem;margin-top:8px;">社区广场</h1>
      <div class="flex items-center gap-2 mt-3 flex-wrap">
        <button class="btn btn-ghost btn-sm tab-btn active" data-tab="square">🏠 社区广场</button>
        <button class="btn btn-ghost btn-sm tab-btn" data-tab="mine">📂 我的发布</button>
        ${LLM.isAdmin() ? '<button class="btn btn-ghost btn-sm tab-btn" data-tab="mod">🛡 审核台</button>' : ""}
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
        </select>
      </div>
      <div id="cm-wrap" class="mt-4">加载中…</div>
    `;
    let tab = "square";
    const qEl = (document.getElementById("cm-q") as HTMLInputElement);
    const sortEl = (document.getElementById("cm-sort") as HTMLSelectElement);
    const industryEl = (document.getElementById("cm-industry") as HTMLSelectElement);
    async function load() {
      const wrap = (document.getElementById("cm-wrap") as HTMLElement);
      if (!wrap) return;
      if (tab === "mod") { await moderationConsole(load); return; }
      wrap.innerHTML = "加载中…";
      try {
        let rows;
        if (tab === "mine") rows = await LLM.communityMine();
        else rows = await LLM.communityList({ status: "published", sort: sortEl.value, q: qEl.value.trim(), industry: (industryEl && industryEl.value !== "全部") ? industryEl.value : "" });
        if (!rows.length) {
          wrap.innerHTML = tab === "mine"
            ? '<p class="muted">你还没有发布任何提示词。在模板详情页或「我的模板」点「发布到社区」即可创建草稿。</p>'
            : '<p class="muted">社区广场还空空如也，去发布第一条吧！</p>';
          return;
        }
        wrap.innerHTML = rows.map(r => communityCard(r, tab)).join("");
        wrap.querySelectorAll(".cm-card").forEach(c => c.addEventListener("click", () => { location.hash = "#/c/" + encodeURIComponent(c.getAttribute("data-id")); }));
        if (tab === "mine") {
          wrap.querySelectorAll(".cm-publish").forEach(b => b.addEventListener("click", async (e) => {
            e.stopPropagation();
            await LLM.communityPublishNow(b.getAttribute("data-id"));
            toast("✓ 已公开到社区广场");
            load();
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
              await LLM.communityDelete(id);
              load();
            });
          }));
        }
        wrap.querySelectorAll(".cm-report").forEach(b => b.addEventListener("click", (e) => {
          e.stopPropagation();
          reportDialog(b.getAttribute("data-id"), b.getAttribute("data-title"));
        }));
      } catch (e) {
        wrap.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>';
      }
    }
    document.querySelectorAll("#app .tab-btn").forEach(b => b.addEventListener("click", () => {
      tab = b.getAttribute("data-tab");
      document.querySelectorAll("#app .tab-btn").forEach(x => x.classList.toggle("active", x === b));
      load();
    }));
    const searchBtn = (document.getElementById("cm-search") as HTMLButtonElement);
    if (searchBtn) searchBtn.addEventListener("click", load);
    if (qEl) qEl.addEventListener("keydown", e => { if (e.key === "Enter") load(); });
    if (sortEl) sortEl.addEventListener("change", load);
    if (industryEl) industryEl.addEventListener("change", load);
    load();
  }

  async function moderationConsole(reload) {
    const wrap = (document.getElementById("cm-wrap") as HTMLElement);
    if (!wrap) return;
    wrap.innerHTML = "加载中…";
    if (!LLM.isAdmin()) {
      wrap.innerHTML = '<p class="muted">审核台仅管理员可见，请先在「设置」中用管理员口令登录。</p>';
      return;
    }
    let data;
    try { data = await LLM.communityModeration(); }
    catch (e) { wrap.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>'; return; }
    const drafts = data.drafts || [];
    const reports = data.reports || [];
    const log = data.log || [];
    const draftHtml = drafts.length
      ? drafts.map(r => communityCard(r, "mine")).join("")
      : '<p class="muted">暂无待公开的草稿。</p>';
    const reportHtml = reports.length
      ? reports.map(rp => `
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
      ? log.map(l => {
          const aMap = { publish_draft: "提交草稿", publish_public: "公开", publish_blocked: "审核拦截", takedown: "管理员下架" };
          const a = aMap[l.action] || l.action;
          const tag = l.safe
            ? '<span class="pill" style="background:#dcfce7;color:#15803d;">通过</span>'
            : '<span class="pill" style="background:#fee2e2;color:#b91c1c;">拦截/下架</span>';
          const eng = l.engine ? `<span class="muted" style="font-size:.72rem;"> · ${esc(l.engine)}</span>` : "";
          const rs = (l.reasons && l.reasons.length) ? `<div class="muted" style="font-size:.74rem;margin-top:3px;">${l.reasons.map(x => esc(x)).join("；")}</div>` : "";
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
      await LLM.communityPublishNow(b.getAttribute("data-id"));
      toast("✓ 已公开到社区广场");
      reload();
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

  // 基础 SEO（C4）：动态设置 document.title + meta description + og 标签
  function setMeta(title: string, desc?: string) {
    document.title = title;
    if (!desc) return;
    const ensureMeta = (attr: string, name: string, val: string) => {
      let el = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!el) { el = document.createElement("meta"); el.setAttribute(attr, name); document.head.appendChild(el); }
      el.setAttribute("content", val);
    };
    ensureMeta("name", "description", desc);
    ensureMeta("property", "og:title", title);
    ensureMeta("property", "og:description", desc);
    ensureMeta("property", "og:type", "website");
  }
  function communityCard(r, tab) {
    const tagHtml = (r.tags || []).map(t => `<span class="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded mr-1">#${esc(t)}</span>`).join("");
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
               <button class="btn btn-ghost btn-sm cm-report" data-id="${esc(r.id)}" data-title="${esc(r.title)}">⚠ 举报</button>
               <span class="muted" style="font-size:.72rem;">已公开</span>
             </div>`
          : "");
    return `<div class="card tpl-card cm-card" data-id="${esc(r.id)}" style="margin-top:12px;cursor:pointer;">
      <div class="flex items-center justify-between">
        <span class="pill pill-violet">${esc(r.industry)}</span>
        <span class="text-xs muted">${r.authorId ? `<a href="#/u/${esc(r.authorId)}" class="author-link">${esc(r.author)}</a>` : esc(r.author)} · ★ ${r.avgRating ? r.avgRating.toFixed(1) : "—"}${r.ratingCount ? " (" + r.ratingCount + ")" : ""}</span>
      </div>
      <h3 style="margin-top:6px;">${esc(r.title)}</h3>
      <div class="mt-1">${tagHtml}</div>
      <div class="muted" style="font-size:.75rem;margin-top:6px;">🔥 ${r.uses} 次使用 · ⭐ ${r.favorites} 收藏${r.note ? " · " + esc(r.note) : ""}</div>
      ${actions}
    </div>`;
  }

  async function communityDetail(id) {
    app().innerHTML = `<a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a><div class="mt-3 muted">加载中…</div>`;
    let row;
    try { row = await LLM.communityDetail(id); }
    catch (e) {
      app().innerHTML = `<a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a><p class="mt-3">加载失败：${esc(e.message)}</p>`;
      return;
    }
    const tagHtml = (row.tags || []).map(t => `<span class="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded mr-1">#${esc(t)}</span>`).join("");
    app().innerHTML = `
      <a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a>
      <div class="mt-3">
        <h1 class="section-title" style="font-size:1.6rem;">${esc(row.title)}</h1>
        <div class="muted" style="font-size:.85rem;margin-top:6px;"><span class="pill pill-violet">${esc(row.industry)}</span> · 作者 ${row.authorId ? `<a href="#/u/${esc(row.authorId)}" class="author-link">${esc(row.author)}</a>` : esc(row.author)} · ${row.status === "draft" ? "草稿" : "已公开"}</div>
      </div>
      <div class="mt-2">${tagHtml}</div>
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
        <button id="cm-clone" class="btn btn-primary btn-sm">📥 克隆到我的模板</button>
        <button id="cm-fav" class="btn btn-ghost btn-sm">⭐ 收藏</button>
        <button id="cm-test-open" class="btn btn-ghost btn-sm">🧪 测试这个提示词</button>
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
        box.innerHTML = '<p class="muted" style="font-size:.78rem;">评论加载失败：' + esc(e.message) + '</p>';
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
    if (cloneBtn) cloneBtn.addEventListener("click", () => {
      const tpl = {
        slug: "mine-" + Date.now().toString(36),
        title: row.title,
        industry: row.industry,
        task: "社区克隆",
        summary: row.note || "从社区克隆的提示词",
        tags: row.tags || [],
        prompt: cCurrentPrompt,
        variables: [],
        mine: true,
        generated: true,
      };
      Store.addMine(tpl);
      toast("✓ 已克隆到「我的模板」");
      location.hash = "#/my";
    });
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
    cState = { msgs: [], ctl: null };
    cCurrentPrompt = row.prompt;
    refineCtx = communityRefineCtx();
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
    if (sendBtn) sendBtn.addEventListener("click", () => cSend(cState));
    const clearBtn = (document.getElementById("cm-test-clear") as HTMLButtonElement);
    if (clearBtn) clearBtn.addEventListener("click", () => cClear(cState));
    const input = (document.getElementById("cm-test-input") as HTMLTextAreaElement);
    if (input) input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); cSend(cState); } });
    // F5 改写（社区版）：与模板详情页共用同一套 refine 逻辑，靠 refineCtx 区分
    const cRefineOpen = (document.getElementById("cm-refine-open") as HTMLButtonElement);
    if (cRefineOpen) cRefineOpen.addEventListener("click", openRefineBox);
    const cRefineGo = (document.getElementById("cm-refine-go") as HTMLButtonElement);
    if (cRefineGo) cRefineGo.addEventListener("click", handleRefine);
    const cRefineCancel = (document.getElementById("cm-refine-cancel") as HTMLButtonElement);
    if (cRefineCancel) cRefineCancel.addEventListener("click", closeRefineBox);
  }

  async function authorPage(authorId) {
    app().innerHTML = `<a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a><div class="mt-3 muted">加载中…</div>`;
    let data;
    try { data = await LLM.communityAuthor(authorId); }
    catch (e) {
      app().innerHTML = `<a href="#/community" class="back-link" onclick="goBack();return false;">← 返回社区</a><p class="mt-3">加载失败：${esc(e.message)}</p>`;
      return;
    }
    const items = data.items || [];
    setMeta("👤 " + data.author + " · 模法师 Promptly", (data.author || "作者") + " 发布了 " + items.length + " 个提示词模板");
    app().innerHTML = `
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
  function appendTestBubbleTo(log, text, role) {
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
  function cSend(state) {
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
    const onToken = (chunk) => { if (chunk) { full += chunk; aText.textContent = full; log.scrollTop = log.scrollHeight; } };
    (async () => {
      try {
        const res = await LLM.chatWithPrompt(cCurrentPrompt, state.msgs, onToken, state.ctl.signal);
        full = res.text || full;
        aText.textContent = full;
        state.msgs.push({ role: "assistant", content: full });
        if (res.usage && usageEl) usageEl.textContent = "📊 " + fmtUsage(res.usage, res.elapsedMs);
        if (m) m.textContent = "✓ 已回复（可继续追问）。";
      } catch (e) {
        aText.textContent = (full ? full + "\n\n" : "") + "✗ 测试失败：" + e.message;
        if (m) m.textContent = "测试失败：" + e.message;
      } finally {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = "1"; }
        state.ctl = null;
        if (input) input.focus();
      }
    })();
  }
  function cClear(state) {
    state.msgs = [];
    const log = (document.getElementById("cm-test-log") as HTMLElement);
    if (log) log.innerHTML = '<div class="test-empty muted">对话已清空 —— 重新输入问题开始测试。</div>';
    const usageEl = (document.getElementById("cm-test-usage") as HTMLElement);
    if (usageEl) usageEl.textContent = "";
  }
  function highlightStarsC(id) {
    const stars = (document.getElementById("cm-rate-stars") as HTMLElement);
    if (!stars) return;
    const my = Store.getRating(id) || 0;
    stars.querySelectorAll(".star").forEach(s => s.classList.toggle("on", Number(s.getAttribute("data-n")) <= my));
  }
  function cLoadRate(row) {
    const info = (document.getElementById("cm-rate-info") as HTMLElement);
    if (!info) return;
    highlightStarsC(row.id);
    const my = Store.getRating(row.id);
    info.textContent = `当前均分 ${row.avgRating} 星 · ${row.ratingCount || 0} 人评分` + (my ? ` · 你给了 ${my} 星` : "");
  }
  function cRate(row, score) {
    const prev = Store.getRating(row.id);
    LLM.communityRate(row.id, score, prev).then(r => {
      Store.setRating(row.id, score);
      const info = (document.getElementById("cm-rate-info") as HTMLElement);
      if (info) info.textContent = `当前均分 ${r.avgRating} 星 · ${r.ratingCount || 0} 人评分 · 你给了 ${score} 星`;
      highlightStarsC(row.id);
      const m = (document.getElementById("cm-msg") as HTMLElement);
      if (m) { m.textContent = "已评分 " + score + " 星 ✓"; setTimeout(() => { if (m) m.textContent = ""; }, 2000); }
    }).catch(e => { const m = (document.getElementById("cm-msg") as HTMLElement); if (m) m.textContent = "评分失败：" + e.message; });
  }

  // ---------- 本地可观测（M18） ----------
  async function traces() {
    app().innerHTML = `
      <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
      <h1 class="section-title" style="font-size:1.7rem;margin-top:8px;">🔍 可观测 / 调试</h1>
      <p class="muted" style="font-size:.82rem;margin-top:6px;">每次生成 / 改写调用都会在本地落盘（与 LangSmith 云端互不冲突）。这里直接看到延迟、Token、各步骤与错误——这就是你之前加的 LangSmith 在应用内的体现。</p>
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
        const typeFilter = (document.getElementById("tr-type") as HTMLSelectElement).value;
        const traces = (data.traces || []).filter(t => !typeFilter || t.type === typeFilter);
        const total = traces.length;
        const errs = traces.filter(t => t.status === "error").length;
        const avgLat = total ? Math.round(traces.reduce((s, t) => s + (t.latencyMs || 0), 0) / total) : 0;
        const tok = traces.reduce((s, t) => s + (t.totalTokens || 0), 0);
        const sum = (document.getElementById("tr-summary") as HTMLElement);
        if (sum) sum.innerHTML = [["总调用", total], ["错误", errs], ["平均延迟", (avgLat / 1000).toFixed(1) + "s"], ["累计 Token", tok]]
          .map((kv) => `<div class="pill" style="background:#f1f5f9;color:var(--slate);">${kv[0]}：<b>${kv[1]}</b></div>`).join("");
        if (!traces.length) { wrap.innerHTML = '<p class="muted">还没有任何调用记录。去生成或测试一条提示词，这里就会出现 trace。</p>'; return; }
        wrap.innerHTML = traces.map(trCard).join("");
        wrap.querySelectorAll(".tr-expand").forEach(b => b.addEventListener("click", () => {
          const box = document.getElementById("tr-steps-" + b.getAttribute("data-id"));
          if (box) box.style.display = box.style.display === "none" ? "block" : "none";
        }));
      } catch (e) {
        wrap.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>';
      }
    }
    const refresh = (document.getElementById("tr-refresh") as HTMLButtonElement);
    if (refresh) refresh.addEventListener("click", load);
    const typeSel = (document.getElementById("tr-type") as HTMLSelectElement);
    if (typeSel) typeSel.addEventListener("change", load);
    load();
  }
  function trCard(t) {
    const time = new Date(t.createdAt).toLocaleString("zh-CN", { hour12: false });
    const steps = (t.steps || []).map(s => `<span class="tag" style="background:#fff;border:1px solid var(--brand-100);">${esc(s)}</span>`).join(" ");
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

  // ---------- 路由 ----------
  function route() {
    const h = location.hash || "#/";
    // 维护路由栈：首次加载压栈；与栈顶相同忽略；与栈顶下一层相同视为“返回”弹栈；否则前进压栈
    if (currentHash === null) {
      routeStack = [h];
      currentHash = h;
    } else if (h !== currentHash) {
      if (routeStack.length >= 2 && h === routeStack[routeStack.length - 2]) routeStack.pop();
      else routeStack.push(h);
      currentHash = h;
    }
    if (h === "#" || h === "" ) return home();
    const parts = h.replace(/^#\//, "").split("/");
    if (parts[0] === "i") return industry(decodeURIComponent(parts[1] || ""));
    if (parts[0] === "t") return detail(decodeURIComponent(parts[1] || ""));
    if (parts[0] === "my") return myTemplates();
    if (parts[0] === "board") return board();
    if (parts[0] === "settings") return settings();
    if (parts[0] === "community") return community();
    if (parts[0] === "c") return communityDetail(decodeURIComponent(parts[1] || ""));
    if (parts[0] === "u") return authorPage(decodeURIComponent(parts[1] || ""));
    if (parts[0] === "traces") return traces();
    return home();
  }

  window.addEventListener("hashchange", route);
  const navImport = (document.getElementById("nav-import") as HTMLElement);
  if (navImport) navImport.addEventListener("click", openImportFile);
  route();
})();
