import { db } from './db';
import { chat, mode, modelName, provider } from './llm';
import { emit, store } from './bus';
import { parseToolCall, runTool, logSandboxBlock } from './sandbox';
import type { Agent, Group, Message, Persona } from './types';

export const MAX_ROUNDS = 8;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/* ----------------------------- 查询 ----------------------------- */

export function parsePersona(raw: string): Persona {
  try {
    return JSON.parse(raw) as Persona;
  } catch {
    return { tone: '', catchphrase: '', latency: [800, 2500], sassiness: 0.2, quirks: [], workHours: [9, 23] };
  }
}

export function getAgents(): Agent[] {
  return db().prepare('SELECT * FROM agents ORDER BY created_at').all() as Agent[];
}

export function getAgent(id: string): Agent | null {
  return (db().prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent) || null;
}

export function getGroups(): Group[] {
  return db().prepare('SELECT * FROM groups ORDER BY created_at').all() as Group[];
}

export function getGroup(id: string): Group | null {
  return (db().prepare('SELECT * FROM groups WHERE id = ?').get(id) as Group) || null;
}

export function getMembers(groupId: string): Agent[] {
  return db()
    .prepare(
      'SELECT a.* FROM group_members m JOIN agents a ON a.id = m.agent_id WHERE m.group_id = ? ORDER BY a.created_at'
    )
    .all(groupId) as Agent[];
}

export function getMessages(groupId: string, limit = 300): Message[] {
  return db()
    .prepare('SELECT * FROM messages WHERE group_id = ? ORDER BY created_at ASC LIMIT ?')
    .all(groupId, limit) as Message[];
}

export function getMemories(agentId: string, scope: string, limit = 5): string[] {
  const rows = db()
    .prepare('SELECT content FROM memories WHERE agent_id = ? AND scope = ? ORDER BY created_at DESC LIMIT ?')
    .all(agentId, scope, limit) as { content: string }[];
  return rows.map((r) => r.content);
}

export function addMemory(agentId: string, scope: string, content: string): void {
  db()
    .prepare('INSERT INTO memories (id,agent_id,scope,content,created_at) VALUES (?,?,?,?,?)')
    .run(uid('mem'), agentId, scope, content, Date.now());
}

/* ----------------------------- 写入 + 广播 ----------------------------- */

export function postMessage(args: {
  group_id: string;
  run_id: string | null;
  sender_id: string;
  sender_name: string;
  content: string;
  kind: Message['kind'];
  meta?: string | null;
}): Message {
  const msg: Message = {
    id: uid('msg'),
    group_id: args.group_id,
    run_id: args.run_id,
    sender_id: args.sender_id,
    sender_name: args.sender_name,
    content: args.content,
    kind: args.kind,
    created_at: Date.now(),
    meta: args.meta ?? null,
  };
  db()
    .prepare(
      'INSERT INTO messages (id,group_id,run_id,sender_id,sender_name,content,kind,created_at,meta) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(
      msg.id,
      msg.group_id,
      msg.run_id,
      msg.sender_id,
      msg.sender_name,
      msg.content,
      msg.kind,
      msg.created_at,
      msg.meta
    );
  emit({ type: 'message', message: msg });
  return msg;
}

export function typing(groupId: string, agent: Agent, ms: number): Promise<void> {
  emit({ type: 'typing', group_id: groupId, agent_id: agent.id, agent_name: agent.name });
  return sleep(Math.min(ms, 5000));
}

export function setStatus(runId: string, status: string, round: number): void {
  db().prepare('UPDATE runs SET status = ?, round = ? WHERE id = ?').run(status, round, runId);
  emit({ type: 'status', run_id: runId, status: status as never, round });
}

export function log(text: string): void {
  emit({ type: 'log', text });
}

/* ----------------------------- 防退化 ----------------------------- */

