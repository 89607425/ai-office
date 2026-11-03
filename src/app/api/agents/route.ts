import { NextResponse } from 'next/server';
import { agentSummary, bindingOf, createAgent, deleteAgent, getAgent, getAgents, publicAgents, publicAgent, updateAgentConnection } from '@/lib/kernel';
import { checkConnection } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ agents: publicAgents(getAgents()) });
}

/** 删之前的交接说明：统计 + 模型提炼的工作总结 */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
  try {
    const r = await agentSummary(body.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
  try {
    const r = deleteAgent(id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    role?: string;
    system_prompt?: string;
    provider?: string;
    base_url?: string;
    api_key?: string;
    model?: string;
    sassiness?: number;
    tone?: string;
    catchphrase?: string;
    tools_enabled?: number;
    avatar?: string;
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
      base_url: body.base_url,
      api_key: body.api_key,
      model: body.model,
      sassiness: body.sassiness,
      tone: body.tone,
      catchphrase: body.catchphrase,
      tools_enabled: body.tools_enabled,
      avatar: (body.avatar || '').trim(),
    });
    return NextResponse.json({ ok: true, agent: publicAgent(agent) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    action?: 'update_connection' | 'test_connection';
    name?: string;
    provider?: string;
    base_url?: string;
    model?: string;
    api_key?: string;
    reasoning_effort?: string;
    role?: string;
    system_prompt?: string;
    avatar?: string;
    sassiness?: number;
    tone?: string;
    catchphrase?: string;
    tools_enabled?: number;
  };
  const id = (body.id || '').trim();
  if (!id) return NextResponse.json({ error: '缺少员工' }, { status: 400 });

  const agent = getAgent(id);
  if (!agent) return NextResponse.json({ error: '员工不存在' }, { status: 404 });

  if (body.action === 'test_connection') {
    const result = await checkConnection(bindingOf(agent));
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  }

  try {
    const updated = updateAgentConnection(id, body);
    return NextResponse.json({ ok: true, agent: publicAgent(updated) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
