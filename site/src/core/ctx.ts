// core/ctx.ts — 应用上下文（Context / 依赖注入模式）。
// 集中持有跨视图共享的可变状态与导航能力，视图通过它访问，取代原 IIFE 闭包耦合。
export interface AppCtx {
  // DOM 根 & 导航
  appEl(): HTMLElement;
  navigate(hash: string): void;
  goBack(): void;

  // 共享可变状态
  current: any;                                  // 当前详情页模板（深层拷贝）
  genController: AbortController | null;          // F1 生成中断控制器
  useController: AbortController | null;          // F2 代写中断控制器
  useQa: any[];                                  // 访谈已确认问答
  useRound: number;                              // 访谈当前轮次
  runController: AbortController | null;         // 运行提示词中断控制器（预留）
  testMessages: any[];                           // 模板详情页测试沙盒对话
  testController: AbortController | null;        // 模板详情页测试中断控制器
  refineController: AbortController | null;      // F5 改写中断控制器
  refineCtx: any;                                // 当前改写上下文（模板版 / 社区版）
  cState: { msgs: any[]; ctl: AbortController | null }; // 社区详情页测试沙盒状态
  cCurrentPrompt: string;                        // 社区测试中当前提示词
  routeStack: string[];                          // 路由栈：返回用
  currentHash: string | null;                    // 上次路由 hash
  currentSort: string;                           // 热度榜排序维度
  activeStepKey: string;                         // 状态机当前步
  thinkLog: Record<string, string[]>;            // 各步思考日志
}

// 工厂函数：延迟构造以避免「在初始化前引用 ctx」的问题，同时符合 Factory 模式。
function makeCtx(): AppCtx {
  const c: AppCtx = {
    appEl: () => document.getElementById("app") as HTMLElement,
    navigate: (hash: string) => { location.hash = hash; },
    goBack: () => {
      if (c.routeStack.length >= 2) location.hash = c.routeStack[c.routeStack.length - 2];
      else location.hash = "#/";
    },
    current: null,
    genController: null,
    useController: null,
    useQa: [],
    useRound: 0,
    runController: null,
    testMessages: [],
    testController: null,
    refineController: null,
    refineCtx: null,
    cState: { msgs: [], ctl: null },
    cCurrentPrompt: "",
    routeStack: [],
    currentHash: null,
    currentSort: "heat",
    activeStepKey: "",
    thinkLog: {},
  };
  return c;
}

export const ctx: AppCtx = makeCtx();
