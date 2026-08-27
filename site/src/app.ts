// 应用组合根（Composition Root）：仅做编排——哈希路由分发 + 启动。
// 原 2443 行单体 IIFE 已按设计模式拆分为：
//   core/   —— Context(ctx 依赖注入) / Module(ui·steps) / Configuration(config)
//   views/  —— Component(各页面) + Router(本文件)
// 具体渲染逻辑都在各视图模块，本文件不承载业务细节。
// 注：本工具已裁剪为「个人本地提示词生成 + 优化」工具，去掉了社区/账号/排行榜/可观测等模块，
// 故只保留 首页(home) / 行业(i) / 详情(t) / 我的模板(my) / 设置(settings) 路由。
import "./tailwind.css"; // 构建期编译的 Tailwind 工具类（替代 cdn.tailwindcss.com 运行时依赖）

import { ctx } from "./core/ctx.js";
import { home, industry } from "./views/home.js";
import { detail } from "./views/detail.js";
import { myTemplates } from "./views/my.js";
import { settings } from "./views/settings.js";
import { openImportFile } from "./views/import.js";

function route(): void {
  const h = location.hash || "#/";
  // 维护路由栈：首次加载压栈；与栈顶相同忽略；与栈顶下一层相同视为“返回”弹栈；否则前进压栈
  if (ctx.currentHash === null) {
    ctx.routeStack = [h];
    ctx.currentHash = h;
  } else if (h !== ctx.currentHash) {
    if (ctx.routeStack.length >= 2 && h === ctx.routeStack[ctx.routeStack.length - 2]) ctx.routeStack.pop();
    else ctx.routeStack.push(h);
    ctx.currentHash = h;
  }
  const parts = h.replace(/^#\//, "").split("/");
  switch (parts[0]) {
    case "i": industry(decodeURIComponent(parts[1] || "")); break;
    case "t": detail(decodeURIComponent(parts[1] || "")); break;
    case "my": myTemplates(); break;
    case "settings": settings(); break;
    default: home();
  }
}

window.addEventListener("hashchange", route);
// 内联 onclick="goBack()" 依赖全局；把组合根的导航能力挂到 window
window.goBack = ctx.goBack;
const navImport = document.getElementById("nav-import");
if (navImport) navImport.addEventListener("click", openImportFile);
route();
