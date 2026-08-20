// views/detail.ts — 模板详情页 + F2 代写流水线 + 测试沙盒 + 导入（Component 模式）。
import { TEMPLATES } from "../templates.js";
import { LLM } from "../llm.js";
import { Store } from "../store.js";
import { ctx } from "../core/ctx.js";
import { esc, setMeta, fmtUsage, metricBump, metricRate, toast, diffLines, fmtDateTime } from "../core/ui.js";
import { GEN_STEPS_3, ALL_INDUSTRIES, MAX_CLARIFY_ROUNDS } from "../core/config.js";
import { renderGenSteps, appendThink, renderRagRefs } from "../core/steps.js";
import { judgePromptText, PROMPT_DIM_LABELS, scoreTo100 } from "../core/judge.js";
import { openRefineBox, closeRefineBox, handleRefine, templateRefineCtx } from "./refine.js";
import { openPublishForm } from "./community.js";
import { openCompareModal } from "./compare.js";
import { openOptimizeModal } from "./optimize.js";
import { openPreviewModal } from "./preview.js";

// 模板稳定 id：优先 slug（内置/导入/生成），其次 id
function tplId(t: any): string | null {
  return t && (t.slug || t.id) ? (t.slug || t.id) : null;
}

// 种子模板优先；其次“我的模板 / AI 草稿”；最后回退当前会话内存草稿
function findTemplate(slug: string): any {
  if (!slug) return null;
  const seed = TEMPLATES.find(t => t.slug === slug);
  if (seed) return seed;
  const fromStore = Store.findAny(slug);
  return fromStore || (window.__draft && window.__draft.slug === slug ? window.__draft : null);
}

