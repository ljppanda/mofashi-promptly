// core/ui.ts — 纯 UI 工具（Module 模式）：无内部状态、无跨文件依赖，可在任意视图安全复用。

// HTML 转义，防止 XSS（所有用户/模型内容渲染前必过此函数）
export function esc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// token 用量格式化展示
export function fmtUsage(u: any, ms: number): string {
  if (!u) return "";
  const p: string[] = [];
  p.push("输入 " + (u.inputTokens || 0));
  p.push("输出 " + (u.outputTokens || 0));
  if (u.cacheReadTokens) p.push("缓存命中 " + u.cacheReadTokens);
  if (u.cacheCreateTokens) p.push("缓存写入 " + u.cacheCreateTokens);
  if (u.totalTokens) p.push("合计 " + u.totalTokens);
  p.push("耗时 " + (ms / 1000).toFixed(1) + "s");
  return p.join(" · ");
}

// 节点级 token 用量分配明细：把每个 Agent 节点的用量规整为「节点名 输入X/输出Y」，用 · 连接。
// usages 为空 / 非法时返回空串，调用方据此静默降级（不渲染空行、不报错）。
// node 缺失时降级为「节点」占位，保证任意后端版本都能渲染。
export function fmtUsageByNode(usages: any[]): string {
  if (!Array.isArray(usages) || usages.length === 0) return "";
  const parts = usages.map((u) => {
    if (!u || typeof u !== "object") return "";
    const name = u.node ? String(u.node) : "节点";
    return name + " 输入" + (u.inputTokens || 0) + "/输出" + (u.outputTokens || 0);
  }).filter(Boolean);
  return parts.join(" · ");
}

// 热度指标上报（原后端 /metrics 端点已随社区能力一并移除，这里降级为无操作，
// 保留函数签名，避免改动调用方——本地个人工具不再上报任何远程指标）。
export function metricBump(id: string, type: string, delta: number, title: string, industry: string): void {
  /* no-op: 本地个人工具不收集使用指标 */
}

export function metricRate(id: string, score: number, prev: number, title: string, industry: string): void {
  /* no-op: 本地个人工具不收集评分指标 */
}

// 轻量 toast 提示（duration 默认 2800ms，可按需延长，例如分享复制场景给足粘贴时间）
export function toast(msg: string, duration = 2800): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, duration);
}

// 通用二次确认弹窗（替代原生 confirm，风格统一）
// opts: confirmLabel 主按钮文案（默认「删除」）、cancelLabel 次按钮文案（默认「取消」）、
//       danger 主按钮是否危险红（默认 true）、onCancel 点取消/点遮罩时的回调
export function confirmDialog(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean; onCancel?: () => void }
): void {
  const confirmLabel = opts?.confirmLabel ?? "删除";
  const cancelLabel = opts?.cancelLabel ?? "取消";
  const danger = opts?.danger ?? true;
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `
    <div class="modal-card card" style="max-width:380px;">
      <div class="ttl">${esc(title)}</div>
      <p class="slate" style="margin-top:10px;line-height:1.6;font-size:.9rem;">${esc(message)}</p>
      <div class="flex gap-2 mt-4 flex-wrap items-center">
        <button id="cd-yes" class="btn ${danger ? "btn-danger" : "btn-primary"} btn-sm">${esc(confirmLabel)}</button>
        <button id="cd-no" class="btn btn-ghost btn-sm">${esc(cancelLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) { if (opts?.onCancel) opts.onCancel(); close(); } });
  const yes = (document.getElementById("cd-yes") as HTMLButtonElement);
  const no = (document.getElementById("cd-no") as HTMLButtonElement);
  if (no) no.addEventListener("click", () => { if (opts?.onCancel) opts.onCancel(); close(); });
  if (yes) yes.addEventListener("click", async () => {
    yes.disabled = true; yes.style.opacity = ".55";
    try { await onConfirm(); } finally { close(); }
  });
}

// 基础 SEO（C4）：动态设置 document.title + meta description + og 标签
export function setMeta(title: string, desc?: string): void {
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

// 时间戳格式化（版本历史等）
export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 用量看板格式化辅助：任何「上游缺失」都显示「—」，绝不用 0 冒充真实零值（0 会让用户误判为零消耗）。

// 千分位整数（如 34567 → "34,567"）。null/undefined/非有限数 → "—"。
export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

// 成本格式化：$ + 4 位小数（额度可能极小）。null/undefined/非有限数 → "—"。
export function fmtCost(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + n.toFixed(4);
}

// 时延格式化：入参单位是「秒」。null/undefined/非有限数 → "—"。
// < 60s → "25.3s"；>= 60s → "1m5s"。0 有效（显示 "0.0s"）。
export function fmtLatency(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return sec.toFixed(1) + "s";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return m + "m" + s + "s";
}

// 比率（0~1）→ 百分比字符串（如 0.0909 → "9.1%"）。null/undefined/非有限数 → "—"。
export function fmtPct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return (rate * 100).toFixed(1) + "%";
}

// 相对时间（"X 分钟前 / X 小时前 / X 天前"），用于社区新鲜度信号
export function fmtRelative(ts: number | null | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "刚刚";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.floor(h / 24);
  if (d < 30) return d + " 天前";
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo + " 个月前";
  return Math.floor(mo / 12) + " 年前";
}

// 行级文本差异（LCS），用于模板版本对比；返回已转义并带高亮样式的 HTML 片段（红删 / 绿增 / 灰同）
export function diffLines(a: string, b: string): string {
  const A = String(a == null ? "" : a).split("\n");
  const B = String(b == null ? "" : b).split("\n");
  const n = A.length, m = B.length;
  if (n > 1500 || m > 1500) {
    return `<span style="display:block;white-space:pre-wrap;color:#b91c1c;">- ${esc(a)}</span><span style="display:block;white-space:pre-wrap;color:#15803d;">+ ${esc(b)}</span>`;
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(`<span style="display:block;white-space:pre-wrap;color:var(--slate);">  ${esc(A[i])}</span>`); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(`<span style="display:block;white-space:pre-wrap;color:#b91c1c;">- ${esc(A[i])}</span>`); i++; }
    else { out.push(`<span style="display:block;white-space:pre-wrap;color:#15803d;">+ ${esc(B[j])}</span>`); j++; }
  }
  while (i < n) { out.push(`<span style="display:block;white-space:pre-wrap;color:#b91c1c;">- ${esc(A[i])}</span>`); i++; }
  while (j < m) { out.push(`<span style="display:block;white-space:pre-wrap;color:#15803d;">+ ${esc(B[j])}</span>`); j++; }
  return out.join("");
}
