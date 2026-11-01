import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 轮询兜底通道。
 * SSE 在 dev 模式下会因为路由重编译、HMR、代理缓冲等原因掉线，
 * 光靠它会出现"加载动画转完就没了、消息要刷新才出现"。
 * 这里给一条最朴素的增量拉取，和 SSE 双通道互为备份。
 */
export async function GET(req: Request) {
  const since = Number(new URL(req.url).searchParams.get('since') || 0);
  const rows = db()
    .prepare('SELECT * FROM messages WHERE created_at > ? ORDER BY created_at ASC LIMIT 200')
    .all(Number.isFinite(since) ? since : 0);
  return NextResponse.json({ messages: rows, now: Date.now() });
}