// 模板详情页
export function detail(slug: string): void {
  const tpl = findTemplate(slug);
  if (!tpl) { ctx.appEl().innerHTML = '<p>模板不存在或已失效（AI 草稿刷新后需重新生成）。</p>'; return; }
  // 深拷贝，避免修改行业分类时污染全局种子对象或内存草稿
  ctx.current = JSON.parse(JSON.stringify(tpl));
  ctx.testMessages = []; ctx.testController = null; // 进入新模板时清空测试沙盒对话
  const isMine = Store.hasMine(slug);
  const canEdit = isMine || ctx.current.generated || ctx.current.imported || ctx.current.forkedFrom;
  setMeta(tpl.title, (tpl.summary || tpl.task || "").slice(0, 120));
  const tagHtml = (tpl.tags || []).map(t => `<span class="text-xs tag mr-1">#${esc(t)}</span>`).join("");
  const industryOpts = ALL_INDUSTRIES.map(i =>
    `<option value="${esc(i)}" ${i === tpl.industry ? "selected" : ""}>${esc(i)}</option>`
  ).join("");
  const dimsHtml = (tpl.variables && tpl.variables.length)
    ? tpl.variables.map(v => `<span class="tag">${esc(v.label)}</span>`).join("")
    : '<span class="muted">通用专家提示词（角色 + 结构由模板固定）</span>';
  // 结构化元信息（报告#5）：变量数优先取变量表，否则按 {{占位}} 计数；字数取骨架字符数
  const varCount = (tpl.variables && tpl.variables.length)
    ? tpl.variables.length
    : ((tpl.prompt || "").match(/\{\{[^}]+\}\}/g) || []).length;
  const charCount = (tpl.prompt || "").length;

  ctx.appEl().innerHTML = `
    <a href="#/" class="back-link" onclick="goBack();return false;">← 返回</a>
    <div class="mt-3">
      <h1 class="section-title" style="font-size:1.7rem;">${esc(tpl.title)}</h1>
      <div class="muted" style="font-size:.85rem;margin-top:6px;"><span id="meta-industry">${esc(tpl.industry)}</span> · ${esc(tpl.task)}
        ${tpl.generated ? '<span class="pill pill-amber" style="margin-left:4px;">AI 生成</span>' : ""}
        ${tpl.forkedFrom ? `<a href="#/c/${esc(tpl.forkedFrom)}" class="pill" style="margin-left:4px;background:var(--brand-50);color:var(--brand-700);text-decoration:none;">🍴 派生自社区「${esc(tpl.forkedFromTitle || "社区模板")}」</a>` : ""}</div>
      ${ctx.current._genUsage ? `<div class="mt-2 inline-flex items-center gap-1 text-xs" style="color:var(--slate);background:var(--bg-soft);padding:4px 10px;border-radius:8px;">📊 模板生成：${esc(fmtUsage(ctx.current._genUsage, ctx.current._genElapsed || 0))}</div>` : ""}
    </div>
    <div class="flex flex-wrap items-center gap-2 mt-3">
      <label class="text-sm font-medium" style="color:var(--slate)">所属分类</label>
      <select id="set-industry" class="select" style="width:auto;padding:7px 12px;">${industryOpts}</select>
      ${tpl.generated ? '<span class="text-xs muted">AI 生成模板可在此改到任意分类</span>' : ""}
    </div>
    <p class="slate" style="margin-top:10px;line-height:1.6;">${esc(tpl.summary)}</p>
    <div class="mt-2">${tagHtml}</div>
    <div class="tpl-meta">📊 ${varCount} 个可填变量 · 骨架 ${charCount} 字 · 🔧 适配任意模型（F9 可跨模型对比）</div>
    ${tpl.sources && tpl.sources.length ? `<div class="gen-rag" style="margin-top:14px;"><div class="ttl">📚 该模板生成时参考了 ${tpl.sources.length} 个模板库范例</div><div style="display:flex;flex-wrap:wrap;gap:6px;">${tpl.sources.map(s => `<span class="tag" style="background:#fff;border:1px solid var(--brand-100);">${esc(s.title)}<span class="muted"> · ${esc(s.industry)}</span></span>`).join("")}</div></div>` : ""}

    <div class="card tpl-card" style="margin-top:18px;">
      <div class="ttl">🧩 这个模板会自动帮你覆盖（由 AI 在生成时动态写具体）</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">${dimsHtml}</div>
    </div>

    <div class="card tpl-card" style="margin-top:16px;">
      <div class="flex items-center justify-between">
        <div class="ttl">📄 模板正文（可复用的「提示词骨架」）</div>
        ${canEdit ? '<button id="edit-toggle" class="btn btn-ghost btn-sm">✏️ 编辑</button>' : ""}
      </div>
      <pre id="tpl-prompt-view" class="code-box" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;">${esc(tpl.prompt || "（此模板为通用专家提示词，无固定骨架，由模型在生成时动态撰写具体内容）")}</pre>
      <div id="edit-panel" style="display:none;margin-top:8px;">
        <label class="text-sm font-medium" style="color:var(--slate)">标题</label>
        <input id="ed-title" class="input" style="margin-top:4px;" value="${esc(tpl.title)}" />
        <label class="text-sm font-medium" style="color:var(--slate);margin-top:8px;display:block;">简介</label>
        <input id="ed-summary" class="input" style="margin-top:4px;" value="${esc(tpl.summary || "")}" />
        <label class="text-sm font-medium" style="color:var(--slate);margin-top:8px;display:block;">所属分类</label>
        <select id="ed-industry" class="select" style="margin-top:4px;width:100%;">${industryOpts}</select>
        <label class="text-sm font-medium" style="color:var(--slate);margin-top:8px;display:block;">模板骨架（prompt）</label>
        <textarea id="ed-prompt" class="input" rows="8" style="margin-top:4px;font-family:monospace;">${esc(tpl.prompt || "")}</textarea>
        <div class="flex gap-2 mt-3 flex-wrap items-center">
          <button id="ed-save" class="btn btn-primary btn-sm">💾 保存修改</button>
          <button id="ed-cancel" class="btn btn-ghost btn-sm">取消</button>
          <button id="ed-score" class="btn btn-ghost btn-sm">⚖️ 评一下骨架</button>
          <button id="ed-enhance" class="btn btn-ghost btn-sm">✨ 增强</button>
          <span id="ed-msg" class="muted" style="font-size:.75rem;"></span>
        </div>
      </div>
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
        ${canEdit ? '<button id="hist-btn" class="btn btn-ghost btn-sm">🕑 历史版本</button>' : ""}
        ${canEdit ? '<button id="opt-btn" class="btn btn-ghost btn-sm">🔧 一键优化</button>' : ""}
        <button id="dl-tpl-btn" class="btn btn-ghost btn-sm">下载此模板</button>
        <button id="prev-btn" class="btn btn-ghost btn-sm">🔍 示例预览</button>
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
        <button id="use-score" class="btn btn-ghost btn-sm">⚖️ 评一下</button>
        <span id="use-usage" class="muted" style="font-size:.75rem;"></span>
      </div>
    </div>
    <div id="use-run-wrap" class="card tpl-card" style="margin-top:16px;display:none;">
      <div class="flex items-center justify-between">
        <div class="ttl">🧪 测试这个提示词（把它当作系统设定，自由提问，多轮对话）</div>
        <div class="flex gap-2 items-center">
          <button id="refine-open" class="btn btn-ghost btn-sm">✏️ 不满意？让 AI 改进</button>
          <button id="use-compare" class="btn btn-ghost btn-sm">🔬 跨模型对比</button>
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
  if (stopU) stopU.addEventListener("click", () => { if (ctx.useController) ctx.useController.abort(); });
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
      industry: ctx.current.industry || tpl.industry,
      tags: tpl.tags || [],
      prompt: ctx.current._lastPrompt || tpl.prompt,
      note: tpl.summary || "",
    });
  });
  const runStop = (document.getElementById("use-run-stop") as HTMLButtonElement);
  if (runStop) runStop.addEventListener("click", () => { if (ctx.testController) ctx.testController.abort(); });
  const testSend = (document.getElementById("test-send") as HTMLButtonElement);
  if (testSend) testSend.addEventListener("click", sendTestMessage);
  const testClear = (document.getElementById("test-clear") as HTMLButtonElement);
  if (testClear) testClear.addEventListener("click", clearTestChat);
  // 本页（模板详情）使用模板版 refine 上下文，供 F5 改写逻辑区分元素/状态
  ctx.refineCtx = templateRefineCtx();
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
      ctx.current.industry = (e.target as HTMLInputElement).value;
      const meta = (document.getElementById("meta-industry") as HTMLElement);
      if (meta) meta.textContent = ctx.current.industry;
      const m = (document.getElementById("msg") as HTMLElement);
      if (m && !Store.hasMine(ctx.current.slug)) m.textContent = "已选择分类：" + ctx.current.industry + "（收藏后生效）";
    });
  }

  // 评分：星星点选 + 拉取当前评分
  const stars = (document.getElementById("rate-stars") as HTMLElement);
  if (stars) {
    stars.querySelectorAll(".star").forEach(s => s.addEventListener("click", () => {
      rateTemplate(Number(s.getAttribute("data-n")));
    }));
  }
  if (canEdit) {
    const editToggle = (document.getElementById("edit-toggle") as HTMLButtonElement);
    if (editToggle) editToggle.addEventListener("click", () => {
      const panel = (document.getElementById("edit-panel") as HTMLElement);
      const view = (document.getElementById("tpl-prompt-view") as HTMLElement);
      if (panel && view) {
        const open = panel.style.display === "none";
        panel.style.display = open ? "block" : "none";
        view.style.display = open ? "none" : "block";
      }
    });
    const edSave = (document.getElementById("ed-save") as HTMLButtonElement);
    if (edSave) edSave.addEventListener("click", () => {
      ctx.current.title = (document.getElementById("ed-title") as HTMLInputElement).value.trim() || ctx.current.title;
      ctx.current.summary = (document.getElementById("ed-summary") as HTMLInputElement).value.trim();
      ctx.current.industry = (document.getElementById("ed-industry") as HTMLSelectElement).value;
      ctx.current.prompt = (document.getElementById("ed-prompt") as HTMLTextAreaElement).value;
      Store.addMine(JSON.parse(JSON.stringify(ctx.current)));
      toast("✓ 已保存修改（已记录为新版本）");
      detail(ctx.current.slug);
    });
    const edCancel = (document.getElementById("ed-cancel") as HTMLButtonElement);
    if (edCancel) edCancel.addEventListener("click", () => {
      const panel = (document.getElementById("edit-panel") as HTMLElement);
      const view = (document.getElementById("tpl-prompt-view") as HTMLElement);
      if (panel && view) { panel.style.display = "none"; view.style.display = "block"; }
    });
    const histBtn = (document.getElementById("hist-btn") as HTMLButtonElement);
    if (histBtn) histBtn.addEventListener("click", openHistory);
    const optBtn = (document.getElementById("opt-btn") as HTMLButtonElement);
    if (optBtn) optBtn.addEventListener("click", () => openOptimizeModal(ctx.current));
    const edScore = (document.getElementById("ed-score") as HTMLButtonElement);
    if (edScore) edScore.addEventListener("click", () => {
      const p = (document.getElementById("ed-prompt") as HTMLTextAreaElement).value;
      scoreCurrentPrompt(p, { title: ctx.current.title });
    });
    // r19#7：编辑态「✨ 增强」——复用 F13 优化闭环，优化版写回编辑框并落 F10 版本（before/after 可回滚）
    const edEnhance = (document.getElementById("ed-enhance") as HTMLButtonElement);
    if (edEnhance) edEnhance.addEventListener("click", () => {
      const tempTpl = {
        ...ctx.current,
        title: (document.getElementById("ed-title") as HTMLInputElement).value.trim() || ctx.current.title,
        summary: (document.getElementById("ed-summary") as HTMLInputElement).value.trim(),
        industry: (document.getElementById("ed-industry") as HTMLSelectElement).value,
        prompt: (document.getElementById("ed-prompt") as HTMLTextAreaElement).value,
      };
      openOptimizeModal(tempTpl, (rec: any) => {
        ctx.current.title = rec.title ?? ctx.current.title;
        ctx.current.summary = rec.summary ?? ctx.current.summary;
        ctx.current.industry = rec.industry ?? ctx.current.industry;
        ctx.current.prompt = rec.prompt;
        const ta = (document.getElementById("ed-prompt") as HTMLTextAreaElement);
        if (ta) ta.value = rec.prompt;
        Store.addMine(JSON.parse(JSON.stringify(ctx.current)));
        const msg = document.getElementById("ed-msg");
        if (msg) msg.textContent = "✓ 已采用 AI 优化版（编辑框已更新，可在「历史版本」对比 before/after）";
        toast("✓ 已采用优化版，并存入新版本");
        detail(ctx.current.slug); // 重渲染以刷新版本徽标等
      });
    });
  }
  // 「示例预览」对所有模板开放：内置模板虽不可编辑，也应能一键生成示例看效果
  const prevBtn = (document.getElementById("prev-btn") as HTMLButtonElement);
  if (prevBtn) prevBtn.addEventListener("click", () => openPreviewModal(ctx.current));
  const compareBtn = (document.getElementById("use-compare") as HTMLButtonElement);
  if (compareBtn) compareBtn.addEventListener("click", () => {
    if (!ctx.current._lastPrompt) { toast("请先生成成品提示词，再对比不同模型的表现。"); return; }
    openCompareModal(ctx.current._lastPrompt, "请用 3 句话介绍你能帮我做什么，并各举一例。");
  });

  const scoreBtn = (document.getElementById("use-score") as HTMLButtonElement);
  if (scoreBtn) scoreBtn.addEventListener("click", () => {
    scoreCurrentPrompt(ctx.current._lastPrompt || "", { title: tpl.title });
  });

  loadRateInfo(tplId(ctx.current));
}

// 发送前实时评分：调用 judgePromptText，含无 Key 提示与 loading 态。
async function scoreCurrentPrompt(promptText: string, meta: { title?: string; goal?: string }): Promise<void> {
  const text = (promptText || "").trim();
  if (!text) { toast("还没有可评分的提示词，先生成或编辑出一份吧"); return; }
  openScoreModal(null); // loading
  try {
    const r = await judgePromptText(text, meta);
    openScoreModal(r, meta);
  } catch (e: any) {
    const msg = e && e.message ? e.message : String(e);
    if (/未配置 API Key|未填写 API Key/.test(msg)) {
      openScoreModal({ error: "请先到「设置」页填写 API Key，才能使用实时评分。" });
    } else {
      openScoreModal({ error: "评分失败：" + msg });
    }
  }
}

// 评分弹层：result 为 null→loading；{error}→错误；JudgeResult→打分结果。
function openScoreModal(result: any, meta: { title?: string } = {}): void {
  const old = document.getElementById("score-modal");
  if (old) old.remove();
  const overlay = document.createElement("div");
  overlay.id = "score-modal";
  overlay.className = "score-modal";
  let body = "";
  if (!result) {
    body = `<div class="score-loading">⚖️ 裁判模型评分中…</div>`;
  } else if (result.error) {
    body = `<div class="score-error">${esc(result.error)}</div>`;
  } else if (!result.available) {
    body = `<div class="score-error">评分解析失败，请重试。</div>`;
  } else {
    const score = scoreTo100(result.total);
    const bars = PROMPT_DIM_LABELS.map(([k, label]) => {
      const v = (result.dims && result.dims[k]) || 0;
      const pct = Math.max(0, Math.min(100, (v / 5) * 100));
      const low = v < 3;
      return `<div class="score-bar-row">
        <span class="score-bar-label">${label}</span>
        <span class="score-bar"><span class="score-bar-fill${low ? " low" : ""}" style="width:${pct}%"></span></span>
        <span class="score-bar-val">${v}/5</span>
      </div>`;
    }).join("");
    const kind = score >= 80 ? "优" : score >= 60 ? "良" : score >= 40 ? "中" : "待改进";
    body = `
      <div class="score-head">
        <div class="score-num">${score}<span class="score-num-unit">/100</span></div>
        <div class="score-kind">${kind}</div>
      </div>
      <div class="score-bars">${bars}</div>
      <div class="score-note">💡 ${esc(result.note || "（无建议）")}</div>`;
  }
  overlay.innerHTML = `
    <div class="score-card">
      <div class="score-card-ttl">⚖️ 提示词质量评分${meta.title ? `<span class="score-card-sub">${esc(meta.title)}</span>` : ""}</div>
      ${body}
      <div class="score-foot"><button id="score-close" class="btn btn-primary btn-sm">知道了</button></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  const close = document.getElementById("score-close");
  if (close) close.addEventListener("click", () => overlay.remove());
}

