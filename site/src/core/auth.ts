// core/auth.ts — 鉴权（Module 模式）。
// window.Auth 作为全局登录态，供内联 onclick 与「设置」页直接使用；applyAuth / 弹窗为模块内部实现。
import { LLM } from "../llm.js";
import { toast } from "./ui.js";

function applyAuth(r: any) {
  window.Auth!.token = r.token || "";
  window.Auth!.username = r.username || "";
  window.Auth!.role = r.role || "user";
  try {
    localStorage.setItem("ppt_auth", window.Auth!.token);
    localStorage.setItem("ppt_auth_user", window.Auth!.username);
    localStorage.setItem("ppt_auth_role", window.Auth!.role);
  } catch { /* ignore */ }
  // 通知所有监听登录态的视图刷新（注册/登录成功后界面立即同步）
  try { window.dispatchEvent(new Event("auth-changed")); } catch { /* ignore */ }
}

function openLoginModal(): Promise<string | null> {
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
        <div class="muted" style="font-size:.76rem;margin-top:6px;"><a id="auth-forgot" href="javascript:;" style="color:#64748b;">忘记密码？</a></div>
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
    const forgot = (document.getElementById("auth-forgot") as HTMLAnchorElement);
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
    if (forgot) forgot.addEventListener("click", (e) => {
      e.preventDefault();
      toast("当前为本地账号，密码经 scrypt 加盐哈希存储、不可逆，无法重置。如需更换身份，请直接注册新账号。");
    });
    setTimeout(() => { if (userEl) userEl.focus(); }, 30);
  });
}

function openRegisterModal(): Promise<string | null> {
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
        toast("✓ 注册成功，已自动登录：" + (r.username || username));
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
