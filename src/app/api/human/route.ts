import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getMembers, postMessage, replyInGroup } from '@/lib/kernel';
import { applyDirective } from '@/lib/directive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 兼容 @名字、＠名字，以及 @ 名字 这几种常见输入法形式。 */
function isMentioned(content: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return new RegExp(`(?:^|\\s)[@＠]\\s*${escaped}(?=$|[\\s，,。！？!?：:])`).test(content);
}

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
  const mentioned = members.filter((m) => isMentioned(content, m.name));

  // 不能 fire-and-forget：在 Serverless/开发热更新环境中，请求结束后的异步任务
  // 可能被直接回收，用户就会看到“@ 了但没人回复”。并行等待能保留即时响应，
  // replyInGroup 内部会把模型失败转成一条可见的系统消息。
  await Promise.all(mentioned.slice(0, 3).map((m) => replyInGroup(groupId, m.id, content)));

  return NextResponse.json({ ok: true, notes, mentioned: mentioned.map((m) => m.name) });
}