// 高亮用户已选/将选的星数
function highlightStars(n: number): void {
  const stars = (document.getElementById("rate-stars") as HTMLElement);
  if (!stars) return;
  stars.querySelectorAll(".star").forEach(s => {
    s.classList.toggle("on", Number(s.getAttribute("data-n")) <= n);
  });
}

// 提交评分（带本人上次评分做差值，避免重复计数）
function rateTemplate(score: number): void {
  const id = tplId(ctx.current);
  if (!id) return;
  const prev = Store.getRating(id);
  metricRate(id, score, prev, ctx.current.title, ctx.current.industry);
  Store.setRating(id, score);
  highlightStars(score);
  loadRateInfo(id);
  const m = (document.getElementById("msg") as HTMLElement);
  if (m) { m.textContent = "已评分 " + score + " 星 ✓"; setTimeout(() => { if (m) m.textContent = ""; }, 2000); }
}

// 拉取并展示该模板的累计评分（均分 + 人数）
async function loadRateInfo(id: string): Promise<void> {
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
function buildCombinedGoal(goal: string, qa: any[]): string {
  if (!qa || !qa.length) return goal;
  return goal + "\n\n（用户确认的关键信息）\n" + qa.map((h, i) => `${i + 1}) ${h.question} → ${h.answer}`).join("\n");
}

// 用模板生成成品提示词：先访谈确认信息，再让模型代写（F3 + F2 串联）
async function handleUse(): Promise<void> {
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
  ctx.useQa = [];
  ctx.useRound = 0;
  // 注意：use-btn 在整个「访谈 + 代写」流程结束前保持禁用，
  // 由 startUseGeneration 的 finally 在生成完成后恢复，避免重复触发。
  await runInterviewRound(goal, msg, live);
}

// 单轮访谈：调 /agent/clarify，complete 则进入生成，否则渲染问题让用户确认
async function runInterviewRound(goal: string, msg: HTMLElement, live: HTMLElement): Promise<void> {
  const clarifyBox = (document.getElementById("use-clarify") as HTMLElement);
  const sel = new AbortController();
  ctx.useController = sel;
  let data: any;
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
    const onNode = (name: string) => { if (name === "clarify") { const el = (document.getElementById("think-clarify") as HTMLElement); if (el) el.classList.add("is-active"); } };
    const onThink = (text: string) => {
      if (thinkStream) { const line = document.createElement("div"); line.className = "think-line"; line.textContent = "▸ " + text; thinkStream.appendChild(line); }
    };
    data = await LLM.clarifyViaAgent(ctx.current, goal, ctx.useQa, sel.signal, onNode, onThink);
  } catch (e) {
    if (sel.signal.aborted) return; // 用户中止访谈，什么都不做
    // 访谈不可用（无 Key 等）：直接按原始目标生成
    msg.textContent = "访谈不可用，直接生成…";
    return startUseGeneration(goal, msg, live);
  }
  if (data.complete || ctx.useRound >= MAX_CLARIFY_ROUNDS) {
    const enriched = (data.enrichedGoal && data.enrichedGoal.trim()) ? data.enrichedGoal : buildCombinedGoal(goal, ctx.useQa);
    return startUseGeneration(enriched, msg, live);
  }
  renderClarifyQuestions(data.questions, goal, msg, live);
}

