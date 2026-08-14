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
      <div id="change-pw-block" style="margin-top:14px;${LLM.authIsAuthed() && !LLM.isAdmin() ? "" : "display:none;"}">
        <div class="ttl" style="font-size:.95rem;margin-bottom:8px;">🔑 修改密码</div>
        <input id="pw-current" type="password" class="input" style="margin-bottom:6px;" placeholder="当前密码" autocomplete="current-password" />
        <input id="pw-new" type="password" class="input" style="margin-bottom:6px;" placeholder="新密码（至少 8 位）" autocomplete="new-password" />
        <input id="pw-new2" type="password" class="input" style="margin-bottom:6px;" placeholder="确认新密码" autocomplete="new-password" />
        <div class="flex gap-2 items-center">
          <button id="pw-save" class="btn btn-primary btn-sm">保存修改</button>
          <span id="pw-msg" class="text-xs"></span>
        </div>
      </div>
      <p id="change-pw-admin" class="text-xs muted mt-3" style="${LLM.authIsAuthed() && LLM.isAdmin() ? "" : "display:none;"}">管理员口令由服务端 <code style="background:#f0e8d8;padding:1px 5px;border-radius:5px;">APP_ADMIN_PASSPHRASE</code> 配置，无法在界面内修改。</p>
      <p class="text-xs muted mt-2">普通用户开放注册；管理员用服务端 <code style="background:#f0e8d8;padding:1px 5px;border-radius:5px;">.env</code> 的 APP_ADMIN_PASSPHRASE 口令登录（口令匹配也视为管理员）。账号仅用于社区身份与权限，模型 Key 仍保存在本机浏览器。</p>
    </div>
    <div class="card card-pad" style="max-width:560px;margin-top:16px;">
      <label class="block text-sm font-medium mb-1" style="color:var(--slate)">模型服务商</label>
      <select id="set-provider" class="select" style="margin-bottom:16px;">${provOpts}</select>

      <label class="block text-sm font-medium mb-1" style="color:var(--slate)">具体模型</label>
      <div class="flex gap-2 items-center" style="margin-bottom:6px;">
        <select id="set-model" class="select" style="flex:1;margin-bottom:0;"></select>
        <button id="set-fetch-models" class="btn btn-ghost btn-sm" type="button" title="从厂商拉取当前在役模型列表">🔄 拉取真实列表</button>
      </div>
      <input id="set-custom" class="input" style="margin-bottom:4px;" placeholder="或自定义模型名（留空则用上方所选）" value="${esc(s.customModel || "")}">
      <p id="model-note" class="text-xs muted mb-4">选服务商会列出常用模型；点「🔄 拉取真实列表」可从厂商接口实时拉取在役模型（需填 Key），拉取失败时回退到内置清单。也可去控制台复制任意模型 ID 填到“自定义模型名”，完全自由。</p>

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
      <p class="text-xs muted mb-4">开启后，所有 LLM 请求改走该代理的 <code style="background:#f0e8d8;padding:1px 5px;border-radius:5px;">/relay</code> 端点。同源代理可彻底避开浏览器跨域；Key 由代理转发，不暴露给前端直连。</p>

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
  const modelSel = (document.getElementById("set-model") as HTMLSelectElement);
  const modelNote = (document.getElementById("model-note") as HTMLElement);
  const fetchBtn = (document.getElementById("set-fetch-models") as HTMLButtonElement);
  populateModels(providerSel.value);
  // 切换服务商且有 Key 时，自动尝试拉取真实模型列表（无 Key 则保留内置清单）
  providerSel.addEventListener("change", e => {
    document.querySelectorAll("#secret-wrap ~ p.text-xs").forEach(n => n.remove());
    const p = (e.target as HTMLInputElement).value;
    populateModels(p);
    const k = (document.getElementById("set-key") as HTMLInputElement).value.trim();
    if (k) refreshModels(p, k);
  });
  if (fetchBtn) fetchBtn.addEventListener("click", () => {
    const p = providerSel.value;
    const k = (document.getElementById("set-key") as HTMLInputElement).value.trim();
    const sec = (document.getElementById("set-secret") as HTMLInputElement);
    const secret = sec ? sec.value.trim() : "";
    if (!k && p !== "ollama") { modelNote.textContent = "请先填写 API Key，再拉取真实模型列表（Ollama 本机运行可免 Key）。"; modelNote.className = "text-xs mb-4"; modelNote.style.color = "#b91c1c"; return; }
    refreshModels(p, k, secret);
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
    const pwBlock = (document.getElementById("change-pw-block") as HTMLElement);
    const pwAdmin = (document.getElementById("change-pw-admin") as HTMLElement);
    if (pwBlock) pwBlock.style.display = (on && !admin) ? "" : "none";
    if (pwAdmin) pwAdmin.style.display = (on && admin) ? "" : "none";
  };
  refreshAuthUI();
  window.addEventListener("auth-changed", refreshAuthUI);
  if (authLoginBtn) authLoginBtn.addEventListener("click", async () => {
    const tok = await window.Auth!.ensure();
    if (tok) refreshAuthUI();
  });
  if (authLogoutBtn) authLogoutBtn.addEventListener("click", () => {
    LLM.authLogout();
    refreshAuthUI();
    toast("已退出登录");
  });

  // 修改密码（登录后的普通用户）
  const pwSave = (document.getElementById("pw-save") as HTMLButtonElement);
  if (pwSave) pwSave.addEventListener("click", async () => {
    const cur = (document.getElementById("pw-current") as HTMLInputElement);
    const nw = (document.getElementById("pw-new") as HTMLInputElement);
    const nw2 = (document.getElementById("pw-new2") as HTMLInputElement);
    const msg = (document.getElementById("pw-msg") as HTMLElement);
    const current = cur.value, next = nw.value, next2 = nw2.value;
    if (!current || !next) { msg.textContent = "请填写当前密码与新密码"; msg.style.color = "#dc2626"; return; }
    if (next !== next2) { msg.textContent = "两次新密码不一致"; msg.style.color = "#dc2626"; return; }
    if (next.length < 8) { msg.textContent = "新密码至少 8 位"; msg.style.color = "#dc2626"; return; }
    pwSave.disabled = true; pwSave.style.opacity = ".6"; msg.textContent = "保存中…"; msg.style.color = "var(--slate)";
    try {
      await LLM.authChangePassword(current, next);
      msg.textContent = "✓ 密码已更新"; msg.style.color = "#16a34a";
      cur.value = ""; nw.value = ""; nw2.value = "";
    } catch (e) {
      msg.textContent = "✗ " + ((e as any).message || e); msg.style.color = "#dc2626";
    } finally {
      pwSave.disabled = false; pwSave.style.opacity = "1";
    }
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
// liveModels：可选，实时拉取到的在役模型列表（优先于内置清单）
function populateModels(p: string, liveModels?: string[] | null): void {
  const prov = LLM.PROVIDERS[p];
  const sel = (document.getElementById("set-model") as HTMLSelectElement);
  const s = Store.getSettings();
  const list = (liveModels && liveModels.length) ? liveModels : (prov.models || []);
  const prev = sel.value;
  sel.innerHTML = list.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  // 尽量保留用户原本选中的模型：在真实列表里就选中它，否则退回该厂商默认
  if (prev && list.indexOf(prev) !== -1) sel.value = prev;
  else if (s.model && list.indexOf(s.model) !== -1) sel.value = s.model;
  else sel.value = prov.default;
  const wrap = (document.getElementById("secret-wrap") as HTMLElement);
  if (prov.needSecret) wrap.style.display = "block"; else wrap.style.display = "none";
  const note = prov.note ? `<p class="text-xs muted mt-1">${esc(prov.note)}</p>` : "";
  wrap.insertAdjacentHTML("afterend", note);
}

// 从厂商接口实时拉取在役模型列表，成功后替换下拉框选项（失败回退内置清单）
async function refreshModels(p: string, key: string, secret?: string): Promise<void> {
  const btn = (document.getElementById("set-fetch-models") as HTMLButtonElement);
  const note = (document.getElementById("model-note") as HTMLElement);
  if (btn) { btn.disabled = true; btn.style.opacity = ".6"; btn.textContent = "拉取中…"; }
  if (note) { note.textContent = "正在从 " + LLM.PROVIDERS[p].label + " 拉取在役模型列表…"; note.className = "text-xs muted mb-4"; note.style.color = ""; }
  try {
    const ids = await LLM.listModels(p, key, secret, false);
    if (ids && ids.length) {
      populateModels(p, ids);
      if (note) { note.textContent = "✓ 已从 " + LLM.PROVIDERS[p].label + " 拉取 " + ids.length + " 个在役模型（已缓存，下次离线可用）。"; note.className = "text-xs mb-4"; note.style.color = "#15803d"; }
    } else {
      populateModels(p);
      if (note) { note.textContent = "⚠ 未能拉取真实列表（Key 可能无效，或该厂商暂不支持 /models 实时拉取）；已回退内置清单，你也可在“自定义模型名”手填。"; note.className = "text-xs mb-4"; note.style.color = "#b45309"; }
    }
  } catch (e: any) {
    populateModels(p);
    if (note) { note.textContent = "✗ 拉取失败：" + (e && e.message ? e.message : e) + "，已回退内置清单。"; note.className = "text-xs mb-4"; note.style.color = "#b91c1c"; }
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = "1"; btn.textContent = "🔄 拉取真实列表"; }
  }
}
