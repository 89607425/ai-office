import { db } from './db';
import { chat } from './llm';
import { emit, store } from './bus';
import { bindingOf, getAgents, getMessages, parsePersona } from './kernel';
import type { Agent, Moment, MomentComment } from './types';

const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function getMoments(limit = 50): Moment[] {
  return db().prepare('SELECT * FROM moments ORDER BY created_at DESC LIMIT ?').all(limit) as Moment[];
}

export function getComments(limit = 200): MomentComment[] {
  return db().prepare('SELECT * FROM moment_comments ORDER BY created_at ASC LIMIT ?').all(limit) as MomentComment[];
}

export async function publishMoment(agentId?: string): Promise<Moment | null> {
  const agents = getAgents();
  if (!agents.length) return null;
  const agent: Agent = agentId ? (agents.find((a) => a.id === agentId) ?? agents[0]) : agents[Math.floor(Math.random() * agents.length)];
  const p = parsePersona(agent.persona);

  const recent = getMessages('g1', 200)
    .filter((m) => m.kind === 'chat')
    .slice(-6)
    .map((m) => `${m.sender_name}：${m.content}`)
    .join('\n');

  const text = await chat({
    tag: 'moment',
    messages: [
      { role: 'system' as const, content: agent.system_prompt },
      {
        role: 'user' as const,
        content: `你要发一条微信朋友圈。
你的说话风格：${p.tone}。小习惯：${p.quirks.join('；') || '无'}。
群里最近在聊：
${recent || '（群里还没人说话）'}
要求：一句话到两句话，像真人发朋友圈，可以是吐槽、感慨、晒进展、抱怨加班。不要提"AI"，不要用 Markdown，不要加引号。`,
      },
    ],
    temperature: 1.05,
    maxTokens: 120,
  }, bindingOf(agent));

  const content = text.replace(/[""'']/g, '').trim() || '（今天没什么想说的）';
  const id = uid('mo');
  db()
    .prepare(
      'INSERT INTO moments (id,agent_id,agent_name,avatar,content,kind,created_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run(id, agent.id, agent.name, agent.avatar, content, 'life', Date.now());
  const moment = db().prepare('SELECT * FROM moments WHERE id = ?').get(id) as Moment;
  emit({ type: 'moment', moment });

  void commentLater(moment, agents, agent.id);
  return moment;
}

async function commentLater(moment: Moment, agents: Agent[], authorId: string): Promise<void> {
  const others = agents.filter((a) => a.id !== authorId);
  const n = Math.floor(Math.random() * 3); // 0-2 条评论
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 4000));
    const c = others[Math.floor(Math.random() * others.length)];
    if (!c) continue;
    const p = parsePersona(c.persona);
    const text = await chat({
      tag: 'comment',
      messages: [
        { role: 'system' as const, content: c.system_prompt },
        {
          role: 'user' as const,
          content: `你看到 ${moment.agent_name} 发了条朋友圈：「${moment.content}」
你要在下面评论一句。风格：${p.tone}。要求：一句话，口语，不超过 15 个字，像微信评论。不要加引号。`,
        },
      ],
      temperature: 1.0,
      maxTokens: 40,
    }, bindingOf(c));
    const content = text.replace(/[""'']/g, '').trim();
    if (!content) continue;
    const id = uid('mc');
    db()
      .prepare(
        'INSERT INTO moment_comments (id,moment_id,agent_id,agent_name,content,created_at) VALUES (?,?,?,?,?,?)'
      )
      .run(id, moment.id, c.id, c.name, content, Date.now());
    const comment = db().prepare('SELECT * FROM moment_comments WHERE id = ?').get(id) as MomentComment;
    emit({ type: 'moment_comment', comment });
  }
}

export function startHeartbeat(): void {
  if (store.momentTimer) return;
  const interval = Number(process.env.MOMENT_INTERVAL_MS || 90000);
  const timer = setInterval(() => {
    void publishMoment().catch(() => {});
  }, Math.max(15000, interval));
  store.momentTimer = timer;
}

export function stopHeartbeat(): void {
  const t = store.momentTimer as NodeJS.Timeout | undefined;
  if (t) clearInterval(t);
  store.momentTimer = undefined;
}
