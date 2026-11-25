// tests/http-body.test.ts
// 请求体上限回归：超限必须 reject 出 BODY_TOO_LARGE，且**不能 destroy 连接**。
// 背景：destroy 会把响应一起掐断，客户端只看到 fetch failed / 连接重置，拿不到 413。
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readBodyWithLimit } from "../src/http-body.js";

class FakeReq extends EventEmitter {
  destroyed = false;
  resumeCalls = 0;
  destroy() {
    this.destroyed = true;
  }
  resume() {
    this.resumeCalls++;
    return this;
  }
}

test("http-body: 正常请求体按 utf8 返回", async () => {
  const req = new FakeReq();
  const p = readBodyWithLimit(req as any, 1024);
  req.emit("data", Buffer.from("你好", "utf8"));
  req.emit("data", Buffer.from(" world", "utf8"));
  req.emit("end");
  assert.equal(await p, "你好 world");
});

test("http-body: 超限 reject BODY_TOO_LARGE 且不 destroy", async () => {
  const req = new FakeReq();
  const p = readBodyWithLimit(req as any, 8);
  req.emit("data", Buffer.from("123456789"));
  await assert.rejects(p, (e: any) => e?.code === "BODY_TOO_LARGE");
  assert.equal(req.destroyed, false, "超限不应 destroy 连接，否则客户端拿不到 413");
  assert.equal(req.resumeCalls, 1, "应 drain 后续数据");
});

test("http-body: 恰好等于上限可通过", async () => {
  const req = new FakeReq();
  const p = readBodyWithLimit(req as any, 8);
  req.emit("data", Buffer.from("12345678"));
  req.emit("end");
  assert.equal(await p, "12345678");
});

test("http-body: 流错误向上传递", async () => {
  const req = new FakeReq();
  const p = readBodyWithLimit(req as any, 1024);
  req.emit("error", new Error("socket hang up"));
  await assert.rejects(p, /socket hang up/);
});
