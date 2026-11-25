# 工程笔记：从「能演示」到「可验证」

这份笔记记录一次针对本仓库的系统性整改：不是加功能，而是把已有链路磨到**可验证、可回归、可解释**。
适合面试时用来讲「我发现问题 → 判断优先级 → 落地修复 → 用测试守住」的完整闭环。

## 1. 最严重的问题：重试机制对 HTTP 错误完全失效

**现象**：`providers.ts` 声称对 429/5xx 做指数退避重试，但生产环境从不触发。

**根因**：错误文案是 `[OpenAI] 500 ...`（方括号里是厂商名），而解析函数用 `/\[(\d{3})\]/`
只匹配 `[500]`。单测又恰好用 `new Error("[500] server error")` 构造错误，于是测试全绿、
生产失效——**测试与实现各说各话**。

**修复**：优先读结构化 `err.status`，再从文案提取 4xx/5xx；单测改用真实错误格式，并补 429/401 用例。

**验证**：`tests/resilience.test.ts` 新增 8 个用例；`npm test` 154 通过。

**可讲的点**：发现「假绿测试」比修 bug 本身更有价值——它说明测试在验证实现细节，而不是真实契约。

## 2. 中止语义：半截输出被当成成功

`readSSE` 在 `signal.aborted` 时 `break`，把已收到的部分文本作为成功返回。F2 会接受被截断的提示词。
修复为抛 `AbortError`；同时把「服务端超时」与「用户主动停止」拆开：前者 `TimeoutError` 可重试，后者不可。

## 3. 可观测层拖慢主链路

LangSmith 上报原本 `await` 在生成请求的关键路径上，且 `fetch` 无超时。
改为：run id 本地同步生成、网络 POST/PATCH 后台执行、全部加 `AbortSignal.timeout(3s)`；
用 `pendingCreates` 保证 PATCH 在 POST 之后，避免 404 竞态。对调用方零等待。

## 4. 数据完整性：两份语料长期漂移

`site/src/templates.ts`（干净、380 个变量）与 `server/data/templates.json`（陈旧、变量丢失、
102/102 条重复章节、`# 输出规范` 拼接腐坏）是两份数据。服务端 RAG 一直在用坏的那份。

修复：
- `build-corpus.mjs` 改为 vm 沙箱解析 + 结构校验（占位符 ↔ variables、章节唯一、输出规范非空）；
- `validate-corpus.mjs` 对比源数据与 JSON，任何漂移即失败；
- `npm test` 前置 `corpus:check`，CI 独立跑一次；
- 重新生成：102 条 / 380 个变量 / 0 重复章节。

**可讲的点**：数据问题不是「改几条 JSON」，而是建立**单一数据源 + 自动守门**，否则下次还会漂。

## 5. 评测方法论：从「自证」到「可证伪」

旧评测的问题：
- 关掉 RAG 却在结论里谈完整链路；
- 原版/优化版用同一批目标复测（必然过拟合）；
- 单裁判、单次、无置信区间；
- 裁判 prompt 里的 JSON 示例本身非法（`{"relevance":,`）。

新方案：
- **盲测**：裁判只看「方案甲/乙」，每次重复随机左右顺序；
- **多裁判 + 重复**：多数票；
- **统计**：胜率 + bootstrap 95% CI + 精确符号检验 p 值；
- **留出集**：改写依据只来自 dev，涨分以 holdout 为准，方向不一致提示过拟合；
- **可离线验证**：`npm run eval:chain:dry` 无 Key 跑通全链路。

核心代码抽成 `eval-stats.ts`（纯统计）与 `eval-chain.ts`（随机化/映射/汇总），
10 个离线单测覆盖；CLI 只是薄壳。这样评测本身也是可测试的。

## 6. 部署与安全默认值

- Dockerfile 多阶段 + `npm ci`；补 `COPY public`（Vite 会把 `samples/*.json` 复制进 dist，修复 404）。
- 补上 entrypoint 引用但不存在的 `backup-scheduler.mjs`（原子写 + 保留 N 份）。
- 服务端默认 `HOST=127.0.0.1`；`/relay` 支持 `RELAY_TOKEN`；body 上限 2MB；静态路径用
  `path.relative` 做包含校验；`decodeURIComponent` 异常返回 400 而非未捕获 rejection。
- 请求体超限走 `drain` 而不是 `destroy`：后者会连响应一起掐断，客户端只看到连接重置，
  拿不到 413。该逻辑抽到 `http-body.ts` 并有 4 条离线单测。

## 7. 仍然存在的限制（诚实清单）

- RAG 默认是 hashed n-gram TF-IDF，不是语义检索；bge 语义腿可选且默认关闭。
- 评测场景 33 条，属小样本；报告给出 CI 与 p 值，但不等于终端任务成功率。
- 前端仍无组件级测试；`site/tsconfig` 的 `strict` 仍为 false。
- `/relay` 未设 `RELAY_TOKEN` 时无鉴权，只适合本机/受信网络。

## 8. 验证命令

```bash
cd site/server
npm run typecheck
npm run corpus:check
npm test
npm run eval:chain:dry

cd ..
npm run typecheck
npm run build
```
