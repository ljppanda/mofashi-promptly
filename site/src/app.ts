// app.ts — 应用组合根：哈希路由分发 + 启动，业务渲染逻辑分散在各视图模块。
// 已裁剪为「个人本地提示词生成 + 优化」工具，仅保留 home / i / t / my / stats / settings 路由。
import "./tailwind.css"; // 构建期编译的 Tailwind 工具类（替代 cdn.tailwindcss.com 运行时依赖）

import { ctx } from "./core/ctx.js";
import { home, industry, templateLibrary } from "./views/home.js";
import { detail } from "./views/detail.js";
import { myTemplates } from "./views/my.js";
import { settings } from "./views/settings.js";
import { stats } from "./views/stats.js";
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
    case "all": templateLibrary(); break;
    case "t": {
      // 防御：#/t 缺 slug 时（历史链接误指向此处）落到模板库，而不是打开一个空详情页报错
      const slug = decodeURIComponent(parts[1] || "");
      if (slug) detail(slug); else templateLibrary();
      break;
    }
    case "my": myTemplates(); break;
    case "stats": stats(); break;
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
