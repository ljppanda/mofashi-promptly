// auth.ts — 鉴权（P0-① + 真实多用户账号）
// 设计：双轨制
//   1) 超级管理员：由 APP_ADMIN_PASSPHRASE 口令登录（虚拟 id 'admin'，role 'admin'）。
//      向后兼容原有「单管理员口令」模型，且永不锁死你自己。
//   2) 普通用户：开放注册 / 用户名+密码登录（role 'user'），密码用 scrypt 加盐哈希存储。
// 会话令牌：HMAC-SHA256(base64url(payload)).sig，payload 含 sub(用户id|'admin')/role/iat/exp(30天)。防篡改、可过期。
// 普通用户写操作只需有效令牌；管理员操作（公开/下架/审核台/metrics重置）需 role==='admin'。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createUser, getUserByUsername, getUserById, userExists, updateUserPassword, getUserByEmail, emailExists, createResetToken, getValidResetToken, consumeResetToken } from "./db.js";
import { sendPasswordResetEmail, buildResetLink } from "./mailer.js";
import { LIMITS } from "./validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const SECRET_FILE = path.join(DATA_DIR, ".app_secret");
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

// ---------- 密钥（持久化，重启稳定）----------
function loadSecret(): string {
  try {
    if (process.env.APP_SECRET) return process.env.APP_SECRET;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SECRET_FILE)) {
      const s = fs.readFileSync(SECRET_FILE, "utf8").trim();
      if (s) return s;
    }
    const s = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  } catch {
    return crypto.randomBytes(32).toString("hex");
  }
}
const SECRET = loadSecret();

// ---------- 超级管理员口令（启动可生成临时口令）----------
function loadPassphrase(): string {
  if (process.env.APP_ADMIN_PASSPHRASE) return process.env.APP_ADMIN_PASSPHRASE;
  const p = crypto.randomBytes(9).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  log.warn(`未设置 APP_ADMIN_PASSPHRASE，本次临时管理员口令：${p}`);
  log.warn("生产环境请在 .env 设置 APP_ADMIN_PASSPHRASE（或环境变量），否则重启后口令会变。");
  return p;
}
const PASSPHRASE = loadPassphrase();

// ---------- 密码哈希（scrypt 加盐）----------
function makeSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}
function hashPassword(pw: string, salt: string): string {
  return crypto.scryptSync(pw, salt, 64).toString("hex");
}
function verifyPassword(pw: string, salt: string, hash: string): boolean {
  const expected = Buffer.from(hashPassword(pw, salt), "hex");
  const actual = Buffer.from(hash, "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

// ---------- base64url 工具 ----------
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}
function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// ---------- 令牌签发 / 校验 ----------
interface TokenPayload { sub: string; role: string; iat: number; exp: number; }
function sign(payloadObj: TokenPayload): string {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyToken(token: string | undefined | null): TokenPayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenPayload;
    if (!obj.exp || Date.now() > obj.exp) return null;
    if (!obj.sub || !obj.role) return null;
    return obj;
  } catch {
    return null;
  }
}

/** 从请求头提取并校验令牌，返回 payload（任意有效用户/管理员），无效返回 null。 */
export function authPayload(req: IncomingMessage): TokenPayload | null {
  const h = req.headers["x-auth-token"];
  if (typeof h === "string" && h) return verifyToken(h);
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return verifyToken(auth.slice(7).trim());
  return null;
}
/** 任意已登录用户（普通或管理员）即可通行的闸门。 */
export function verifyRequestToken(req: IncomingMessage): boolean {
  return authPayload(req) !== null;
}
/** 仅管理员（role==='admin'）可通过的闸门。 */
export function verifyAdminToken(req: IncomingMessage): boolean {
  const p = authPayload(req);
  return !!p && p.role === "admin";
}

