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
      <div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:14px;padding:18px;margin:18px 0;line-height:1.8;">
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
      <div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0;">
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

      <!-- 三、主流模型家族：风格差异与最佳实践 -->
      <h2 class="section-title" style="font-size:1.2rem;margin-top:30px;">③ 主流模型家族：风格差异与最佳实践</h2>
      <p class="section-sub" style="text-align:left;">不同厂商的模型「脾气」不同，顺着它们的特性写提示词，才能拿到最稳的效果（思路对标 OpenAI / Claude / Gemini 官方 Prompt Library）：</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin:14px 0;">
        ${FAMILY.map((f) => `
          <div style="border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--surface);">
            <div style="font-size:1.3rem;margin-bottom:6px;">${f.ico} <b style="color:var(--ink);">${esc(f.name)}</b></div>
            <ul style="margin:0;padding-left:18px;line-height:1.7;font-size:.84rem;" class="muted">
              ${f.points.map((p) => `<li>${esc(p)}</li>`).join("")}
            </ul>
          </div>`).join("")}
      </div>
      <div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;padding:16px;margin:10px 0;line-height:1.7;">
        <div class="muted" style="font-size:.8rem;margin-bottom:8px;">🛡 <b style="color:var(--ink);">生产纪律（来自官方实践，值得抄作业）</b></div>
        <ul style="margin:0;padding-left:20px;line-height:1.9;font-size:.9rem;">
          <li><b>锁版本</b>：生产环境固定模型<b>快照 ID</b>（如 <code>gpt-4o-2024-08-06</code>），不裸用 <code>latest</code>，避免悄悄变体导致效果漂移。</li>
          <li><b>建评测套件</b>：沉淀一组固定测试用例（数据集），每次改提示词都跑一遍回归，确保「优化」真优化而非退化 —— 呼应本站 F13 优化闭环可数据集化。</li>
          <li><b>提示缓存降本</b>：把稳定不变的系统 / 背景段放前面，可命中共享缓存，长提示词成本可降数倍。</li>
        </ul>
        <p class="muted" style="font-size:.82rem;margin:10px 0 0;">本站已内建对应工具：F9 跨模型对比 + 成本预估、F10 版本历史 + diff/回滚、F13 LLM-as-Judge 优化闭环 —— 把上面的「锁版本 + 评测 + 降本」直接落地成按钮。</p>
      </div>

      <!-- 四、三步上手 -->
      <h2 class="section-title" style="font-size:1.2rem;margin-top:30px;">④ 三步上手</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:14px 0;">
        ${STEPS.map((s) => `
          <div style="border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--surface);">
            <div style="font-size:1.6rem;">${s.ico}</div>
            <h4 style="margin:8px 0 4px;color:var(--ink);">${esc(s.t)}</h4>
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

const FAMILY: { ico: string; name: string; points: string[] }[] = [
  {
    ico: "🟢",
    name: "OpenAI",
    points: [
      "固定模型快照 ID（如 gpt-4o-2024-08-06），避免悄然升级",
      "指令优先级 developer > user > system",
      "Markdown + XML 结构化、少样本 (few-shot)",
      "提示缓存 (prompt caching) 降本、结构化输出 (JSON schema)",
    ],
  },
  {
    ico: "🟠",
    name: "Claude（Anthropic）",
    points: [
      "XML 标签 <tag> 结构化 + 少样本最稳",
      "按家族分版：Opus 重质量 / Sonnet 均衡 / Haiku 快省",
      "官方库多内联样本，可整页复制",
      "长文本与严谨推理见长",
    ],
  },
  {
    ico: "🔵",
    name: "Gemini（Google）",
    points: [
      "多模态原生：音频 / 视频 / 图像 / 代码 / 数学",
      "任务卡片「在 AI Studio 打开」即运行",
      "超长上下文友好",
      "适合把提示词直接接进产品流水线",
    ],
  },
];
