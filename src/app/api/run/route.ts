import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getGroup, postMessage, startRun, stopRun } from '@/lib/kernel';
import { startHeartbeat } from '@/lib/moments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: 'start' | 'stop';
    groupId?: string;
    goal?: string;
    runId?: string;
  };

  if (body.action === 'stop') {
    if (!body.runId) return NextResponse.json({ error: '缺少 runId' }, { status: 400 });
    stopRun(body.runId);
    return NextResponse.json({ ok: true });
  }

  const groupId = body.groupId || 'g1';
  const goal = (body.goal || '').trim();
  if (!goal) return NextResponse.json({ error: '任务不能为空' }, { status: 400 });

  const group = getGroup(groupId);
  if (!group) return NextResponse.json({ error: '群不存在' }, { status: 404 });

  const runId = await startRun(groupId, goal);
  startHeartbeat();
  return NextResponse.json({ ok: true, runId });
}

export async function GET() {
  const rows = db().prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT 5').all();
  return NextResponse.json({ runs: rows });
}
