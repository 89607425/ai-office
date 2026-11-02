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

/**
 * 老板在群里发话：只发消息 + 被点名的人当场回一句，不自动拉起任务。
 * 要启动一段自主协作，请用界面上的「下发任务」按钮（→ /api/run）。
 * 若当前该群已有进行中的任务，这条消息会挂到那个 run 上，循环的下一轮会把它当作老板插话读到。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    groupId?: string;
    content?: string;
  };
  const groupId = body.groupId || 'g1';
  const content = (body.content || '').trim();
  if (!content) return NextResponse.json({ error: '内容不能为空' }, { status: 400 });

  // 有正在跑的任务就挂到那个 run；没有就只是普通聊天，绝不擅自开新任务
  const active = db()
    .prepare("SELECT id FROM runs WHERE group_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1")
    .get(groupId) as { id: string } | undefined;
  const runId = active?.id ?? null;

  postMessage({
    group_id: groupId,
    run_id: runId,
    sender_id: 'boss',
    sender_name: '老板',
    content,
    kind: 'human',
  });

  // 老板点名的要求要落进那个员工的记忆；如果是调岗，连档案一起改
  const notes = await applyDirective(content, { groupId });

  // @ 了谁，谁就必须当场回话（即时响应）
  const members = getMembers(groupId);
  const mentioned = members.filter((m) => isMentioned(content, m.name));

  await Promise.all(mentioned.slice(0, 3).map((m) => replyInGroup(groupId, m.id, content, runId)));

  return NextResponse.json({ ok: true, runId, notes, mentioned: mentioned.map((m) => m.name) });
}
