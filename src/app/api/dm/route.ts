import { NextResponse } from 'next/server';
import { dmId, sendDm } from '@/lib/kernel';
import { applyDirective } from '@/lib/directive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { agentId?: string; content?: string };
  const agentId = (body.agentId || '').trim();
  const content = (body.content || '').trim();
  if (!agentId || !content) return NextResponse.json({ error: '缺少员工或内容' }, { status: 400 });

  try {
    // 老板在私聊里的指向性要求同样要持久化，而且要是调岗就直接改档案
    const notes = await applyDirective(content, { forcedAgentId: agentId, groupId: dmId(agentId) });
    await sendDm(agentId, content);
    return NextResponse.json({ ok: true, notes });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
