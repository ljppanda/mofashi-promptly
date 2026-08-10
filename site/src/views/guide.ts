// views/guide.ts — 「提示词工程入门」落地页（Component 模式）。
// 竞品监控报告 r10 #3（对标 LearnPrompting）：降低首访门槛，科普「变量化模板 + 七段生产级结构」，
// 让新用户理解本站与「静态提示词库」的本质差异。纯前端、零 schema、复用 esc。
import { esc, toast } from "../core/ui.js";

export function guidePage(): void {
  const root = document.getElementById("app") as HTMLElement | null;
  if (!root) return;

  root.innerHTML = `
    <section class="section" style="padding-top:26px;max-width:920px;margin:0 auto;">
      <a href="#/" class="back-link">‹ 返回首页</a>
      <h1 class="section-title" style="margin-top:10px;">📖 提示词工程入门</h1>
      <p class="section-sub">5 分钟看懂：为什么「带变量的模板」比「一段写死的提示词」更好用，以及一条生产级提示词应该长什么样。</p>

      <!-- 一句话差异 -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:18px;margin:18px 0;line-height:1.8;">
        <b>核心理念</b>：本站把提示词拆成两层 —— <b>模板（骨架）</b> 是带 <code>{{占位符}}</code> 的可复用结构，<b>成品</b> 是填完变量、交给模型的指令。
        同一条模板，填不同变量就能服务不同任务；而写死的提示词用完即弃。
      </div>

      <!-- 一、变量化 -->
      <h2 class="section-title" style="font-size:1.2rem;margin-top:26px;">① 变量化：把「一次性的话」变成「可复用的工具」</h2>
      <p class="section-sub" style="text-align:left;">模板里用 <code>{{双大括号}}</code> 标出每次都会变的部分，生成时再填空。例：</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0;">
        <div style="border:1px solid #fecaca;background:#fff5f5;border-radius:12px;padding:14px;">
          <div class="muted" style="font-size:.78rem;margin-bottom:8px;">✗ 写死的提示词（用完即弃）</div>
          <pre class="code-box" style="white-space:pre-wrap;font-size:.8rem;">帮我给张三写一封催款邮件，他欠 5000 元，周五前还。</pre>
        </div>
        <div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:12px;padding:14px;">
          <div class="muted" style="font-size:.78rem;margin-bottom:8px;">✓ 变量化模板（填完即用）</div>
          <pre class="code-box" style="white-space:pre-wrap;font-size:.8rem;">帮我给 {{客户名}} 写一封催款邮件，他欠 {{金额}} 元，请于 {{截止日}} 前归还。</pre>
        </div>
      </div>
      <p class="muted" style="font-size:.82rem;">好处：改个名字就能复用；可放进「我的模板」反复调用；可发布到社区让别人填自己的变量 —— 这就是 F1 生成器产出的东西。</p>

      <!-- 二、七段生产级结构 -->
      <h2 class="section-title" style="font-size:1.2rem;margin-top:30px;">② 生产级提示词：七段结构</h2>
      <p class="section-sub" style="text-align:left;">本站 F1/F2 产出的模板，强制遵循七段结构（F2 首稿后还会对照它自审一遍）。一段都不少，才叫「生产级」：</p>
      <ol style="line-height:1.9;padding-left:22px;margin:14px 0;font-size:.92rem;">
        ${SEVEN.map((s, i) => `<li><b>${esc(s.t)}</b>：<span class="muted">${esc(s.d)}</span></li>`).join("")}
      </ol>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:10px 0;">
        <div class="muted" style="font-size:.78rem;margin-bottom:8px;">示例：一条生产级模板的骨架（节选）</div>
        <pre class="code-box" style="white-space:pre-wrap;font-size:.78rem;"># 角色
你是一名资深 {{行业}} 顾问。
# 背景与目标
用户需要 {{目标}}。
# 约束与护栏
- 只输出 {{语言}}，不解释过程
- 不得编造 {{约束项}}
# 工作流
1. 澄清 {{关键变量}}
2. 给出 {{交付物}}
# 输出规范
以 Markdown 表格输出，列：{{列定义}}
# 边界与兜底
若信息不足，先向用户追问，不要臆测。
# 自检
交付前确认以上每段均已满足。</pre>
      </div>

      <!-- 三、三步上手 -->
      <h2 class="section-title" style="font-size:1.2rem;margin-top:30px;">③ 三步上手</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:14px 0;">
        ${STEPS.map((s) => `
          <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#fff;">
            <div style="font-size:1.6rem;">${s.ico}</div>
            <h4 style="margin:8px 0 4px;color:#0f172a;">${esc(s.t)}</h4>
            <p class="muted" style="font-size:.82rem;line-height:1.6;">${esc(s.d)}</p>
          </div>`).join("")}
      </div>

      <!-- 行动 -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:22px 0 8px;">
        <a href="#/" class="btn btn-primary">⚡ 去生成我的第一条模板</a>
        <a href="#/community" class="btn btn-ghost">🏘 逛社区模板</a>
        <a href="#/models" class="btn btn-ghost">🧩 看支持的模型</a>
      </div>
      <p class="muted" style="font-size:.8rem;margin-top:10px;">提示：生成成品提示词后，可用「🚀 试跑」本地跑示例、「🔧 一键优化」让 AI 当评委打分改写、「🍴 派生」改成你自己的版本。</p>
    </section>
  `;
}

const SEVEN: { t: string; d: string }[] = [
  { t: "角色", d: "明确 AI 扮演谁（资深顾问 / 编辑 / 工程师），定调专业度与口吻" },
  { t: "背景与目标", d: "交代来龙去脉与要达成的结果，避免 AI 瞎猜" },
  { t: "约束与护栏", d: "禁止项、格式、语言、合规边界，划清「不能做什么」" },
  { t: "工作流", d: "拆成可执行的步骤，复杂任务也能稳定复现" },
  { t: "输出规范", d: "含 schema/示例的列定义，让产出可直接用" },
  { t: "边界与兜底", d: "信息不足时追问而非臆测，异常情况有预案" },
  { t: "自检", d: "交付前对照清单回查，逼自己不偷工减料" },
];

const STEPS: { ico: string; t: string; d: string }[] = [
  { ico: "🧩", t: "选 / 写模板", d: "一句话生成（F1），或从社区 / 首页模板库挑一条带变量的骨架" },
  { ico: "✍️", t: "填变量生成", d: "填完 {{占位符}}，F2 实例化成可直接发给模型的成品提示词" },
  { ico: "🚀", t: "试跑 / 优化 / 发布", d: "本地试跑验证、AI 优化改写、派生改造，满意了发布到社区" },
];
