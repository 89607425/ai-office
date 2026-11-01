import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { addMemory } from '@/lib/kernel';
import { emit } from '@/lib/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { mailId?: string; reply?: string };
  const mailId = body.mailId;
  const reply = (body.reply || '').trim();
  if (!mailId || !reply) return NextResponse.json({ error: '缺少 mailId 或 reply' }, { status: 400 });

  const mail = db().prepare('SELECT * FROM god_inbox WHERE id = ?').get(mailId) as
    | { id: string; agent_id: string; agent_name: string }
    | undefined;
  if (!mail) return NextResponse.json({ error: '找不到这条消息' }, { status: 404 });

  db().prepare('UPDATE god_inbox SET reply = ? WHERE id = ?').run(reply, mailId);

  // 关键：老板的私下回复会进这个 agent 的私有记忆，影响它后续的行为，但群里其他人看不到
  addMemory(mail.agent_id, 'private', `老板私下对我说过：${reply}`);

  const updated = db().prepare('SELECT * FROM god_inbox WHERE id = ?').get(mailId);
  emit({ type: 'god', mail: updated as never });

  return NextResponse.json({ ok: true });
}
