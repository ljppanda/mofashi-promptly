// node:sqlite 是 Node 22 的实验性内置模块，@types/node 未必声明，这里给最小可用类型，
// 仅为让 tsc 通过；运行时由 Node 实际提供 DatabaseSync / StatementSync。
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
    [key: string]: unknown;
  }
  export class StatementSync {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): any;
    all(...params: unknown[]): any[];
    [key: string]: unknown;
  }
  export const constants: Record<string, unknown>;
  export function backup(...args: unknown[]): unknown;
}