// 渲染本轮问题：每个选项 chip 可点选，也允许自由补充；确认后收集答案进入下一轮
function renderClarifyQuestions(questions: any[], goal: string, msg: HTMLElement, live: HTMLElement): void {
  // 先把访谈"思考步"标记完成，并保留思考过程可见（不覆盖）
  const thinkItem = (document.getElementById("think-clarify") as HTMLElement);
  if (thinkItem) {
    thinkItem.classList.remove("active");
    thinkItem.classList.add("done");
    const dot = thinkItem.querySelector(".step-dot");
    if (dot) dot.innerHTML = "✓";
  }
  const qBox = (document.getElementById("clarify-q") as HTMLElement);
  const roundLabel = ctx.useRound + 1;
  const qText = questions.map(q => q.question);
  const historyHtml = ctx.useQa.length
    ? `<div class="qa-history">` + ctx.useQa.map((h, i) =>
        `<div class="qa-row"><div class="qa-q">${i + 1}. ${esc(h.question)}</div><div class="qa-a">→ ${esc(h.answer)}</div></div>`).join("") + `</div>`
    : "";
  const qHtml = questions.map((q, qi) => {
    const opts = q.options.map(o => `<button type="button" class="opt-chip" data-qi="${qi}">${esc(o)}</button>`).join("");
    return `<div class="q-card" data-qi="${qi}">
      <div class="q-title">${esc(q.question)}${q.multi ? ' <span class="q-multi-hint">可多选</span>' : ''}</div>
      <div class="opt-row" data-qi="${qi}">${opts}</div>
      <input class="input q-free" data-qi="${qi}" placeholder="或自己补充…">
    </div>`;
  }).join("");
  if (qBox) qBox.innerHTML = `
    <div class="clarify-head">🤖 第 ${roundLabel} 轮确认 · 点选项（标「可多选」的可点多个）或自行填写，补全后点「确认」${ctx.useRound >= MAX_CLARIFY_ROUNDS - 1 ? "（最后一轮）" : ""}</div>
    ${historyHtml}
    ${qHtml}
    <div class="flex gap-2 mt-3 flex-wrap items-center">
      <button id="clarify-ok" class="btn btn-primary btn-sm">✓ 确认并继续</button>
      <button id="clarify-skip" class="btn btn-ghost btn-sm">跳过追问，直接生成</button>
    </div>`;

  const selState: any = {}; // qi -> {q, a}
  // 读取某题当前答案：优先自由补充文字；否则取已选 chip（多选时用"、"连接）
  const currentAnswer = (qi: number): string => {
    const free = qBox.querySelector<HTMLInputElement>(`.q-free[data-qi="${qi}"]`);
    if (free && free.value.trim()) return free.value.trim();
    const sel = qBox.querySelectorAll(`.opt-row[data-qi="${qi}"] .opt-chip.sel`);
    return Array.from(sel).map(b => (b.textContent || "").trim()).join("、");
  };
  const record = (qi: number) => {
    const a = currentAnswer(qi);
    if (a) selState[qi] = { q: qText[qi], a }; else delete selState[qi];
  };
  if (qBox) qBox.querySelectorAll(".opt-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const qi = Number(btn.getAttribute("data-qi"));
      const multi = !!questions[qi].multi;
      if (multi) {
        // 多选：点击仅切换自身选中态，不清空同组其他选项
        btn.classList.toggle("sel");
      } else {
        // 单选：选中当前并把同组其他选项取消
        qBox.querySelectorAll(`.opt-row[data-qi="${qi}"] .opt-chip`).forEach(b => b.classList.remove("sel"));
        btn.classList.add("sel");
      }
      const free = qBox.querySelector<HTMLInputElement>(`.q-free[data-qi="${qi}"]`);
      if (free) free.value = "";
      record(qi);
    });
  });
  if (qBox) qBox.querySelectorAll<HTMLInputElement>(".q-free").forEach(inp => {
    inp.addEventListener("input", () => {
      const qi = Number(inp.getAttribute("data-qi"));
      const val = inp.value.trim();
      if (val) {
        // 自由补充优先：清空该题已选 chip
        qBox.querySelectorAll(`.opt-row[data-qi="${qi}"] .opt-chip`).forEach(b => b.classList.remove("sel"));
        selState[qi] = { q: qText[qi], a: val };
      } else {
        delete selState[qi];
      }
    });
  });
  (document.getElementById("clarify-skip") as HTMLButtonElement).addEventListener("click", () => {
    const okBtn = (document.getElementById("clarify-ok") as HTMLButtonElement);
    const skipBtn = (document.getElementById("clarify-skip") as HTMLButtonElement);
    if (okBtn) okBtn.disabled = true;
    if (skipBtn) { skipBtn.disabled = true; skipBtn.style.opacity = ".55"; } // 锁定，防重复提交
    if (qBox) qBox.innerHTML = '<div class="clarify-head">🤖 正在生成你的提示词，请稍候…<span class="spinner"></span></div>';
    startUseGeneration(buildCombinedGoal(goal, ctx.useQa), msg, live);
  });
  (document.getElementById("clarify-ok") as HTMLButtonElement).addEventListener("click", () => {
    const answers = Object.keys(selState).map(k => ({ question: selState[k].q, answer: selState[k].a }));
    if (!answers.length) { msg.textContent = "请至少选择或修改一项，或点「跳过」。"; return; }
    const okBtn = (document.getElementById("clarify-ok") as HTMLButtonElement);
    const skipBtn = (document.getElementById("clarify-skip") as HTMLButtonElement);
    if (okBtn) { okBtn.disabled = true; okBtn.style.opacity = ".55"; } // 锁定本轮，防重复提交
    if (skipBtn) skipBtn.disabled = true;
    ctx.useQa = ctx.useQa.concat(answers);
    ctx.useRound++;
    if (qBox) qBox.innerHTML = '<div class="clarify-head">🤖 正在生成下一轮确认问题，请稍候…<span class="spinner"></span></div>';
    runInterviewRound(goal, msg, live);
  });
}

