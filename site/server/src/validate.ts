// validate.ts — 用户输入长度/规模上限（P1-③ 防超大 payload 打挂服务 / 防异常入参）
// 集中管理，避免各端点散落手写 slice；超限返回错误字符串数组（空=通过），由调用方转 400。

export const LIMITS = {
  TITLE: 200,          // 标题
  PROMPT: 50000,       // 提示词正文（社区分享 / agent refine）
  NOTE: 2000,          // 社区备注
  AUTHOR: 50,          // 作者名
  TAG: 30,             // 单个标签
  TAGS_MAX: 8,         // 标签数量
  SENTENCE: 20000,     // agent generate 的目标描述
  GOAL: 20000,         // agent use / clarify 的目标
  TEMPLATE: 50000,     // 模板（JSON 结构，可能含长文本）
  FEEDBACK: 10000,     // agent refine 的反馈
  CONVERSATION: 50000, // 测试对话记录
  HISTORY: 50000,      // clarify 历史
  ID: 100,             // 各类 id
  INDUSTRY: 50,        // 行业
  PROXY_BASE: 300,     // 代理 base URL
  EMAIL: 254,          // 邮箱（RFC 5321 上限）
  COVER: 3_000_000,    // 封面图（data URL 上限，外链通常远小于此）
} as const;

// 对指定字段做长度/规模校验；字符串按字符数，对象/数组按 JSON 序列化长度近似。
export function checkLengths(obj: Record<string, unknown>, fields: Partial<Record<string, number>>): string[] {
  const errs: string[] = [];
  for (const [field, max] of Object.entries(fields)) {
    const v = obj[field];
    if (v == null) continue;
    if (typeof v === "string") {
      if (v.length > (max as number)) errs.push(`字段「${field}」长度 ${v.length} 超过上限 ${max} 字符`);
    } else if (typeof v === "object") {
      const s = JSON.stringify(v);
      if (s.length > (max as number)) errs.push(`字段「${field}」内容过大（>${max} 字符）`);
    }
  }
  return errs;
}

// 社区发布草稿校验：长文本字段 + 标签结构。
export function validateCommunityDraft(p: any): string[] {
  const errs = checkLengths(p, {
    title: LIMITS.TITLE,
    prompt: LIMITS.PROMPT,
    note: LIMITS.NOTE,
    author: LIMITS.AUTHOR,
    industry: LIMITS.INDUSTRY,
    cover: LIMITS.COVER,
  });
  // 封面：仅允许 http(s) 外链或 data:image 图片（防止注入非图片内容）；空串/缺省放行
  if (typeof p?.cover === "string" && p.cover) {
    const c = p.cover;
    const ok = /^https?:\/\//i.test(c) || /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,/i.test(c);
    if (!ok) errs.push("封面仅支持 http(s) 图片链接或 data:image 图片");
  }
  if (Array.isArray(p?.tags)) {
    if (p.tags.length > LIMITS.TAGS_MAX) errs.push(`标签数量超过上限 ${LIMITS.TAGS_MAX}`);
    for (const t of p.tags) {
      if (typeof t !== "string" || t.length > LIMITS.TAG) errs.push(`标签项过长（>${LIMITS.TAG} 字符）`);
    }
  } else if (p?.tags != null) {
    errs.push("tags 必须是字符串数组");
  }
  return errs;
}
