import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { postMessage } from '@/lib/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    groupId?: string;
    content?: string;
  };
  const groupId = body.groupId || 'g1';
  const content = (body.content || '').trim();
  if (!content) return NextResponse.json({ error: '内容不能为空' }, { status: 400 });

  const run = db()
    .prepare("SELECT id FROM runs WHERE group_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(groupId) as { id: string } | undefined;

  postMessage({
    group_id: groupId,
    run_id: run?.id ?? null,
    sender_id: 'boss',
    sender_name: '老板',
    content,
    kind: 'human',
  });

  return NextResponse.json({ ok: true });
}