// 进入生成：把"目标 + 已确认问答"交给 /agent/use 代写成品提示词
async function startUseGeneration(goal: string, msg: HTMLElement, live: HTMLElement): Promise<void> {
  const clarifyBox = (document.getElementById("use-clarify") as HTMLElement);
  clarifyBox.style.display = "none";
  clarifyBox.innerHTML = "";
  if (ctx.useQa.length) {
    clarifyBox.style.display = "block";
    clarifyBox.innerHTML = `<div class="clarify-done">✓ 已确认 ${ctx.useQa.length} 项关键信息，正在据此生成提示词…</div>`;
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
  ctx.thinkLog = {}; ctx.activeStepKey = "";
  renderGenSteps("retrieve", GEN_STEPS_3);
  btn.disabled = true; btn.style.opacity = ".55";
  stopBtn.style.display = "inline-flex";
  ctx.useController = new AbortController();
  ctx.current._lastPrompt = "";
  try {
    const onToken = (chunk: string) => { if (chunk) live.textContent += chunk; };
    const onNode = (name: string) => {
      if (name === "meta") { renderGenSteps("retrieve", GEN_STEPS_3); return; }
      if (name === "result") { renderGenSteps("__done__", GEN_STEPS_3); return; }
      if (name === "selfcheck") appendThink("正在进行生产级自检：对照清单补齐缺失的角色 / 约束 / 工作流 / 输出规范 / 边界兜底，输出更可靠的版本…");
      if (name === "finalize") appendThink("自检完成，正在定稿输出最终成品提示词…");
      renderGenSteps(name, GEN_STEPS_3);
    };
    const onThink = (text: string) => { appendThink(text); };
    const onContext = (refs: any[]) => { renderRagRefs(refs); };
    let res: any;
    try {
      res = await LLM.useTemplateViaAgent(ctx.current, goal, onToken, onNode, ctx.useController.signal, onContext, onThink);
    } catch (e) {
      const m = (e && (e as any).message) || "";
      if (/API 错误|401|Authentication|api ?key|invalid|key/i.test(m)) throw e;
      live.textContent += "\n（服务端 Agent 暂不可用，已自动改用浏览器直连生成）";
      renderGenSteps("draft", GEN_STEPS_3);
      appendThink("已切换浏览器直连，正在调用模型代写提示词…");
      res = await LLM.useTemplate(ctx.current, goal, onToken, ctx.useController.signal, true, (stage) => {
        renderGenSteps(stage, GEN_STEPS_3);
        if (stage === "selfcheck") appendThink("正在进行生产级自检：对照清单补齐缺失的角色 / 约束 / 工作流 / 输出规范 / 边界兜底，输出更可靠的版本…");
      });
    }
    ctx.current._lastPrompt = res.prompt || "";
    if (res.prompt) live.textContent = res.prompt; // 自检改写后覆盖显示最终版，避免只显示首稿
    metricBump(tplId(ctx.current), "use", 1, ctx.current.title, ctx.current.industry);
    renderGenSteps("__done__", GEN_STEPS_3);
    const usageEl = (document.getElementById("use-usage") as HTMLElement);
    if (res.usage) usageEl.textContent = "📊 " + fmtUsage(res.usage, res.elapsedMs);
    actions.style.display = "flex";
    msg.textContent = "✓ 已生成成品提示词（模型已结合你确认的信息写好具体内容）。";
  } catch (e) {
    if (ctx.useController && ctx.useController.signal.aborted) {
      live.textContent += "\n\n■ 已停止生成";
      msg.textContent = "已停止生成。";
    } else {
      live.textContent += "\n\n✗ 生成失败：" + (e as any).message;
      msg.textContent = "生成失败：" + (e as any).message;
    }
  } finally {
    btn.disabled = false; btn.style.opacity = "1";
    stopBtn.style.display = "none";
    ctx.useController = null;
  }
}

// 测试沙盒：把生成的成品提示词当作"系统设定"，与用户多轮自由对话，实时判断提示词好不好用
function handleTestChat(): void {
  const wrap = (document.getElementById("use-run-wrap") as HTMLElement);
  const promptEl = (document.getElementById("test-prompt") as HTMLElement);
  if (!wrap || !promptEl) return;
  wrap.style.display = "block";
  promptEl.textContent = ctx.current._lastPrompt || "（尚未生成提示词）";
  if (!ctx.current._lastPrompt) {
    const m = (document.getElementById("msg") as HTMLElement);
    if (m) m.textContent = "请先生成提示词再测试。";
    return;
  }
  const log = (document.getElementById("test-log") as HTMLElement);
  if (log && !log.children.length && !ctx.testMessages.length) {
    log.innerHTML = '<div class="test-empty muted">对话已开始 —— 在下方输入问题，模型会按上面的提示词作答。可连续追问，检验提示词是否好用。</div>';
  }
  const input = (document.getElementById("test-input") as HTMLTextAreaElement);
  if (input) input.focus();
}

function appendTestBubble(text: string, role: string): void {
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

function clearTestChat(): void {
  ctx.testMessages = [];
  const log = (document.getElementById("test-log") as HTMLElement);
  if (log) log.innerHTML = '<div class="test-empty muted">对话已清空 —— 重新输入问题开始测试。</div>';
  const usageEl = (document.getElementById("use-run-usage") as HTMLElement);
  if (usageEl) usageEl.textContent = "";
}

async function sendTestMessage(): Promise<void> {
  const input = (document.getElementById("test-input") as HTMLTextAreaElement);
  const log = (document.getElementById("test-log") as HTMLElement);
  const m = (document.getElementById("msg") as HTMLElement);
  const sendBtn = (document.getElementById("test-send") as HTMLButtonElement);
  const stopBtn = (document.getElementById("use-run-stop") as HTMLButtonElement);
  const usageEl = (document.getElementById("use-run-usage") as HTMLElement);
  if (!input || !log) return;
  const text = input.value.trim();
  if (!text) return;
  if (!ctx.current._lastPrompt) { if (m) m.textContent = "请先生成提示词再测试。"; return; }

  // 锁定发送 + 显示停止，防重复提交
  if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = ".55"; }
  if (stopBtn) stopBtn.style.display = "inline-flex";

  ctx.testMessages.push({ role: "user", content: text });
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

  ctx.testController = new AbortController();
  let full = "";
  if (m) m.textContent = "模型回复中…";
  try {
    const onToken = (chunk: string) => {
      if (chunk) { full += chunk; aText.textContent = full; log.scrollTop = log.scrollHeight; }
    };
    const res = await LLM.chatWithPrompt(ctx.current._lastPrompt, ctx.testMessages, onToken, ctx.testController.signal);
    full = res.text || full;
    aText.textContent = full;
    ctx.testMessages.push({ role: "assistant", content: full });
    if (res.usage) usageEl.textContent = "📊 " + fmtUsage(res.usage, res.elapsedMs);
    if (m) m.textContent = "✓ 已回复（可继续追问，检验提示词效果）。";
  } catch (e) {
    if (ctx.testController && ctx.testController.signal.aborted) {
      aText.textContent = (full ? full + "\n\n" : "") + "■ 已停止";
      if (m) m.textContent = "已停止。";
    } else {
      aText.textContent = (full ? full + "\n\n" : "") + "✗ 测试失败：" + (e as any).message;
      if (m) m.textContent = "测试失败：" + (e as any).message;
    }
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = "1"; }
    if (stopBtn) stopBtn.style.display = "none";
    ctx.testController = null;
    if (input) input.focus();
  }
}