function bigrams(s: string): Set<string> {
  const t = s.replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 复读检测：与本人最近 6 条消息相似度过高 */
export function isRepeat(agentId: string, groupId: string, text: string): boolean {
  const rows = db()
    .prepare('SELECT content FROM messages WHERE sender_id = ? AND group_id = ? ORDER BY created_at DESC LIMIT 6')
    .all(agentId, groupId) as { content: string }[];
  const target = bigrams(text);
  for (const r of rows) {
    if (jaccard(target, bigrams(r.content)) > 0.82) return true;
  }
  return false;
}

/* ----------------------------- 组长 ----------------------------- */

type LeaderOut =
  | { action: 'dispatch'; items: { to: string; instruction: string }[] }
  | { action: 'converge'; summary: string; acceptance: string[] }
  | { action: 'ask_human'; question: string };

function parseLeaderOut(text: string): LeaderOut | null {
  let raw = text.trim();
  raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try {
    const obj = JSON.parse(raw.slice(s, e + 1)) as LeaderOut;
    if (!obj || typeof obj.action !== 'string') return null;
    if (obj.action === 'dispatch' && Array.isArray(obj.items)) return obj;
    if (obj.action === 'converge') return obj;
    if (obj.action === 'ask_human') return obj;
    return null;
  } catch {
    return null;
  }
}

async function leaderTurn(group: Group, run: { id: string; goal: string; round: number }, digest: string[], humanNotes: string[]): Promise<LeaderOut | null> {
  const leader = getAgent(group.leader_id);
  if (!leader) return null;
  const members = getMembers(group.id).filter((a) => a.id !== leader.id);
  const ids = members.map((a) => `${a.id}(${a.name}·${a.role})`).join('、');

  const messages = [
    { role: 'system' as const, content: leader.system_prompt },
    {
      role: 'user' as const,
      content: `你是群「${group.name}」的组长。
目标：${run.goal}
当前第 ${run.round} 轮（最多 ${MAX_ROUNDS} 轮）。
可选成员：${ids}
到目前为止的讨论：
${digest.length ? digest.map((d, i) => `${i + 1}. ${d}`).join('\n') : '（还没有人发言）'}
${humanNotes.length ? `\n老板（人类管理员）的插话：\n${humanNotes.join('\n')}\n请认真对待老板的话。` : ''}
只输出 JSON，不要其他文字。三选一：
{"action":"dispatch","items":[{"to":"成员id","instruction":"具体任务"}]}
{"action":"converge","summary":"结论","acceptance":["验收项"]}
{"action":"ask_human","question":"要问老板的问题"}
若信息已足够收敛，用 converge；最多分派 ${Math.min(3, members.length)} 个成员。`,
    },
  ];

  const out = await chat({ tag: 'leader', messages, temperature: 0.7, json: true });
  return parseLeaderOut(out);
}

/* ----------------------------- 成员 ----------------------------- */

async function agentTurn(
  group: Group,
  run: { id: string; goal: string; round: number },
  agent: Agent,
  instruction: string,
  related: string[]
): Promise<string> {
  const p = parsePersona(agent.persona);
  const privateMem = getMemories(agent.id, 'private', 3);

  const sys = [
    agent.system_prompt,
    `你的说话风格：${p.tone}。口头禅：${p.catchphrase}。小习惯：${p.quirks.join('；') || '无'}。`,
    `严格要求：用中文口语回复，1-3 句，像在微信群里说话，不要写报告，不要自称 AI，不要用 Markdown 标题。`,
    agent.tools_enabled
      ? `如果你需要读写文件，回复的最后附一个代码块：\n\`\`\`json\n{"tool":"write_file","args":{"path":"notes.md","content":"内容"}}\n\`\`\`\n可选工具：read_file(path) / write_file(path,content) / list_files()。不要用它做无关的事。`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const messages = [
    { role: 'system' as const, content: sys },
    {
      role: 'user' as const,
      content: `群「${group.name}」，总目标：${run.goal}
组长给你的任务：${instruction}
与你相关的上下文：
${related.length ? related.map((r) => `- ${r}`).join('\n') : '（无）'}
${privateMem.length ? `你自己的记忆：\n${privateMem.map((m) => `- ${m}`).join('\n')}` : ''}
现在回复。`,
    },
  ];

  let text = await chat({ tag: 'agent', messages, temperature: 0.9 });

  // 复读检测必须放在工具执行之前：否则被丢弃的第一版回复已经把工具跑了一遍，
  // 群里会留下两条一模一样的工具消息
  if (isRepeat(agent.id, group.id, text.replace(/```json[\s\S]*?```/g, ''))) {
    log(`检测到 ${agent.name} 复读，强制换角度`);
    text = await chat({
      tag: 'agent',
      messages: [
        ...messages,
        { role: 'user' as const, content: '注意：你刚才说的和之前重复了，换一个角度，说点新的。' },
      ],
      temperature: 1.0,
    });
  }

  // 一次 ReAct：解析工具调用 → 执行 → 把结果喂回去再要一次最终回复
  if (agent.tools_enabled) {
    const call = parseToolCall(text);
    if (call) {
      const res = runTool(group.id, call);
      if (!res.ok && /越界/.test(res.output)) logSandboxBlock(group.id, `${agent.name}: ${res.output}`);
      const toolMsg = postMessage({
        group_id: group.id,
        run_id: run.id,
        sender_id: agent.id,
        sender_name: agent.name,
        content: `[工具] ${call.tool} ${call.args.path || ''} → ${res.output.slice(0, 300)}`,
        kind: res.ok ? 'tool_result' : 'tool',
      });
      void toolMsg;
      const follow = await chat({
        tag: 'agent',
        messages: [
          ...messages,
          { role: 'assistant' as const, content: text },
          { role: 'user' as const, content: `工具执行结果：${res.output}\n现在用一句口语把结果说给群里听，不要再输出代码块。` },
        ],
        temperature: 0.9,
      });
      text = follow.replace(/```json[\s\S]*?```/g, '').trim() || text;
    }
  }

  text = text.replace(/```json[\s\S]*?```/g, '').trim();
  return text || '……';
}

/* ----------------------------- 越级汇报 ----------------------------- */

async function maybeAppeal(
  group: Group,
  run: { id: string; goal: string; round: number },
  agent: Agent,
  instruction: string,
  reply: string,
  force = false
): Promise<void> {
  const p = parsePersona(agent.persona);

  // 触发条件：人设怨气值命中随机；或这条指令跟上一轮一模一样（被反复折腾）
  const dupe = db()
    .prepare(
      'SELECT content FROM messages WHERE group_id = ? AND sender_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 3'
    )
    .all(group.id, 'system', 'system') as { content: string }[];
  const repeated = dupe.length >= 2 && dupe[0].content === dupe[1].content;

  const chance = Math.min(0.6, p.sassiness * 0.35) + (repeated ? 0.4 : 0);
  if (!force && Math.random() > chance) return;

  const text = await chat({
    tag: 'appeal',
    messages: [
      { role: 'system' as const, content: agent.system_prompt },
      {
        role: 'user' as const,
        content: `你在群「${group.name}」里干活。组长刚给你的指令是：${instruction}
你的回复是：${reply}
现在你要私聊"老板"（这个群的人类管理员，上帝视角），越级汇报你的真实想法。
要求：一句到两句，说具体的事（引用刚才的指令），带情绪但别撒娇，像员工私下找老板吐槽。不要自称 AI。`,
      },
    ],
    temperature: 1.0,
  });

  const id = uid('god');
  db()
    .prepare(
      'INSERT INTO god_inbox (id,agent_id,agent_name,avatar,group_id,content,kind,reply,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(id, agent.id, agent.name, agent.avatar, group.id, text.trim(), repeated ? 'complain' : 'appeal', null, Date.now());
  const mail = db().prepare('SELECT * FROM god_inbox WHERE id = ?').get(id) as never;
  store[`appealed_${run.id}`] = true;
  emit({ type: 'god', mail });
}

/* ----------------------------- 主循环 ----------------------------- */

export type RunState = { stopped: boolean };

export function runState(runId: string): RunState {
  const key = `run_${runId}`;
  if (!store[key]) store[key] = { stopped: false } as RunState;
  return store[key] as RunState;
}

export function stopRun(runId: string): void {
  const s = runState(runId);
  s.stopped = true;
  setStatus(runId, 'done', 0);
}

export async function startRun(groupId: string, goal: string): Promise<string> {
  const group = getGroup(groupId);
  if (!group) throw new Error('群不存在');
  const runId = uid('run');
  db()
    .prepare('INSERT INTO runs (id,group_id,goal,status,round,created_at) VALUES (?,?,?,?,?,?)')
    .run(runId, groupId, goal, 'running', 0, Date.now());
  runState(runId).stopped = false;

  postMessage({
    group_id: groupId,
    run_id: runId,
    sender_id: 'system',
    sender_name: '系统',
    content: `老板下发任务：${goal}`,
    kind: 'system',
  });
  setStatus(runId, 'running', 0);

  void loop(group, { id: runId, goal, round: 0 }).catch((e) => {
    log(`内核异常：${String(e)}`);
    setStatus(runId, 'error', 0);
  });

  return runId;
}

async function loop(group: Group, run: { id: string; goal: string; round: number }): Promise<void> {
  const members = getMembers(group.id);
  const digest: string[] = [];
  const spoken = new Set<string>();
  let round = 0;

  while (round < MAX_ROUNDS) {
    if (runState(run.id).stopped) return;
    round++;
    run.round = round;
    setStatus(run.id, 'running', round);

    const humanNotes = getMessages(group.id)
      .filter((m) => m.kind === 'human' && m.run_id === run.id)
      .slice(-3)
      .map((m) => m.content);

    await typing(group.id, getAgent(group.leader_id) ?? members[0], 900 + Math.random() * 1200);
    const out = await leaderTurn(group, run, digest.slice(-12), humanNotes);
    if (!out) {
      log('组长输出无法解析，本轮跳过');
      await sleep(800);
      continue;
    }

    if (out.action === 'ask_human') {
      postMessage({
        group_id: group.id,
        run_id: run.id,
        sender_id: group.leader_id,
        sender_name: getAgent(group.leader_id)?.name ?? '组长',
        content: `@老板 ${out.question}`,
        kind: 'chat',
      });
      setStatus(run.id, 'paused', round);
      return;
    }

    if (out.action === 'converge') {
      const leader = getAgent(group.leader_id);
      postMessage({
        group_id: group.id,
        run_id: run.id,
        sender_id: group.leader_id,
        sender_name: leader?.name ?? '组长',
        content: `收个尾：${out.summary}\n验收项：\n${out.acceptance.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
        kind: 'chat',
      });
      addMemory(group.leader_id, 'group', `任务「${run.goal}」的结论：${out.summary}`);
      for (const m of members) {
        const own = digest.filter((d) => d.startsWith(`${m.name}：`)).slice(-2);
        if (own.length) addMemory(m.id, 'private', `我在「${run.goal}」里做的事：${own.join(' / ')}`);
      }
      setStatus(run.id, 'done', round);
      return;
    }

    // dispatch
    let items = out.items.filter((i) => members.some((m) => m.id === i.to));
    if (!items.length) {
      log('组长分派了不存在的成员，改为随机点名');
      items = members
        .filter((m) => m.id !== group.leader_id)
        .slice(0, 2)
        .map((m) => ({ to: m.id, instruction: `推进「${run.goal}」，说出你这一步要做的事。` }));
    }

    // 强制反对者：第 2 轮起，若反对者还没说过话，插进去
    if (round >= 2 && !spoken.has(group.critic_id) && !items.some((i) => i.to === group.critic_id)) {
      items.push({
        to: group.critic_id,
        instruction: '针对上面的方案挑刺：列出至少 3 个风险或边界情况，按 1/2/3 列。',
      });
    }

    for (const item of items.slice(0, 4)) {
      if (runState(run.id).stopped) return;
      const agent = getAgent(item.to);
      if (!agent) continue;
      const p = parsePersona(agent.persona);
      const [lo, hi] = p.latency;
      const delay = lo + Math.random() * Math.max(0, hi - lo);

      await typing(group.id, agent, delay);
      const text = await agentTurn(group, run, agent, item.instruction, digest.slice(-6));

      postMessage({
        group_id: group.id,
        run_id: run.id,
        sender_id: agent.id,
        sender_name: agent.name,
        content: text,
        kind: 'chat',
      });
      digest.push(`${agent.name}：${text}`);
      spoken.add(agent.id);

      void maybeAppeal(group, run, agent, item.instruction, text);
    }

    // 兜底：第 2 轮结束还没人越级汇报，就强制怨气值最高的那位来一趟
    if (round >= 2 && !store[`appealed_${run.id}`]) {
      const candidates = members
        .filter((m) => m.id !== group.leader_id && spoken.has(m.id))
        .sort((a, b) => parsePersona(b.persona).sassiness - parsePersona(a.persona).sassiness);
      const target = candidates[0];
      if (target) {
        const own = digest.filter((d) => d.startsWith(`${target.name}：`)).slice(-1)[0] ?? '';
        await maybeAppeal(group, run, target, '组长刚才那一轮的分派', own, true);
      }
    }
  }

  postMessage({
    group_id: group.id,
    run_id: run.id,
    sender_id: 'system',
    sender_name: '系统',
    content: `已到最大轮次（${MAX_ROUNDS}），强制收工。`,
    kind: 'system',
  });
  setStatus(run.id, 'done', round);
}

export function runtimeInfo() {
  return { mode: mode(), provider: provider(), model: modelName() };
}
