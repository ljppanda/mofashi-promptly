// views/settings.ts — 设置（模型配置 + 登录态）（Component 模式）。
import { ctx } from "../core/ctx.js";
import { esc, toast } from "../core/ui.js";
import { LLM } from "../llm.js";
import { Store } from "../store.js";

export function settings(): void {
  const s = Store.getSettings();
  const provOpts = Object.keys(LLM.PROVIDERS).map(k =>
    `<option value="${k}">${LLM.PROVIDERS[k].label}</option>`
  ).join("");
  ctx.appEl().innerHTML = `
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
    const who = window.Auth!.username || "用户";
    if (authState) authState.textContent = on ? (admin ? `已登录（管理员 ${who}）` : `已登录（${who}）`) : "未登录";
    if (authLoginBtn) authLoginBtn.textContent = on ? "切换账号" : "登录 / 注册";
    if (authLogoutBtn) authLogoutBtn.style.display = on ? "" : "none";
  };
  refreshAuthUI();
  if (authLoginBtn) authLoginBtn.addEventListener("click", async () => {
    const tok = await window.Auth!.ensure();
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
      msg.textContent = "✗ " + ((e as any).message || e);
    } finally {
      btn.disabled = false;
      btn.textContent = "测试连接";
    }
  });
}

// 根据所选服务商刷新“具体模型”下拉 + Secret 显隐 + 备注
function populateModels(p: string): void {
  const prov = LLM.PROVIDERS[p];
  const sel = (document.getElementById("set-model") as HTMLSelectElement);
  const s = Store.getSettings();
  sel.innerHTML = (prov.models || []).map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  if (s.model && (prov.models || []).indexOf(s.model) !== -1) sel.value = s.model;
  const wrap = (document.getElementById("secret-wrap") as HTMLElement);
  if (prov.needSecret) wrap.style.display = "block"; else wrap.style.display = "none";
  const note = prov.note ? `<p class="text-xs text-slate-400 mt-1">${esc(prov.note)}</p>` : "";
  wrap.insertAdjacentHTML("afterend", note);
}
