import type { StreamEvent } from './types';

type Listener = (e: StreamEvent) => void;

/**
 * 全局单例容器。
 * 两个原因必须挂 globalThis：
 * 1. Next dev 下模块会被热重载，运行状态会丢；
 * 2. 更关键的 —— App Router 里每个 route handler 是各自编译的，
 *    模块级的 Set 在不同路由之间不是同一个实例。
 *    结果就是 /api/human 里 emit 的消息，/api/stream 收不到。
 */
const g = globalThis as unknown as { __aiOffice?: Record<string, unknown> };
export const store: Record<string, unknown> = (g.__aiOffice ??= {});

const listeners: Set<Listener> = (store.__listeners as Set<Listener>) ?? new Set<Listener>();
store.__listeners = listeners;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(e: StreamEvent): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn(e);
    } catch {
      /* 单个订阅者出错不影响其他人 */
    }
  }
}
