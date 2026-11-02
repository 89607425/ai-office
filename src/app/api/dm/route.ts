import { NextResponse } from 'next/server';
import { dmId, sendDm, executeDmTask, isGroupAction, looksLikeQuestion } from '@/lib/kernel';
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

    // 指向群 / 工作区的操作指令才走"真去改文件并发回群里"通道；
    // 纯疑问句（且没点名文件）按普通私聊处理，避免误改文件
    const hasFile = /[\w\u4e00-\u9fa5-]+\.(?:md|txt|json|js|ts|py|html|css|yml|yaml|csv)/i.test(content);
    const action = isGroupAction(content) && !(looksLikeQuestion(content) && !hasFile);
    if (action) {
      await executeDmTask(agentId, content);
    } else {
      await sendDm(agentId, content);
    }
    return NextResponse.json({ ok: true, notes, action });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
