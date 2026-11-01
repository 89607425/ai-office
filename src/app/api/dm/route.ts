import { NextResponse } from 'next/server';
import { sendDm } from '@/lib/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { agentId?: string; content?: string };
  const agentId = (body.agentId || '').trim();
  const content = (body.content || '').trim();
  if (!agentId || !content) return NextResponse.json({ error: '缺少员工或内容' }, { status: 400 });

  try {
    await sendDm(agentId, content);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
