import { NextResponse } from 'next/server';
import { processOneRunJob } from '@/lib/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 可由浏览器（本地）或外部 cron / 常驻 worker（部署）触发一次。
 * 每次只领取一个任务，SQLite 的租约会防止多实例重复领取。
 */
export async function POST() {
  try {
    return NextResponse.json(await processOneRunJob());
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
