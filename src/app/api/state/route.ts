import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  getAgents,
  getGroups,
  getMembers,
  getMessages,
  runtimeInfo,
} from '@/lib/kernel';
import { getMoments, getComments } from '@/lib/moments';
import { workspaceTree } from '@/lib/sandbox';
import { store } from '@/lib/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const groups = getGroups().map((g) => ({
    ...g,
    members: getMembers(g.id),
    messages: getMessages(g.id),
  }));
  const godInbox = db()
    .prepare('SELECT * FROM god_inbox ORDER BY created_at DESC LIMIT 50')
    .all();
  const runs = db()
    .prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT 20')
    .all();

  return NextResponse.json({
    agents: getAgents(),
    groups,
    moments: getMoments(),
    comments: getComments(),
    godInbox,
    runs,
    workspace: workspaceTree(),
    sandboxBlocks: (store.sandbox_blocks as string[]) || [],
    runtime: runtimeInfo(),
  });
}