function copyUsePrompt(): void {
  const text = ctx.current._lastPrompt || "";
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

function downloadUsePrompt(fmt: string): void {
  const text = ctx.current._lastPrompt || "";
  if (!text) { const m = (document.getElementById("msg") as HTMLElement); if (m) m.textContent = "还没有生成提示词。"; return; }
  const mime = fmt === "md" ? "text/markdown" : "text/plain";
  const fname = (ctx.current.slug || "prompt") + (fmt === "md" ? ".md" : ".txt");
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
function downloadTemplate(): void {
  const def = {
    title: ctx.current.title, industry: ctx.current.industry, task: ctx.current.task,
    summary: ctx.current.summary || "", tags: ctx.current.tags || [],
    variables: ctx.current.variables || [], prompt: ctx.current.prompt
  };
  const blob = new Blob([JSON.stringify(def, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = (ctx.current.slug || "template") + ".template.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const m = (document.getElementById("msg") as HTMLElement);
  if (m) { m.textContent = "已下载模板 JSON ✓"; setTimeout(() => { if (m) m.textContent = ""; }, 2500); }
}

function toggleSave(): void {
  const id = tplId(ctx.current);
  const doSave = () => {
    if (Store.hasMine(ctx.current.slug)) {
      Store.removeMine(ctx.current.slug);
      (document.getElementById("save-btn") as HTMLButtonElement).textContent = "☆ 收藏到我的模板";
      metricBump(id, "favorite", -1, ctx.current.title, ctx.current.industry);
    } else {
      Store.addMine(ctx.current);
      (document.getElementById("save-btn") as HTMLButtonElement).textContent = "★ 已收藏";
      metricBump(id, "favorite", 1, ctx.current.title, ctx.current.industry);
    }
  };
  // 收藏需登录：未登录收藏只存本机、换设备即丢，不符合「我的专属模板」预期。
  if (!window.Auth || !window.Auth.isAuthed()) {
    const m = (document.getElementById("msg") as HTMLElement);
    if (m) { m.textContent = "收藏需要先登录，登录后才会存入你的专属模板库。"; setTimeout(() => { if (m) m.textContent = ""; }, 3000); }
    if (window.Auth && window.Auth.ensure) {
      window.Auth.ensure().then((tok) => { if (tok) { doSave(); toast("✓ 已登录并收藏"); } });
    }
    return;
  }
  doSave();
}

function openHistory(): void {
  const versions = ctx.current.versions || [];
  if (!versions.length) { toast("暂无历史版本（编辑并保存模板后会自动留存版本）"); return; }
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  const listHtml = versions.map((v: any, i: number) => `
    <div class="card tpl-card" style="margin-top:10px;padding:10px 12px;">
      <div style="font-weight:600;">版本 #${versions.length - i} · ${esc(fmtDateTime(v.ts))}</div>
      <div class="muted" style="font-size:.78rem;margin-top:4px;">${esc((v.snap.summary || "").slice(0, 70) || "(无简介)")} · ${(v.snap.variables || []).length} 个变量</div>
      <div class="flex gap-2 mt-2 flex-wrap items-center">
        <button class="btn btn-ghost btn-sm hist-view" data-i="${i}">查看差异</button>
        <button class="btn btn-primary btn-sm hist-rollback" data-i="${i}">回滚到此版本</button>
      </div>
    </div>`).join("");
  ov.innerHTML = `
    <div class="modal-card card" style="max-width:680px;width:92%;max-height:88vh;overflow:auto;">
      <div class="flex items-center justify-between">
        <div class="ttl">🕑 历史版本（${versions.length}）</div>
        <button id="hist-close" class="btn btn-ghost btn-sm">关闭</button>
      </div>
      <div id="hist-list" class="mt-3">${listHtml}</div>
      <div id="hist-diff" style="margin-top:12px;display:none;"></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if ((e.target as HTMLElement).id === "hist-close" || e.target === ov) close(); });
  ov.querySelectorAll(".hist-view").forEach(b => b.addEventListener("click", () => {
    const v = versions[Number(b.getAttribute("data-i"))];
    const box = ov.querySelector("#hist-diff") as HTMLElement;
    box.style.display = "block";
    box.innerHTML = `<div class="ttl">🔍 该版本 → 当前（<span style="color:#b91c1c;">红=删</span> / <span style="color:#15803d;">绿=增</span>）</div>
      <pre class="code-box" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow:auto;">${diffLines(v.snap.prompt || "", ctx.current.prompt || "")}</pre>`;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));
  ov.querySelectorAll(".hist-rollback").forEach(b => b.addEventListener("click", () => {
    const v = versions[Number(b.getAttribute("data-i"))];
    const s = v.snap;
    ctx.current.title = s.title ?? ctx.current.title;
    ctx.current.summary = s.summary ?? ctx.current.summary;
    ctx.current.industry = s.industry ?? ctx.current.industry;
    ctx.current.task = s.task ?? ctx.current.task;
    ctx.current.prompt = s.prompt ?? ctx.current.prompt;
    ctx.current.variables = s.variables ?? ctx.current.variables;
    Store.addMine(JSON.parse(JSON.stringify(ctx.current)));
    close();
    toast("✓ 已回滚到该版本（并保存为新版本）");
    detail(ctx.current.slug);
  }));
}

// 导入模板逻辑已抽到 views/import.ts（openImportFile / normalizeImport / importTemplate），
// 供详情页、我的模板、顶部导航「导入模板」共用。
