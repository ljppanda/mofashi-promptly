// 前端全局边界声明。
// 项目采用「原生 ES 模块 + 少量全局挂载」的最低风险工程化方案：
//   - store / templates / llm 改为 export（模块内聚）
//   - 仅 Auth（登录态）、__draft（当前编辑草稿）、goBack（返回）继续挂 window，供内联 onclick 等使用
// 这里声明这些自定义 window 属性，避免 tsc 报 “Property does not exist”。
export {};

declare global {
  interface Window {
    Auth?: {
      token: string;
      username: string;
      role: string;
      isAuthed(): boolean;
      isAdmin(): boolean;
      ensure(): Promise<string | null>;
      logout(): void;
    };
    __draft?: { slug?: string; [key: string]: unknown } | null;
    goBack?: () => void;
    // 允许其它任意自定义属性（历史脚本 / 调试挂载）
    [key: string]: unknown;
  }
}