function sendJSON(res: ServerResponse, code: number, obj: unknown) {
  const req = res.req as IncomingMessage;
  const origin = req.headers.origin;
  let allow = "";
  if (origin) { try { if (new URL(origin).host === req.headers.host) allow = origin; } catch { /* ignore */ } }
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": allow, "vary": "origin" });
  res.end(JSON.stringify(obj));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function issueToken(sub: string, role: string, username: string) {
  const now = Date.now();
  const token = sign({ sub, role, iat: now, exp: now + TOKEN_TTL_MS });
  return { token, role, username, expiresAt: now + TOKEN_TTL_MS };
}

/** POST /api/auth/login  { passphrase } 或 { username, password }
 *  - 仅传 passphrase（或与 username='admin' 配对口令）→ 超级管理员登录
 *  - 传 username+password → 普通用户登录（口令匹配则也视为管理员）
 */
export async function handleAuthLogin(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  let p: any;
  try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const passphrase = String(p.passphrase || "");
  const username = String(p.username || "").trim();
  const password = String(p.password || "");

  // 超级管理员（口令）
  if ((!username && passphrase) || (username === "admin" && password === PASSPHRASE) || (passphrase && password === PASSPHRASE)) {
    if (passphrase !== PASSPHRASE && password !== PASSPHRASE) return sendJSON(res, 401, { error: "口令错误" });
    return sendJSON(res, 200, issueToken("admin", "admin", "admin"));
  }

  // 普通用户
  if (!username || !password) return sendJSON(res, 400, { error: "请输入用户名和密码" });
  const u = getUserByUsername(username);
  if (!u || u.status !== "active") return sendJSON(res, 401, { error: "用户名或密码错误" });
  if (!verifyPassword(password, u.salt, u.passHash)) return sendJSON(res, 401, { error: "用户名或密码错误" });
  return sendJSON(res, 200, issueToken(u.id, u.role, u.username));
}

/** POST /api/auth/register  { username, password, email } → 创建普通用户并自动登录 */
export async function handleAuthRegister(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  let p: any;
  try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const username = String(p.username || "").trim();
  const password = String(p.password || "");
  const email = String(p.email || "").trim().toLowerCase();
  // —— 人机验证（Cloudflare Turnstile）：公网部署必须配置 TURNSTILE_SECRET_KEY；未配置时降级放行（仅告警）——
  const turnstileToken = String(p.turnstileToken || "");
  const tsSecret = process.env.TURNSTILE_SECRET_KEY;
  if (tsSecret) {
    if (!turnstileToken) return sendJSON(res, 400, { error: "请先完成人机验证" });
    try {
      const ip = String((req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket.remoteAddress || "").trim();
      const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: tsSecret, response: turnstileToken, remoteip: ip }).toString(),
      });
      const vj = (await vr.json()) as any;
      if (!vj.success) return sendJSON(res, 403, { error: "人机验证未通过，请重试" });
    } catch (e) {
      console.error("[auth] Turnstile 校验失败：", (e as Error)?.message);
      return sendJSON(res, 503, { error: "人机验证服务暂不可用，请稍后重试" });
    }
  } else {
    console.warn("[auth] TURNSTILE_SECRET_KEY 未配置，注册跳过人机验证（公网部署前请配置 Cloudflare Turnstile）");
  }
  if (!/^[\w一-龥]{3,30}$/.test(username)) return sendJSON(res, 400, { error: "用户名需 3-30 位（字母/数字/下划线/中文）" });
  if (username.toLowerCase() === "admin") return sendJSON(res, 400, { error: "该用户名保留" });
  if (password.length < 8) return sendJSON(res, 400, { error: "密码至少 8 位" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 400, { error: "邮箱格式不正确" });
  if (email.length > LIMITS.EMAIL) return sendJSON(res, 400, { error: "邮箱过长" });
  if (userExists(username)) return sendJSON(res, 409, { error: "用户名已存在" });
  if (emailExists(email)) return sendJSON(res, 409, { error: "该邮箱已注册" });
  const salt = makeSalt();
  const u = createUser(username, hashPassword(password, salt), salt, "user", email);
  return sendJSON(res, 200, issueToken(u.id, u.role, u.username));
}

