// mailer.ts — 事务邮件发送（零依赖，优先 Resend，未配置则降级为控制台打印）。
// 设计：密码重置等敏感邮件只发「重置链接」，绝不在邮件里带密码/令牌明文内容之外敏感信息。
//  - 配置了 RESEND_API_KEY → 走 Resend API（纯 fetch，无需装包）；发件人取自 RESEND_FROM，缺省用 Resend 测试发件域。
//  - 未配置 → dev 模式：仅服务端日志打印重置链接，便于本地/自测；生产必须配置，否则用户收不到邮件。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";

const __mailerDir = path.dirname(fileURLToPath(import.meta.url));
const __DATA_DIR = path.resolve(__mailerDir, "..", "data");
// dev 模式下列表：同步落盘重置链接，便于本地点击 + 自动化测试立即拿到（不经 stdout 缓冲）
const DEV_LINK_FILE = path.join(__DATA_DIR, "dev-reset-links.log");

function publicOriginFrom(req?: { headers: any }): string {
  if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL.replace(/\/$/, "");
  if (req && req.headers) {
    const host = req.headers.host;
    const proto = (req.headers["x-forwarded-proto"] as string) || "http";
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost:8000";
}

export function buildResetLink(token: string, req?: { headers: any }): string {
  return `${publicOriginFrom(req)}/?token=${encodeURIComponent(token)}`;
}

export async function sendPasswordResetEmail(email: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const subject = "模法师 Promptly · 密码重置";
  const html = `<p>我们收到了你的密码重置请求。点击下面的链接在 30 分钟内设置新密码：</p>
<p><a href="${link}">${link}</a></p>
<p>如果这不是你本人的操作，忽略此邮件即可，密码不会改变。</p>`;
  if (!apiKey) {
    // dev 降级：明确标注，且提示生产需配置
    log.warn("[DEV 邮件未配置] 密码重置链接（生产请配置 RESEND_API_KEY）：");
    log.warn("  → " + link);
    log.warn("  （收件人 " + email + " 仅本地打印，真实环境会经 Resend 投递）");
    // 同步落盘：stdout 在进程存活期可能不刷新，文件写入确保链接立即可见/可测
    try {
      fs.mkdirSync(__DATA_DIR, { recursive: true });
      fs.appendFileSync(DEV_LINK_FILE, link + "\n");
    } catch (e) {
      log.warn("  （dev 链接落盘失败：" + ((e as any)?.message || e) + "）");
    }
    return;
  }
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: [email], subject, html }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      log.error("Resend 发送失败 " + r.status + "：" + t);
    } else {
      log.info("已向 " + email + " 发送密码重置邮件");
    }
  } catch (e) {
    log.error("Resend 请求异常：" + ((e as any)?.message || e));
  }
}
