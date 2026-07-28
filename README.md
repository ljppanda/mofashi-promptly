# 模法师 · Promptly

> 把"写好一段提示词"升级为"沉淀可复用的提示词模板资产"。

**模法师（Promptly）** 是一个**提示词模板生成器**：先由 AI 生成"带占位符的结构化模板骨架"（F1），再按你的具体目标把模板实例化为可直接使用的成品提示词（F2）。模板是可参数化、可复用、可组合的资产，而不只是一段一次性文本。

---

## 为什么不一样（核心亮点）

- **两阶段范式 F1 → F2**：区别于大多数"把写好的提示词存起来分享 / 售卖"的平台，Promptly 把"模板"和"实例"分开。模板是带 `{{占位符}}` 的结构化骨架，实例是按目标填槽的结果——模板可被反复复用、组合、版本化。这是项目的差异化核心。
- **本地优先 / 隐私友好**：模型 API Key 只存在浏览器本地（`localStorage`），用户用自己的额度调用大模型，数据不上交平台去买额度。
- **可自托管**：整套服务可私有化部署，数据完全自控，适合企业内网、个人数据不出域等合规场景。
- **真实多用户 + 作者身份服务端绑定**：开放注册（`scrypt` 加盐哈希），发布时服务端强制绑定作者，杜绝伪造；"我的发布"按作者过滤。
- **内置 RAG 检索增强**：默认词法召回，可选开启 bge 语义向量 + RRF 混合召回 + cross-encoder 重排（联网首次下载模型即激活）。
- **生产级安全基线**：鉴权、SSRF 防护、CSP/XSS 收口、SQLite WAL、输入长度校验、速率限制、结构化日志、进程优雅退出、Docker、CI 均已落地。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vite + TypeScript（零运行时框架，原生 ES 模块）+ Tailwind（CDN） |
| 后端 | Node 22 + TypeScript（`tsx` 运行），内置 `node:sqlite` 单文件数据库 |
| Agent | LangGraph `StateGraph`：`clarify → draft → validate →（不通过则回流 draft） → finalize` |
| RAG | LlamaIndex + LanceDB；词法默认 + 可选 bge 语义（RRF 混合）+ 可选 reranker |
| 大模型 | 21 家主流 LLM 厂商预置接入（OpenAI / DeepSeek / Kimi / 智谱 / 通义 / 豆包 / 混元 / Claude / Gemini / 文心 等），**用户自带 Key** |
| 可观测（可选） | LangSmith 云端 trace |
| 部署 | Docker + docker-compose，反代（Caddy / Nginx）做 TLS |

---

## 架构概览

```
浏览器(SPA) ──HTTP/JSON──▶ Node 后端(:8000)
                            ├─ /api/auth     双轨鉴权（管理员口令 + 开放注册）
                            ├─ /agent        模板生成 Agent（LangGraph）
                            ├─ /relay        带白名单的 LLM 转发（SSRF 防护）
                            ├─ /community    社区（发布 / 评分 / 收藏 / 举报 / 审核台）
                            ├─ rag           LlamaIndex + LanceDB 检索增强
                            └─ node:sqlite   单文件持久化（WAL）
```

---

## 快速开始

### 本地开发（前后端分离）
```bash
# 后端（监听 :8000）
cd site/server && npm install && npm start

# 前端开发服务器（:5173，/api 等自动代理到 :8000，免跨域联调）
cd site && npm install && npm run dev
```

### 生产构建 + 运行（单进程托管前端静态）
```bash
cd site && npm install && npm run build     # 产出 site/dist
cd site/server && npm install && npm start  # 后端自动托管 dist
# 打开 http://localhost:8000
```

### Docker（含构建期内打包前端）
```bash
docker compose up -d --build
```

---

## 配置

复制 `site/server/.env.example` 为 `site/server/.env` 后按需填写。核心项：

- `APP_ADMIN_PASSPHRASE`：管理员口令（**建议必填**，留空则每次启动生成临时口令）。
- `RAG_EMBEDDING` / `RAG_RERANKER`：语义检索开关（首次需联网下载模型）。
- `MODERATION_PROVIDER` / `MODERATION_MODEL` / `MODERATION_API_KEY`：社区 AI 审核（公网建议开启）。
- `LANGSMITH_*`：可选链路追踪。

> ⚠️ 安全提示：`.env`、会话密钥 `.app_secret`、数据库 `*.db*`、向量库 `lancedb/`、构建产物 `dist/`、`node_modules/` 均已在 `.gitignore` 中排除，**切勿提交**。

---

## 安全与加固

- **鉴权**：HMAC-SHA256 会话令牌（有效期 30 天）；普通用户闸（发布 / 评分 / 收藏 / 举报 / 删除）+ 管理员闸（公开 / 下架 / 审核台 / 处理举报 / metrics 重置）。
- **SSRF**：`/relay` 仅允许 LLM 厂商公网域名白名单 + DNS 解析后拒绝私有 / 环回 / 链路本地地址（fail closed）。
- **XSS / CSP**：模型输出走 `textContent`，用户输入统一转义；统一 CSP + `X-Frame-Options` + `nosniff` + `no-referrer`。
- **数据**：SQLite WAL + `busy_timeout` 防并发写锁；集中输入长度校验。
- **韧性**：内存固定窗口速率限制（全局 240/min，注册 5/h，relay 30/min）；结构化日志（`LOG_FORMAT=json` 可切 JSON 行便于采集）。

---

## 项目状态与路线图

**当前状态**：具备产品骨架的**可内测原型**——功能链路、多用户、鉴权、安全加固、CI 齐备，可自用 / 小范围内测；尚非公网规模产品。

**后续改进方向（按优先级）**：

1. **公网就绪**：注册强防护（Turnstile 验证码 / 邮箱验证）、TLS 反代、schema 迁移 + 定时备份（含 WAL 伴随文件）、可观测（Sentry）、LLM 调用韧性（重试退避 / 主备 provider）。
2. **社区闭环**：评论、去重、作者主页、内容发现 / SEO。
3. **深化两阶段模板资产化（差异化核心）**：模板版本管理、参数化组合、复用市场、引用关系。
4. **工程打磨**：`tsc` 类型全绿、移动端适配、前端组件化。
5. **语义 RAG 真实联网启用**与索引预热。

---

## 许可证

许可证待定（默认保留所有权利，欢迎 Fork 学习；如需商用请先联系作者）。
