import { NextResponse } from 'next/server';
import {
  dmId,
  getAgents,
  getGroups,
  getMembers,
  getMessages,
  publicAgent,
  publicAgents,
  runtimeInfo,
} from '@/lib/kernel';
import { getMoments, getComments } from '@/lib/moments';
import { workspaceTree } from '@/lib/sandbox';
import { store } from '@/lib/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const agents = getAgents();
  const groups = getGroups().map((g) => ({
    ...g,
    members: publicAgents(getMembers(g.id)),
    messages: getMessages(g.id),
  }));

  // 每个员工都是老板的一个 1-1 会话；越级汇报也落在里面
  const dms = agents.map((a) => ({
    id: dmId(a.id),
    agent: publicAgent(a),
    messages: getMessages(dmId(a.id), 100),
  }));

  return NextResponse.json({
    agents: publicAgents(agents),
    groups,
    dms,
    moments: getMoments(),
    comments: getComments(),
    workspace: workspaceTree(),
    sandboxBlocks: (store.sandbox_blocks as string[]) || [],
    runtime: runtimeInfo(),
  });
}
