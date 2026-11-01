import { NextResponse } from 'next/server';
import { createGroup, deleteGroup, getGroups, getMembers, publicAgents } from '@/lib/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    groups: getGroups().map((g) => ({ ...g, members: publicAgents(getMembers(g.id)) })),
  });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
  try {
    deleteGroup(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    topic?: string;
    leaderId?: string;
    criticId?: string;
    memberIds?: string[];
  };

  const name = (body.name || '').trim();
  const leaderId = (body.leaderId || '').trim();
  const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];

  if (!name || !leaderId) return NextResponse.json({ error: '群名和组长都要选' }, { status: 400 });
  if (memberIds.length < 1) return NextResponse.json({ error: '至少再拉一个人进群' }, { status: 400 });

  try {
    const group = createGroup({
      name,
      topic: body.topic,
      leaderId,
      criticId: body.criticId,
      memberIds,
    });
    return NextResponse.json({ ok: true, group });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
