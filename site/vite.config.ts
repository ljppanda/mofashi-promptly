import { defineConfig } from "vite";

// 模法师-Promptly 前端工程化配置
// 设计原则：最低风险。保留原生 ES 模块 + 全局边界（window.Auth / window.__draft），
// 仅用 Vite 做「开发服务器 + 生产打包」，不引入运行时框架。
export default defineConfig({
  root: ".",
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
    assetsInlineLimit: 4096,
  },
  server: {
    port: 5173,
    // 开发模式下把 API / Agent / 社区 / 可观测 等请求代理到 Node 后端（默认 8000），
    // 避免浏览器跨域，无需后端单独配 CORS 即可联调。
    proxy: {
      "/api": "http://localhost:8000",
      "/agent": "http://localhost:8000",
      "/relay": "http://localhost:8000",
      "/community": "http://localhost:8000",
      "/metrics": "http://localhost:8000",
      "/traces": "http://localhost:8000",
      "/healthz": "http://localhost:8000",
    },
  },
});
