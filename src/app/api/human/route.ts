import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getMembers, postMessage, replyInGroup } from '@/lib/kernel';
import { applyDirective } from '@/lib/directive';

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

  // 老板点名的要求要落进那个员工的记忆；如果是调岗，连档案一起改
  const notes = await applyDirective(content, { groupId });

  // @ 了谁，谁就必须当场回话
  const members = getMembers(groupId);
  const mentioned = members.filter(
    (m) => content.includes(`@${m.name}`) || content.startsWith(`${m.name}`) || content.includes(`${m.name}，`)
  );
  for (const m of mentioned.slice(0, 3)) {
    void replyInGroup(groupId, m.id, content).catch(() => {});
  }

  return NextResponse.json({ ok: true, notes, mentioned: mentioned.map((m) => m.name) });
}
