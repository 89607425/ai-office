import { NextResponse } from 'next/server';
import { createAgent, getAgents } from '@/lib/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ agents: getAgents() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    role?: string;
    system_prompt?: string;
    provider?: string;
    api_key?: string;
    model?: string;
    sassiness?: number;
    tone?: string;
    catchphrase?: string;
    tools_enabled?: number;
  };

  const name = (body.name || '').trim();
  const role = (body.role || '').trim();
  const prompt = (body.system_prompt || '').trim();
  if (!name || !role || !prompt) {
    return NextResponse.json({ error: '名字、岗位、人设都要填' }, { status: 400 });
  }

  try {
    const agent = createAgent({
      name,
      role,
      system_prompt: prompt,
      provider: body.provider,
      api_key: body.api_key,
      model: body.model,
      sassiness: body.sassiness,
      tone: body.tone,
      catchphrase: body.catchphrase,
      tools_enabled: body.tools_enabled,
    });
    return NextResponse.json({ ok: true, agent });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
