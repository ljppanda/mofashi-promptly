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

// 热度指标上报（fire-and-forget，失败静默）
export function metricBump(id: string, type: string, delta: number, title: string, industry: string): void {
  if (!id) return;
  fetch("/metrics/bump", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, type, delta, title, industry }) }).catch(() => {});
}

export function metricRate(id: string, score: number, prev: number, title: string, industry: string): void {
  if (!id) return;
  fetch("/metrics/rate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, score, prev: prev || 0, title, industry }) }).catch(() => {});
}

// 轻量 toast 提示
export function toast(msg: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2800);
}

// 通用二次确认弹窗（替代原生 confirm，风格统一）
export function confirmDialog(title: string, message: string, onConfirm: () => void | Promise<void>): void {
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
