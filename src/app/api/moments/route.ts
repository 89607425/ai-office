import { NextResponse } from 'next/server';
import { getMoments, getComments, publishMoment, startHeartbeat, stopHeartbeat } from '@/lib/moments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ moments: getMoments(), comments: getComments() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: 'publish' | 'heartbeat_on' | 'heartbeat_off';
    agentId?: string;
  };
  if (body.action === 'heartbeat_on') {
    startHeartbeat();
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'heartbeat_off') {
    stopHeartbeat();
    return NextResponse.json({ ok: true });
  }
  const m = await publishMoment(body.agentId);
  return NextResponse.json({ ok: true, moment: m });
}
