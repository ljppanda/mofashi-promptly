// views/models.ts — 公开「模型支持」矩阵页（Component 模式）。
// 竞品监控报告 r8 #4：把 F6/F12 已接入的 19 家厂商 + 真实模型清单做成公开信任落地页，
// 并把「Key 仅存浏览器本地、平台不训练你的数据」做成隐私卖点。纯前端、零 schema、复用 LLM.PROVIDERS + LLM.listModels。
import { LLM } from "../llm.js";
import { Store } from "../store.js";
import { esc, toast } from "../core/ui.js";
import { ALL_INDUSTRIES } from "../core/config.js";

export function modelsPage(): void {
  const root = document.getElementById("app") as HTMLElement | null;
  if (!root) return;
  const providers = LLM.PROVIDERS;
  const keys = Object.keys(providers);

  root.innerHTML = `
    <section class="section" style="padding-top:26px;">
      <a href="#/" class="back-link">‹ 返回首页</a>
      <h1 class="section-title" style="margin-top:10px;">🧩 支持的模型</h1>
      <p class="section-sub">${keys.length} 家主流大模型厂商直连，你的 API Key 只存浏览器本地——平台不托管额度、不拿你的数据训练。</p>

      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 18px;">
        <span style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:999px;padding:6px 12px;font-size:.85rem;">🔒 <b>隐私优先</b>：Key 永不离开你的设备</span>
        <span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:999px;padding:6px 12px;font-size:.85rem;">🧩 <b>${keys.length}</b> 家厂商 · 用户自带 Key 即用</span>
        <span style="background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe;border-radius:999px;padding:6px 12px;font-size:.85rem;">🛡️ 服务端白名单转发（SSRF 防护）</span>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
        <button id="models-fetch" class="btn btn-ghost btn-sm" type="button" title="从厂商接口实时拉取当前设置厂商的在役模型">🔄 拉取当前设置厂商的真实在役模型</button>
        <a href="#/settings" class="btn btn-primary btn-sm">去设置填 Key →</a>
      </div>

      <!-- 合规与数据主权（报告 r10 #7：强化 B 端/团队信任） -->
      <div style="border:1px solid #e2e8f0;border-radius:14px;padding:16px;background:#f8fafc;margin-bottom:18px;">
        <h2 class="section-title" style="font-size:1.05rem;margin-bottom:10px;">🛡️ 数据不出域 · 合规说明</h2>
        <ul style="line-height:1.9;padding-left:20px;font-size:.88rem;margin:0;color:#334155;">
          <li><b>Key 永不离开你的设备</b>：API Key 只存浏览器 <code>localStorage</code>，服务端收不到、不托管、不落库。</li>
          <li><b>调用直连厂商</b>：你的提示词与内容经服务端<b>白名单转发</b>（仅放行厂商公网域名，拒绝内网/私有地址，防 SSRF），不经任何第三方训练。</li>
          <li><b>自托管友好</b>：整套站点可私有化部署在你自己的服务器，数据完全自主。</li>
          <li><b>社区内容审核</b>：公开模板经 AI 软审核 + 人工审核台 + 用户举报三重把关。</li>
        </ul>
        <div class="muted" style="font-size:.78rem;margin-top:10px;">说明：本页为产品信任陈述，非法律合规意见书；若用于受监管行业（金融 / 医疗 / 政务），请结合自身合规要求评估。</div>
      </div>

      <!-- 行业场景占位墙（r10 #7：增强 B 端场景联想） -->
      <div style="margin-bottom:18px;">
        <div class="muted" style="font-size:.82rem;margin-bottom:8px;">已覆盖的场景（模板可按行业筛选）：</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${ALL_INDUSTRIES.map((b) => `<span style="background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:5px 12px;font-size:.8rem;color:#475569;">${esc(b)}</span>`).join("")}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;">
        ${keys.map((k) => providerCard(k, providers[k])).join("")}
      </div>

      <p class="muted" style="font-size:.8rem;margin-top:20px;line-height:1.7;">
        以上为内置常用模型清单（基于 2026-07 各厂商在役最新版核查，仅作参考，具体 ID 以厂商控制台为准）。
        在「设置」填 Key 后点「🔄 拉取真实列表」可从厂商接口实时拉取在役模型（含最新旗舰）；
        也可在「自定义模型名」手填任意模型 ID，完全自由，不受内置清单限制。
      </p>
    </section>
  `;

  const btn = document.getElementById("models-fetch") as HTMLButtonElement | null;
  if (btn) btn.addEventListener("click", () => fetchLive(btn));
}

// 单个厂商卡片：展示 label / note / 内置模型清单 / 默认模型
function providerCard(k: string, p: any): string {
  const models: string[] = p.models || [];
  return `
    <div class="model-card" data-provider="${esc(k)}" style="border:1px solid #e2e8f0;border-radius:14px;padding:14px;background:#fff;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span style="font-weight:700;color:#0f172a;">${esc(p.label)}</span>
        ${p.needSecret ? '<span class="pill pill-amber" style="font-size:.7rem;">需 Secret</span>' : ""}
      </div>
      ${p.note ? `<div class="muted" style="font-size:.74rem;margin-top:6px;line-height:1.5;">${esc(p.note)}</div>` : ""}
      <div class="model-list" id="ml-${esc(k)}" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
        ${models.map((m) => `<code style="background:#f1f5f9;color:#334155;border-radius:6px;padding:2px 7px;font-size:.72rem;">${esc(m)}</code>`).join("")}
      </div>
      <div class="model-foot muted" id="mf-${esc(k)}" style="font-size:.72rem;margin-top:10px;">内置 ${models.length} 个常用模型 · 默认 ${esc(p.default || "—")}</div>
    </div>
  `;
}

// 复用 F12 的 LLM.listModels，对当前设置厂商拉取实时在役模型并刷新对应卡片
async function fetchLive(btn: HTMLButtonElement): Promise<void> {
  const s = Store.getSettings();
  const prov = s.provider || "openai";
  if (!s.key) {
    toast("请先在「设置」填写 API Key，再拉取真实模型列表");
    return;
  }
  const original = btn.textContent || "";
  btn.disabled = true;
  btn.textContent = "拉取中…";
  try {
    const ids = await LLM.listModels(prov, s.key, s.secret);
    const card = document.querySelector(`.model-card[data-provider="${cssEscape(prov)}"]`);
    if (card) {
      const ml = card.querySelector(".model-list") as HTMLElement | null;
      const mf = card.querySelector(".model-foot") as HTMLElement | null;
      if (ml) ml.innerHTML = ids.map((m: string) => `<code style="background:#ecfdf5;color:#047857;border-radius:6px;padding:2px 7px;font-size:.72rem;">${esc(m)}</code>`).join("");
      if (mf) mf.textContent = `实时拉取 ${ids.length} 个在役模型`;
    }
    toast(`✓ 已拉取 ${LLM.PROVIDERS[prov]?.label || prov} 真实在役模型（${ids.length} 个）`);
  } catch (e: any) {
    toast(`⚠ ${LLM.PROVIDERS[prov]?.label || prov} 拉取失败：${e?.message || e}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// 简单 CSS 转义（厂商 key 均为字母，无需复杂处理，但保留防御性）
function cssEscape(v: string): string {
  return v.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
