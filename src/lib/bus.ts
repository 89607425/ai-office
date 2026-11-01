import type { StreamEvent } from './types';

type Listener = (e: StreamEvent) => void;

const listeners = new Set<Listener>();

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

/**
 * 全局单例容器：Next.js dev 下模块会被热重载，用 globalThis 兜住，
 * 避免心跳调度器和运行状态在热更新后丢失。
 */
const g = globalThis as unknown as { __aiOffice?: Record<string, unknown> };
export const store: Record<string, unknown> = (g.__aiOffice ??= {});