/** POST /api/auth/change-password { current, next } → 已登录普通用户修改自己的密码（需有效令牌） */
export async function handleAuthChangePassword(req: IncomingMessage, res: ServerResponse) {
  const p = authPayload(req);
  if (!p) return sendJSON(res, 401, { error: "请先登录" });
  // 管理员是虚拟身份（由服务端口令登录），没有 users 行，密码无法在此修改
  if (p.sub === "admin") return sendJSON(res, 400, { error: "管理员口令由服务器配置（APP_ADMIN_PASSPHRASE），请在服务端环境变量修改，无法在界面内更改" });
  const raw = await readBody(req);
  let b: any;
  try { b = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const current = String(b.current || "");
  const next = String(b.next || "");
  if (next.length < 8) return sendJSON(res, 400, { error: "新密码至少 8 位" });
  const u = getUserById(p.sub);
  if (!u || u.status !== "active") return sendJSON(res, 404, { error: "用户不存在或已停用" });
  const full = getUserByUsername(u.username);
  if (!full || !verifyPassword(current, full.salt, full.passHash)) return sendJSON(res, 401, { error: "当前密码错误" });
  const salt = makeSalt();
  updateUserPassword(u.id, hashPassword(next, salt), salt);
  return sendJSON(res, 200, { ok: true });
}

/** POST /api/auth/forgot-password { email } → 标准邮箱重置：发带时效令牌的链接。
 *  枚举防护：无论邮箱是否存在/格式对错，统一返回相同成功提示，不泄露账号是否存在。 */
export async function handleAuthForgotPassword(req: IncomingMessage, res: ServerResponse) {
  const okMsg = { ok: true, message: "若该邮箱已注册，重置链接已发送，请查收邮件（30 分钟内有效）。" };
  const raw = await readBody(req);
  let p: any;
  try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 200, okMsg); }
  const email = String(p.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 200, okMsg); // 格式不对也静默返回，避免被探
  const u = getUserByEmail(email);
  if (u && u.status === "active") {
    const rawTok = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawTok).digest("hex");
    createResetToken(u.id, tokenHash, Date.now() + 30 * 60 * 1000);
    const link = buildResetLink(rawTok, req);
    await sendPasswordResetEmail(email, link);
  }
  return sendJSON(res, 200, okMsg);
}

/** POST /api/auth/reset-password { token, next } → 凭有效令牌设置新密码（令牌单次使用 + 时效）。 */
export async function handleAuthResetPassword(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  let p: any;
  try { p = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
  const token = String(p.token || "");
  const next = String(p.next || "");
  if (next.length < 8) return sendJSON(res, 400, { error: "新密码至少 8 位" });
  if (!token) return sendJSON(res, 400, { error: "重置令牌缺失" });
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const rec = getValidResetToken(tokenHash);
  if (!rec) return sendJSON(res, 400, { error: "重置链接无效或已过期，请重新申请" });
  const u = getUserById(rec.userId);
  if (!u || u.status !== "active") { consumeResetToken(tokenHash); return sendJSON(res, 400, { error: "账户不可用" }); }
  const salt = makeSalt();
  updateUserPassword(u.id, hashPassword(next, salt), salt);
  consumeResetToken(tokenHash);
  return sendJSON(res, 200, { ok: true });
}

/** GET /api/auth/me → 当前登录身份（角色/用户名） */
export async function handleAuthMe(req: IncomingMessage, res: ServerResponse) {
  const p = authPayload(req);
  if (!p) return sendJSON(res, 401, { error: "未授权" });
  let username = p.sub;
  if (p.sub !== "admin") {
    const u = getUserById(p.sub);
    if (u) username = u.username;
  }
  return sendJSON(res, 200, { authed: true, sub: p.sub, role: p.role, username });
}
