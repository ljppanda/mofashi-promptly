// http-body.ts
// 带大小上限的请求体读取。抽成独立模块是为了能离线单测：
// 超限时必须「drain 而不是 destroy」——destroy 会连响应一起掐断，客户端只看到
// 连接重置，拿不到 413；drain 让上层还有机会写回结构化错误。
import type { IncomingMessage } from "node:http";

export interface BodyLimitError extends Error {
  code: "BODY_TOO_LARGE";
}

export function bodyTooLarge(maxBytes: number): BodyLimitError {
  return Object.assign(new Error(`请求体超过上限（${maxBytes} bytes）`), {
    code: "BODY_TOO_LARGE" as const,
  });
}

export function readBodyWithLimit(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on("data", (c: Buffer) => {
      if (settled) return;
      size += c.length;
      if (size > maxBytes) {
        fail(bodyTooLarge(maxBytes));
        // 关键：不要 req.destroy()。丢弃后续数据即可，让调用方正常写 413。
        req.resume();
        return;
      }
      chunks.push(c);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (err) => fail(err));
  });
}
