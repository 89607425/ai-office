import { db } from './db';
import { chat, mode, modelName, provider } from './llm';
import { emit, store } from './bus';
import { parseToolCall, runTool, logSandboxBlock, stripToolBlocks, writeFile, readFile, listFiles, latestFile } from './sandbox';
import { bindingLabel } from './llm';
import type { Agent, AgentPublic, Group, Message, Persona, Run } from './types';

export const MAX_ROUNDS = 8;

/** 每个员工走自己的厂商和 key；没配就落到全局 env，再没有就演示模式 */
export function bindingOf(a: Agent | null | undefined) {
  if (!a) return null;
  return {
    provider: a.provider || undefined,
    apiKey: a.api_key || undefined,
    model: a.model || undefined,
    baseUrl: a.base_url || undefined,
    reasoningEffort: a.reasoning_effort || undefined,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/* ----------------------------- 任务看板 / 群内发布 ----------------------------- */

/** 每个群工作区里有一份共享任务看板，所有成员动手前都读它，组长负责维护 */
export const BOARD_FILE = '任务看板.md';

/** 列出某群工作区的文件清单（把"当前有什么产出"喂给组长和成员） */
export function groupFileList(groupId: string): string {
  const res = listFiles(groupId);
  return res.ok ? res.output : '（工作区为空）';
}

/** 读取任务看板；没有就返回空串 */
export function readBoard(groupId: string): string {
  const res = readFile(groupId, BOARD_FILE);
  return res.ok ? res.output : '';
}

/** 组长把分派写进工作区看板，让所有成员都能读到当前进度与待办 */
export function writeBoard(
  groupId: string,
  goal: string,
  round: number,
  items: { name: string; instruction: string }[],
  status: string
): void {
  const files = groupFileList(groupId);
  const lines = items.length
    ? items.map((it, i) => `${i + 1}. **${it.name}**： ${it.instruction}`).join('\n')
    : '（本轮暂无新分派）';
  const md = [
    `# 任务看板：${goal}`,
    '',
    `- 状态：${status}（第 ${round} 轮）`,
    '- 工作区文件：',
    ...files
      .split('\n')
      .filter(Boolean)
      .map((f) => `  - ${f}`),
    '',
    '## 本轮分派',
    lines,
    '',
    '> 这是组长维护的进度速览，方便大家随时回看；日常协作以群聊里的 @ 分派为准，必要时才读它。干完在群里同步进度、把产出落到工作区。',
  ].join('\n');
  writeFile(groupId, BOARD_FILE, md);
}

/** 以某员工身份在群里发一条消息（私聊操作把结果同步回群时使用） */
export function postToGroup(agent: Agent, groupId: string, content: string, runId: string | null = null): void {
  if (!content.trim()) return;
  postMessage({
    group_id: groupId,
    run_id: runId,
    sender_id: agent.id,
    sender_name: agent.name,
    content: content.slice(0, 4000),
    kind: 'chat',
  });
}

/** 选一个该员工最该同步结果的群：优先它最近发过言的那个群 */
function pickTargetGroup(agentId: string): string | null {
  const mine = db()
    .prepare('SELECT group_id FROM group_members WHERE agent_id = ?')
    .all(agentId) as { group_id: string }[];
  if (!mine.length) return null;
  let best: string | null = null;
  let bestT = -1;
  for (const { group_id } of mine) {
    const last = db()
      .prepare('SELECT created_at FROM messages WHERE group_id = ? AND sender_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(group_id, agentId) as { created_at: number } | undefined;
    const t = last?.created_at ?? 0;
    if (t > bestT) {
      bestT = t;
      best = group_id;
    }
  }
  return best;
}

/** 私聊里老板的话是否指向"群/工作区"的实际操作（需要真去改文件/发群） */
export function isGroupAction(text: string): boolean {
  return /(群|工作区|文件|文档|方案|\.md|看板|发群里|发到群|贴到群|同步到群|润色|修订|重做|整理|把(刚才|那份|群里|组里|这个|那|文)|更新一下|改一下|写一下|整理一下|改稿|润色一下|补充一下|重做一下)/.test(
    text
  );
}

/** 纯疑问句（没有点名文件时）不应被当成工作区操作，避免误改文件 */
export function looksLikeQuestion(text: string): boolean {
  return /[？?]$|[吗呢么]$|怎么|为什么|为何|是否|是不是|还是|啥|哪/.test(text);
}

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

/** 脱敏后再发给浏览器：key 只留末四位 */
export function publicAgent(a: Agent): AgentPublic {
  const { api_key, ...rest } = a;
  return {
    ...rest,
    key_set: !!api_key,
    key_hint: api_key ? `…${api_key.slice(-4)}` : '',
    binding: bindingLabel(a),
  };
}

export function publicAgents(list: Agent[]): AgentPublic[] {
  return list.map(publicAgent);
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

/* ----------------------------- 1-1 私聊 ----------------------------- */

export const dmId = (agentId: string) => `dm:${agentId}`;
export const isDm = (id: string) => id.startsWith('dm:');
export const dmAgentId = (id: string) => id.slice(3);

/**
 * 老板跟某个员工私聊。老板说的话只进这个员工的私有记忆，
 * 群里其他人看不到 —— 这就是"私下交代"的效果。
 */
export async function sendDm(agentId: string, content: string): Promise<void> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error('员工不存在');

  postMessage({
    group_id: dmId(agentId),
    run_id: null,
    sender_id: 'boss',
    sender_name: '老板',
    content,
    kind: 'human',
  });
  // 记忆写入交给 applyDirective 统一处理（它还会识别调岗指令）

  const p = parsePersona(agent.persona);
  const history = getMessages(dmId(agentId), 20).slice(-12);
  const privateMem = getMemories(agentId, 'private', 4);

  // 事实边界：不告诉它同事是谁，它就会编出一个"老张"来
  const mine = db()
    .prepare('SELECT group_id FROM group_members WHERE agent_id = ?')
    .all(agentId) as { group_id: string }[];
  const facts = mine
    .map((r) => {
      const f = groupFacts(r.group_id);
      return `群「${getGroup(r.group_id)?.name}」：${f.roster}`;
    })
    .join('\n');
  const recent = mine.length ? groupFacts(mine[0].group_id).recent : '';

  const sys = [
    agent.system_prompt,
    `你的说话风格：${p.tone}。口头禅：${p.catchphrase}。小习惯：${p.quirks.join('；') || '无'}。`,
    facts ? `你所在的群和真实同事名单：\n${facts}` : '你现在不属于任何群。',
    '**上面名单之外不存在其他同事。老板问起群里的情况，你只能说你知道的人；不知道就直说不知道，绝不许编人名、编对话、编进度。**',
    '现在是私聊，只有你和老板两个人。你可以说在群里不敢说的话，更真实、更直接。',
    '严格要求：中文口语，1-3 句，不要自称 AI，不要用 Markdown。',
  ].join('\n');

  const messages = [
    { role: 'system' as const, content: sys },
    {
      role: 'user' as const,
      content: `这是你和老板的私聊记录（最近几条）：
${history.map((m) => `${m.sender_id === 'boss' ? '老板' : agent.name}：${m.content}`).join('\n') || '（还没有聊过）'}
${recent ? `\n群里最近的真实对话（只有这些，别的内容当作不存在）：\n${recent}` : ''}
${privateMem.length ? `\n你自己的记忆：\n${privateMem.map((m) => `- ${m}`).join('\n')}` : ''}
老板刚说：${content}
现在回复老板。`,
    },
  ];

  const [lo, hi] = p.latency;
  await typing(dmId(agentId), agent, lo + Math.random() * Math.max(0, hi - lo));

  try {
    const reply = await chat({ tag: 'agent', messages, temperature: 0.95, audit: { agentId: agent.id, agentName: agent.name } }, bindingOf(agent));
    postMessage({
      group_id: dmId(agentId),
      run_id: null,
      sender_id: agent.id,
      sender_name: agent.name,
      content: stripToolBlocks(reply) || '……',
      kind: 'chat',
    });
  } catch (e) {
    // key 填错、余额不足、模型不可用都会走到这里。如实告诉老板，不要假装没事
    postMessage({
      group_id: dmId(agentId),
      run_id: null,
      sender_id: 'system',
      sender_name: '系统',
      content: `${agent.name} 没回上话：${String(e).slice(0, 160)}`,
      kind: 'system',
    });
  }
}

/**
 * 私聊操作通道：老板在 1-1 里给员工下达「关于群/工作区」的指令时，
 * 员工会真的去读群聊记录、读任务看板、改工作区文件，并把结果用 post_group 同步回群里。
 * 纯闲聊不要走这里（dm/route 会先判断意图）。
 */
export async function executeDmTask(agentId: string, content: string): Promise<void> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error('员工不存在');

  // 老板的原话先落进私聊界面，让用户立刻看到
  postMessage({
    group_id: dmId(agentId),
    run_id: null,
    sender_id: 'boss',
    sender_name: '老板',
    content,
    kind: 'human',
  });

  const target = pickTargetGroup(agentId);

  // 锁定要改的文件：优先从老板的话里提取文件名，否则取群里最近改动过的那个
  const mentioned = (content.match(/([\w\u4e00-\u9fa5-]+\.(?:md|txt|json|js|ts|py|html|css|yml|yaml|csv))/i) || [])[1];
  const file = mentioned || (target ? latestFile(target) : null);
  if (!target || !file) {
    // 没有可改的文件 / 群，退回普通私聊回复
    await sendDm(agentId, content);
    return;
  }

  const cur = readFile(target, file);
  const currentText = cur.ok ? cur.output : '';
  const board = readBoard(target);
  const groupHistory = getMessages(target, 80)
    .filter((m) => m.kind === 'chat' || m.kind === 'human')
    .slice(-16);
  const privateMem = getMemories(agentId, 'private', 4);

  const sys = [
    agent.system_prompt,
    `你是${agent.name}（${agent.role}）。老板在私聊里让你改工作区里的文件，并把结果发回群里。`,
    `你不需要贴任何工具代码：你只要产出"改好的完整文件内容"和"发到群里的一句话"，系统会帮你真正落盘和发群。`,
    `用中文，口语化，不要自称 AI，不要 Markdown 大标题。`,
  ]
    .filter(Boolean)
    .join('\n');

  const user = `你要处理的是群「${getGroup(target)?.name}」工作区里的文件：${file}
它的当前内容：
"""
${currentText || '（空文件或还不存在）'}
"""

老板的要求：${content}
${board ? `\n任务看板（工作区 ${BOARD_FILE}）：\n${board}\n` : ''}
${
  groupHistory.length
    ? `\n群里最近讨论：\n${groupHistory.map((m) => `${m.sender_name}：${m.content.slice(0, 160)}`).join('\n')}\n`
    : ''
}
${privateMem.length ? `\n你的记忆：\n${privateMem.map((m) => `- ${m}`).join('\n')}` : ''}

请只输出一个 JSON 对象，前后不要加任何文字或代码块标记：
{"content":"改好的完整文件内容（会整体覆盖写回 ${file}）","announce":"发到群里的一句话同步消息，说明你改了什么、建议谁接着看"}

要求：content 必须是改好的完整文件，不要留占位符；如果老板只是要润色，就保留原意只改表述。announce 要口语、带要点。`;

  try {
    await typing(dmId(agentId), agent, 900 + Math.random() * 1500);
    const raw = await chat(
      {
        tag: 'agent',
        messages: [
          { role: 'system' as const, content: sys },
          { role: 'user' as const, content: user },
        ],
        temperature: 0.7,
        maxTokens: 8000,
        json: true,
        audit: { agentId: agent.id, agentName: agent.name },
      },
      bindingOf(agent)
    );

    const obj = parseJsonObj(raw);
    if (!obj || typeof obj.content !== 'string') throw new Error('模型没有返回可写入的内容');

    // 确定性执行：真正落盘 + 发群，不再依赖模型连发多个工具
    writeFile(target, file, obj.content);
    postToGroup(agent, target, obj.announce || `已更新 ${file}：${obj.content.slice(0, 200)}`, null);

    postMessage({
      group_id: dmId(agentId),
      run_id: null,
      sender_id: agent.id,
      sender_name: agent.name,
      content: `已按你的要求改好 ${file}，并同步到了群里。`,
      kind: 'chat',
    });
  } catch (e) {
    postMessage({
      group_id: dmId(agentId),
      run_id: null,
      sender_id: 'system',
      sender_name: '系统',
      content: `${agent.name} 没执行成功：${String(e).slice(0, 160)}`,
      kind: 'system',
    });
  }
}

/* ----------------------------- 事实边界 / @ 点名 ----------------------------- */

/**
 * 模型不知道自己有哪些同事，就会开始编人名（"老张""小王"之类）。
 * 每次对话都必须把真实成员名单塞进去，并明确禁止编造不在名单上的人。
 */
export function groupFacts(groupId: string): { roster: string; recent: string } {
  const g = getGroup(groupId);
  const members = getMembers(groupId);
  const roster = members
    .map((m) => `${m.name}（${m.role}${m.id === g?.leader_id ? '，组长' : ''}）`)
    .join('、');
  const recent = getMessages(groupId, 200)
    .filter((m) => m.kind === 'chat' || m.kind === 'human')
    .slice(-10)
    .map((m) => `${m.sender_name}：${m.content.slice(0, 120)}`)
    .join('\n');
  return { roster, recent };
}

/**
 * 兜底落盘：模型经常嘴上说"我写好了"，但根本没输出工具调用块。
 * 只要它在回复里点明了一个文件名，就把这条回复落成那个文件 —— 至少产出是真的。
 * 注意：这是展示层之外的"补救"，不是假装它调用了工具，群里会明说是系统存的。
 */
export function saveMentionedFile(groupId: string, agentName: string, text: string): string | null {
  if (!text) return null;
  const m = /([\w\u4e00-\u9fa5-]+\.(?:md|txt|json|js|ts|py|html|css|yml|yaml|csv))/i.exec(text);
  if (!m) return null;
  const name = m[1].replace(/^[\\/]+/, '');
  const res = writeFile(groupId, name, `${text}\n\n— ${agentName}`);
  if (!res.ok) return null;
  postMessage({
    group_id: groupId,
    run_id: null,
    sender_id: 'system',
    sender_name: '系统',
    content: `已把 ${agentName} 的回复存成文件：${name}（${res.output}）`,
    kind: 'system',
  });
  return name;
}

/** 老板在群里 @ 了某个人 —— 那个人必须当场回话，不能装没看见 */
export async function replyInGroup(groupId: string, agentId: string, question: string): Promise<void> {
  const g = getGroup(groupId);
  const agent = getAgent(agentId);
  if (!g || !agent) return;

  const p = parsePersona(agent.persona);
  const { roster, recent } = groupFacts(groupId);
  const privateMem = getMemories(agentId, 'private', 4);

  const sys = [
    agent.system_prompt,
    `你的说话风格：${p.tone}。口头禅：${p.catchphrase}。`,
    `你所在的是群「${g.name}」。群里的成员只有这几个人：${roster}。`,
    '除了上面名单里的人，不存在其他同事。你不知道的人名一律不要提，也不要编造任何人的发言。',
    '严格要求：中文口语，像在微信群里说话，不要自称 AI，不要用 Markdown 标题。',
    '不要只说"收到""好的""这就做"。老板要的是内容本身：要么直接在群里把结果写出来，要么真的落成文件。',
    agent.tools_enabled
      ? `你可以读写文件，只能写相对路径（会落在 workspace/${g.id}/ 下），绝对不能用 /Users、/Desktop 这类绝对路径。
老板让你出文档、写代码、整理清单时，你必须真的写文件 —— 先把正文说完，再在回复最后附：
\`\`\`json
{"tool":"write_file","args":{"path":"tech.md","content":"文件的完整内容"}}
\`\`\`
不要只在嘴上说"我写好了"却什么都没做。`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const messages = [
    { role: 'system' as const, content: sys },
    {
      role: 'user' as const,
      content: `群里最近的对话：
${recent || '（还没人说话）'}
${privateMem.length ? `\n你自己的记忆：\n${privateMem.map((m) => `- ${m}`).join('\n')}` : ''}
老板在群里点名问你：${question}
现在回老板的话。`,
    },
  ];

  try {
    let text = await chat({ tag: 'agent', messages, temperature: 0.9, maxTokens: 8000, audit: { groupId, agentId: agent.id, agentName: agent.name } }, bindingOf(agent));

    // 和群聊主循环一样，@ 点名也必须真的能干活 —— 这里要有工具循环
    let wrote = false;
    if (agent.tools_enabled) {
      const call = parseToolCall(text);
      if (call && call.tool === 'post_group') {
        // 群内发言本就会落在群里，不需要再重复发布
        text = stripToolBlocks(text);
      } else if (call) {
        const res = runTool(groupId, call);
        if (!res.ok && /越界/.test(res.output)) logSandboxBlock(groupId, `${agent.name}: ${res.output}`);
        postMessage({
          group_id: groupId,
          run_id: null,
          sender_id: agent.id,
          sender_name: agent.name,
          content: `[工具] ${call.tool} ${call.args.path || ''} → ${res.output.slice(0, 200)}`,
          kind: res.ok ? 'tool_result' : 'tool',
        });
        if (res.ok && call.tool === 'write_file') wrote = true;
        const follow = await chat(
          {
            tag: 'agent',
            messages: [
              ...messages,
              { role: 'assistant' as const, content: text },
              { role: 'user' as const, content: `工具执行结果：${res.output}\n用一句口语告诉群里写好了，不要再输出代码块。` },
            ],
            temperature: 0.9,
            maxTokens: 600,
            audit: { groupId, agentId: agent.id, agentName: agent.name },
          },
          bindingOf(agent)
        );
        text = stripToolBlocks(follow) || stripToolBlocks(text);
      }
    }

    const finalText = stripToolBlocks(text);
    postMessage({
      group_id: groupId,
      run_id: null,
      sender_id: agent.id,
      sender_name: agent.name,
      content: finalText || '……',
      kind: 'chat',
    });
    if (!wrote) saveMentionedFile(groupId, agent.name, finalText);
  } catch (e) {
    // 调不通就如实说，不要静默失败 —— 那种"群里没人理你"最难排查
    postMessage({
      group_id: groupId,
      run_id: null,
      sender_id: 'system',
      sender_name: '系统',
      content: `${agent.name} 没回上话：${String(e).slice(0, 180)}`,
      kind: 'system',
    });
  }
}

/* ----------------------------- 建员工 / 建群 ----------------------------- */

export function createAgent(input: {
  id?: string;
  name: string;
  avatar?: string;
  role: string;
  system_prompt: string;
  provider?: string;
  base_url?: string;
  api_key?: string;
  model?: string;
  sassiness?: number;
  tone?: string;
  catchphrase?: string;
  tools_enabled?: number;
}): Agent {
  const id = (input.id || input.name).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '').slice(0, 20) || uid('a');
  if (getAgent(id)) throw new Error(`已经有一个叫「${id}」的员工了`);

  const persona = JSON.stringify({
    tone: input.tone || '说话直接，有自己的主见',
    catchphrase: input.catchphrase || '',
    latency: [800, 2600],
    sassiness: input.sassiness ?? 0.3,
    quirks: [],
    workHours: [9, 23],
  });

  db()
    .prepare(
      'INSERT INTO agents (id,name,avatar,role,system_prompt,model,provider,base_url,api_key,persona,tools_enabled,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(
      id,
      input.name,
      input.avatar || input.name.slice(0, 1),
      input.role,
      input.system_prompt,
      input.model || '',
      input.provider || '',
      input.base_url || '',
      input.api_key || '',
      persona,
      input.tools_enabled ?? 0,
      Date.now()
    );
  return getAgent(id)!;
}

/** 更新已有员工的模型配置；空 key 表示保留旧 key，避免前端读取或回传密钥。 */
export function updateAgentConnection(
  id: string,
  input: { provider?: string; base_url?: string; model?: string; api_key?: string; reasoning_effort?: string; role?: string; system_prompt?: string }
): Agent {
  const agent = getAgent(id);
  if (!agent) throw new Error('员工不存在');

  const provider = (input.provider ?? agent.provider).trim();
  const baseUrl = (input.base_url ?? agent.base_url).trim();
  const model = (input.model ?? agent.model).trim();
  const apiKey = input.api_key?.trim() || agent.api_key;
  const reasoningEffort = input.reasoning_effort?.trim() || agent.reasoning_effort;
  const role = input.role?.trim() || agent.role;
  const systemPrompt = input.system_prompt?.trim() || agent.system_prompt;
  db()
    .prepare('UPDATE agents SET provider = ?, base_url = ?, model = ?, api_key = ?, reasoning_effort = ?, role = ?, system_prompt = ? WHERE id = ?')
    .run(provider, baseUrl, model, apiKey, reasoningEffort, role, systemPrompt, id);
  return getAgent(id)!;
}

export function createGroup(input: {
  id?: string;
  name: string;
  topic?: string;
  leaderId: string;
  criticId?: string;
  memberIds: string[];
}): Group {
  const id = input.id || `g_${Date.now().toString(36)}`;
  const members = input.memberIds.filter((m) => getAgent(m));
  if (!members.includes(input.leaderId)) members.push(input.leaderId);
  if (members.length < 2) throw new Error('一个群至少要两个人');

  const critic = input.criticId && members.includes(input.criticId)
    ? input.criticId
    : members.find((m) => m !== input.leaderId) || input.leaderId;

  db()
    .prepare('INSERT INTO groups (id,name,topic,leader_id,critic_id,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, input.name, input.topic || '', input.leaderId, critic, Date.now());
  const ins = db().prepare('INSERT INTO group_members (group_id,agent_id) VALUES (?,?)');
  for (const m of members) ins.run(id, m);

  postMessage({
    group_id: id,
    run_id: null,
    sender_id: 'system',
    sender_name: '系统',
    content: `群「${input.name}」已建立，组长是${getAgent(input.leaderId)?.name}。发个任务试试。`,
    kind: 'system',
  });
  return getGroup(id)!;
}

/* ----------------------------- 删除 ----------------------------- */

/**
 * 删员工。级联规则：
 * - 它在群里发过的历史消息**保留**（聊天记录不能凭空断裂，sender_name 是冗余存的）
 * - 它当组长的群由剩下的第一个成员接手；没人了就把群解散
 * - 它的私聊、朋友圈、私有记忆全部清掉
 */
export function deleteAgent(id: string): { removedFrom: string[]; dissolved: string[] } {
  const d = db();
  const agent = getAgent(id);
  if (!agent) throw new Error('员工不存在');

  const removedFrom: string[] = [];
  const dissolved: string[] = [];

  const mine = d.prepare('SELECT group_id FROM group_members WHERE agent_id = ?').all(id) as { group_id: string }[];
  for (const { group_id } of mine) {
    d.prepare('DELETE FROM group_members WHERE group_id = ? AND agent_id = ?').run(group_id, id);
    const rest = d.prepare('SELECT agent_id FROM group_members WHERE group_id = ?').all(group_id) as {
      agent_id: string;
    }[];
    const g = getGroup(group_id);
    if (!g) continue;

    if (rest.length === 0) {
      dissolved.push(g.name);
      d.prepare('DELETE FROM groups WHERE id = ?').run(group_id);
      d.prepare('DELETE FROM messages WHERE group_id = ?').run(group_id);
      continue;
    }

    removedFrom.push(g.name);
    if (g.leader_id === id) {
      d.prepare('UPDATE groups SET leader_id = ? WHERE id = ?').run(rest[0].agent_id, group_id);
    }
    const g2 = getGroup(group_id)!;
    if (g2.critic_id === id) {
      const next = rest.find((r) => r.agent_id !== g2.leader_id)?.agent_id ?? rest[0].agent_id;
      d.prepare('UPDATE groups SET critic_id = ? WHERE id = ?').run(next, group_id);
    }
  }

  // 私有数据全清
  d.prepare('DELETE FROM messages WHERE group_id = ?').run(dmId(id));
  d.prepare('DELETE FROM memories WHERE agent_id = ?').run(id);
  d.prepare('DELETE FROM moment_comments WHERE agent_id = ?').run(id);
  const mids = d.prepare('SELECT id FROM moments WHERE agent_id = ?').all(id) as { id: string }[];
  for (const m of mids) d.prepare('DELETE FROM moment_comments WHERE moment_id = ?').run(m.id);
  d.prepare('DELETE FROM moments WHERE agent_id = ?').run(id);
  d.prepare('DELETE FROM agents WHERE id = ?').run(id);
  d.prepare("DELETE FROM memories WHERE agent_id = '__group__'").run();

  return { removedFrom, dissolved };
}

export function deleteGroup(id: string): void {
  const d = db();
  d.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
  d.prepare('DELETE FROM messages WHERE group_id = ?').run(id);
  d.prepare('DELETE FROM groups WHERE id = ?').run(id);
}

/** 删之前给一段"它到底干了什么"的交代 —— 有真模型就让模型提炼，没有就拼统计数据 */
export async function agentSummary(id: string): Promise<{ stats: Record<string, number>; summary: string }> {
  const d = db();
  const agent = getAgent(id);
  if (!agent) throw new Error('员工不存在');

  const talks = d
    .prepare("SELECT content FROM messages WHERE sender_id = ? AND kind = 'chat' ORDER BY created_at DESC LIMIT 40")
    .all(id) as { content: string }[];
  const appeals = d.prepare("SELECT COUNT(*) c FROM messages WHERE group_id = ? AND kind = 'appeal'").get(dmId(id)) as {
    c: number;
  };
  const mems = d.prepare('SELECT content FROM memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10').all(id) as {
    content: string;
  }[];
  const groupCount = (d.prepare('SELECT COUNT(*) c FROM group_members WHERE agent_id = ?').get(id) as { c: number }).c;

  const stats = {
    群聊发言: talks.length,
    所在群: groupCount,
    越级汇报: appeals.c,
    记忆条数: mems.length,
  };

  if (!talks.length) {
    return { stats, summary: `${agent.name}（${agent.role}）还没在任何一个群里说过话。` };
  }

  const lines = talks.slice(0, 12).map((t) => `- ${t.content.slice(0, 90)}`).join('\n');
  const out = await chat(
    {
      tag: 'summary',
      messages: [
        {
          role: 'user' as const,
          content: `下面是员工「${agent.name}」（${agent.role}）最近在群里的发言。
${lines}

请用三到五句话，提炼它这段时间实际做了什么、持什么立场、产出过什么。
要具体，不要空话，不要夸它。像写给交接人的岗位交接说明。`,
        },
      ],
      temperature: 0.5,
      maxTokens: 260,
    },
    bindingOf(agent)
  );

  return { stats, summary: out.trim() };
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

/** 从模型输出里抠出一个 JSON 对象（容错：忽略前后废话和代码块标记） */
function parseJsonObj(raw: string): { content?: string; announce?: string } | null {
  let s = (raw || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < 0) return null;
  try {
    const o = JSON.parse(s.slice(a, b + 1));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

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

async function leaderTurn(
  group: Group,
  run: { id: string; goal: string; round: number },
  digest: string[],
  humanNotes: string[]
): Promise<{ out: LeaderOut | null; raw: string }> {
  const leader = getAgent(group.leader_id);
  if (!leader) return { out: null, raw: '(组长不存在)' };
  const members = getMembers(group.id).filter((a) => a.id !== leader.id);
  const ids = members.map((a) => `${a.id}(${a.name}·${a.role})`).join('、');

  const board = readBoard(group.id);
  const files = groupFileList(group.id);

  const messages = [
    { role: 'system' as const, content: leader.system_prompt },
    {
      role: 'user' as const,
      content: `你是群「${group.name}」的组长，负责把目标拆给对的人、盯进度、判断收工。
目标：${run.goal}
当前第 ${run.round} 轮（最多 ${MAX_ROUNDS} 轮）。
可选成员：${ids}
${
  board
    ? `**任务看板（工作区 ${BOARD_FILE}，进度速览，不必逐字照念）**：\n${board}\n`
    : '（还没有任务看板，第一轮请先拆解目标并分派。）'
}
当前工作区文件清单：\n${files}

到目前为止的讨论：
${digest.length ? digest.map((d, i) => `${i + 1}. ${d}`).join('\n') : '（还没有人发言）'}
${humanNotes.length ? `\n老板（人类管理员）的插话：\n${humanNotes.join('\n')}\n请认真对待老板的话。` : ''}

要求：
- 只输出 JSON，不要其他文字。三选一：
  {"action":"dispatch","items":[{"to":"成员id","instruction":"具体任务（要指明参考哪个文件、产出哪个文件"}]}
  {"action":"converge","summary":"结论","acceptance":["验收项"]}
  {"action":"ask_human","question":"要问老板的问题"}
- 把任务**在群里 @ 对应成员说清楚**是你的主要推进手段，像真实组长那样面对面分工，不要只靠文档。看板/文件清单里已有成员写好的产出时，要么指定某人去审查/对接它，要么就收敛；不要假装没看见、每次都从零开始。
- 讨论里若有人提出了需要拍板的问题（尤其 @ 了你或 @ 了同事），先处理那个问题（dispatch 让它被解决，或你自己 ask_human），不要无视。
- 不要为了"留档"强迫成员写没必要的文件：只有任务确实要交付文档/代码/清单时才让它写文件；纯沟通对齐在群里说清即可。
- 只有当关键分派都已有对应产出或成员确认完成时，才用 converge；否则继续分派下一步，最多分派 ${Math.min(3, members.length)} 个成员。`,
    },
  ];

  let raw = '';
  try {
    raw = await chat(
      { tag: 'leader', messages, temperature: 0.7, json: true, maxTokens: 3000, audit: { runId: run.id, groupId: group.id, agentId: leader.id, agentName: leader.name } },
      bindingOf(leader)
    );
  } catch (e) {
    raw = `调用失败：${String(e)}`;
  }
  return { out: parseLeaderOut(raw), raw };
}

/* ----------------------------- 成员 ----------------------------- */

async function agentTurn(
  group: Group,
  run: { id: string; goal: string; round: number },
  agent: Agent,
  instruction: string,
  related: string[]
): Promise<{ text: string; wroteFile: boolean }> {
  const p = parsePersona(agent.persona);
  const privateMem = getMemories(agent.id, 'private', 3);

  const sys = [
    agent.system_prompt,
    `你的说话风格：${p.tone}。口头禅：${p.catchphrase}。小习惯：${p.quirks.join('；') || '无'}。`,
    `严格要求：用中文口语回复，像在微信群里说话，不要自称 AI，不要用 Markdown 标题。一般性讨论 1-3 句即可；但如果你的任务是要产出文件/文档/代码，正文请写进 write_file 的内容里（可以写很长、很完整），群里只回一句"已写出 XXX"。`,
    `协作纪律：主要靠群聊推进，组长在群里 @ 你时会把任务说清楚，照着干即可；任务看板只是进度速览，有必要时才去读。需要和其他人配合时，直接在群里 @ 对方沟通，像真实团队一样。`,
    `遇到缺信息、和别人方案冲突、或需要有人拍板的事，直接在群里说出来并 @ 负责人（组长或负责那块的同事），把问题摆到台面上等裁断，不要闷头猜、也不要自己擅自拍板。`,
    agent.tools_enabled
      ? `如果你需要读写文件，回复的最后附一个代码块：\n\`\`\`json\n{"tool":"write_file","args":{"path":"notes.md","content":"内容"}}\n\`\`\`\n可选工具：read_file(path) / write_file(path,content) / list_files()。不要用它做无关的事。如果你产出了文件，结尾说清楚你交了什么、建议谁接着看。`
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

  const bind = bindingOf(agent);
  let wroteFile = false;
  let text = await chat({ tag: 'agent', messages, temperature: 0.9, maxTokens: 8000, audit: { runId: run.id, groupId: group.id, agentId: agent.id, agentName: agent.name } }, bind);

  // 复读检测必须放在工具执行之前：否则被丢弃的第一版回复已经把工具跑了一遍，
  // 群里会留下两条一模一样的工具消息
  if (isRepeat(agent.id, group.id, stripToolBlocks(text))) {
    log(`检测到 ${agent.name} 复读，强制换角度`);
    text = await chat(
      {
        tag: 'agent',
        messages: [
          ...messages,
          { role: 'user' as const, content: '注意：你刚才说的和之前重复了，换一个角度，说点新的。' },
        ],
        temperature: 1.0,
        audit: { runId: run.id, groupId: group.id, agentId: agent.id, agentName: agent.name },
      },
      bind
    );
  }

  // 一次 ReAct：解析工具调用 → 执行 → 把结果喂回去再要一次最终回复
  if (agent.tools_enabled) {
    const call = parseToolCall(text);
    if (call && call.tool === 'post_group') {
      // 群内发言本就会落在群里，不需要再重复发布
      text = stripToolBlocks(text);
    }         else if (call) {
          const res = runTool(group.id, call);
          if (res.ok && call.tool === 'write_file') wroteFile = true;
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
      const follow = await chat(
        {
          tag: 'agent',
          messages: [
            ...messages,
            { role: 'assistant' as const, content: text },
            { role: 'user' as const, content: `工具执行结果：${res.output}\n现在用一句口语把结果说给群里听，不要再输出代码块。` },
          ],
          temperature: 0.9,
          audit: { runId: run.id, groupId: group.id, agentId: agent.id, agentName: agent.name },
        },
        bind
      );
      // 兜底：不管后续回复有没有内容，工具代码块都不能漏到群里
      const cleaned = stripToolBlocks(follow);
      text = cleaned || stripToolBlocks(text) || '文件已经写好。';
    }
  }

  text = stripToolBlocks(text);
  return { text: text || '……', wroteFile };
}

/* ----------------------------- 越级汇报 ----------------------------- */

/**
 * 越级汇报是员工的自主行为，不是定时任务，也不是概率抽奖。
 * 先收集"它可能真受委屈了"的客观素材；没素材就完全不打扰它（连 token 都不花）；
 * 有素材才把情况摆给它，让它自己决定说还是不说 —— 它可以回答 NO。
 */
function collectGrievances(
  instruction: string,
  round: number,
  pastInstructions: string[]
): string[] {
  const g: string[] = [];
  const sameCount = pastInstructions.filter((i) => i === instruction).length;
  if (sameCount >= 2) g.push(`组长已经是第 ${sameCount} 次把同一件事丢给你：${instruction}`);
  if (/改一下|再改|重做|返工|推翻|回退|换成|重来/.test(instruction))
    g.push('你被要求改动 / 重做已经做过的东西');
  if (pastInstructions.length >= 3) g.push(`组长已经给你派了 ${pastInstructions.length} 次活，一直没完`);
  if (round >= 5) g.push(`整个群讨论到第 ${round} 轮还没结论`);
  return g;
}

async function maybeAppeal(
  group: Group,
  run: { id: string; goal: string; round: number },
  agent: Agent,
  instruction: string,
  reply: string,
  grievances: string[]
): Promise<void> {
  if (!grievances.length) return;

  const text = await chat(
    {
      tag: 'appeal',
      messages: [
        { role: 'system' as const, content: agent.system_prompt },
        {
          role: 'user' as const,
          content: `你在群「${group.name}」里干活，现在进行到第 ${run.round} 轮。
组长刚给你的指令：${instruction}
你的回复：${reply}

你注意到这些情况：
${grievances.map((x) => `- ${x}`).join('\n')}

你可以私下找"老板"（这个群的人类管理员，上帝视角）反馈，也可以选择不说。
判断权完全在你：只有在你真觉得组长安排不合理、被反复折腾、或者你的专业判断被无视到会影响结果时才说。
如果只是正常讨论，或者虽然有点烦但忍得下去，那就别打扰老板 —— 这种情况下只回复 NO 两个字。

如果要说：一两句口语，说出真实的不满，引用具体的事，像员工私下找老板吐槽，不要撒娇，不要自称 AI。
如果不说：只回复 NO。`,
        },
      ],
      temperature: 1.0,
      maxTokens: 200,
      audit: { runId: run.id, groupId: group.id, agentId: agent.id, agentName: agent.name },
    },
    bindingOf(agent)
  );

  const t = text.trim().replace(/^[\s"'`「」『』]+|[\s"'`「」『』]+$/g, '');
  if (!t || /^(NO|no|不|没有|没事|算了|无可奉告)/.test(t) || t.length < 6) return;

  postMessage({
    group_id: dmId(agent.id),
    run_id: run.id,
    sender_id: agent.id,
    sender_name: agent.name,
    content: t,
    kind: 'appeal',
    meta: JSON.stringify({ group: group.name, grievances }),
  });
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
  db().prepare("UPDATE run_jobs SET status = 'cancelled', updated_at = ? WHERE run_id = ? AND status IN ('queued','running')").run(Date.now(), runId);
}

function runIsActive(runId: string): boolean {
  const row = db().prepare('SELECT status FROM runs WHERE id = ?').get(runId) as { status?: string } | undefined;
  return row?.status === 'running' && !runState(runId).stopped;
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

  const now = Date.now();
  db()
    .prepare('INSERT INTO run_jobs (id,run_id,status,attempts,available_at,locked_until,last_error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(uid('job'), runId, 'queued', 0, now, null, null, now, now);

  return runId;
}

/**
 * 从 SQLite 领取一个任务并执行。任务、锁和重试状态都在数据库中，进程重启后不会丢；
 * 本地由浏览器轮询触发，部署时可由 cron/独立 worker 调用 /api/worker。
 */
export async function processOneRunJob(): Promise<{ processed: boolean; runId?: string; status?: string }> {
  const d = db();
  const now = Date.now();
  const job = d
    .prepare("SELECT * FROM run_jobs WHERE (status = 'queued' AND available_at <= ?) OR (status = 'running' AND locked_until < ?) ORDER BY available_at ASC LIMIT 1")
    .get(now, now) as { id: string; run_id: string; attempts: number } | undefined;
  if (!job) return { processed: false };

  const claimed = d
    .prepare("UPDATE run_jobs SET status = 'running', attempts = attempts + 1, locked_until = ?, updated_at = ? WHERE id = ? AND (status = 'queued' OR (status = 'running' AND locked_until < ?))")
    // 单个群任务会连续调用多个模型；租约覆盖长任务，避免第二个浏览器重复领取。
    .run(now + 2 * 60 * 60_000, now, job.id, now);
  if (!claimed.changes) return { processed: false };

  const run = d.prepare('SELECT * FROM runs WHERE id = ?').get(job.run_id) as Run | undefined;
  if (!run || run.status !== 'running') {
    d.prepare("UPDATE run_jobs SET status = 'cancelled', locked_until = NULL, updated_at = ? WHERE id = ?").run(Date.now(), job.id);
    return { processed: true, runId: job.run_id, status: 'cancelled' };
  }
  const group = getGroup(run.group_id);
  if (!group) {
    setStatus(run.id, 'error', run.round);
    d.prepare("UPDATE run_jobs SET status = 'failed', locked_until = NULL, last_error = ?, updated_at = ? WHERE id = ?").run('群不存在', Date.now(), job.id);
    return { processed: true, runId: run.id, status: 'failed' };
  }

  try {
    await loop(group, { id: run.id, goal: run.goal, round: run.round });
    d.prepare("UPDATE run_jobs SET status = 'done', locked_until = NULL, updated_at = ? WHERE id = ?").run(Date.now(), job.id);
    return { processed: true, runId: run.id, status: 'done' };
  } catch (error) {
    const attempts = job.attempts + 1;
    const message = String(error).slice(0, 500);
    if (attempts >= 3) {
      writeBoard(run.group_id, run.goal, run.round, [], '异常/已中止（重试失败）');
      setStatus(run.id, 'error', run.round);
      d.prepare("UPDATE run_jobs SET status = 'failed', locked_until = NULL, last_error = ?, updated_at = ? WHERE id = ?").run(message, Date.now(), job.id);
      return { processed: true, runId: run.id, status: 'failed' };
    }
    const retryAt = Date.now() + attempts * 5_000;
    d.prepare("UPDATE run_jobs SET status = 'queued', available_at = ?, locked_until = NULL, last_error = ?, updated_at = ? WHERE id = ?").run(retryAt, message, Date.now(), job.id);
    return { processed: true, runId: run.id, status: 'retrying' };
  }
}

async function loop(group: Group, run: { id: string; goal: string; round: number }): Promise<void> {
  const members = getMembers(group.id);
  const previous = getMessages(group.id, 500).filter((m) => m.run_id === run.id && m.kind === 'chat');
  const digest: string[] = previous.map((m) => `${m.sender_name}：${m.content}`);
  const spoken = new Set(previous.map((m) => m.sender_id));
  const instructionLog: Record<string, string[]> = {};
  let round = run.round;

  // 先把任务看板建起来，让成员动手前就能读到"目标 + 当前进度"
  writeBoard(group.id, run.goal, round, [], '进行中（组长拆解中）');

  while (round < MAX_ROUNDS) {
    if (!runIsActive(run.id)) return;
    round++;
    run.round = round;
    setStatus(run.id, 'running', round);

    const humanNotes = getMessages(group.id)
      .filter((m) => m.kind === 'human' && m.run_id === run.id)
      .slice(-3)
      .map((m) => m.content);

    await typing(group.id, getAgent(group.leader_id) ?? members[0], 900 + Math.random() * 1200);
    const { out, raw } = await leaderTurn(group, run, digest.slice(-12), humanNotes);
    if (!out) {
      // 把组长到底吐了什么摆到台面上 —— 模型出问题不该表现为"群里一片安静"
      log('组长输出无法解析，本轮跳过');
      postMessage({
        group_id: group.id,
        run_id: run.id,
        sender_id: 'system',
        sender_name: '系统',
        content: `组长这一轮没给出有效指令。原始输出：${(raw || '(空)').slice(0, 260)}`,
        kind: 'system',
      });
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
      writeBoard(group.id, run.goal, round, [], '已完成');
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

    // 组长把这一轮分派同步到群聊 + 任务看板，让所有人知道谁该干什么
    const leaderName = getAgent(group.leader_id)?.name ?? '组长';
    const dispatchLines = items
      .map((it) => `· ${getAgent(it.to)?.name ?? it.to}：${it.instruction}`)
      .join('\n');
    postMessage({
      group_id: group.id,
      run_id: run.id,
      sender_id: group.leader_id,
      sender_name: leaderName,
      content: `【第 ${round} 轮分派】\n${dispatchLines}\n（分工以群里 @ 你的内容为准，需要回看时可打开工作区 ${BOARD_FILE}）`,
      kind: 'chat',
    });
    writeBoard(
      group.id,
      run.goal,
      round,
      items.map((it) => ({ name: getAgent(it.to)?.name ?? it.to, instruction: it.instruction })),
      '进行中'
    );

    // 给成员喂入当前看板与文件清单，确保它们基于团队进度接着干
    const wsContext = [
      `任务看板（工作区 ${BOARD_FILE}）：`,
      readBoard(group.id) || '（无）',
      '工作区已有文件：',
      groupFileList(group.id),
    ].join('\n');

    for (const item of items.slice(0, 4)) {
      if (!runIsActive(run.id)) return;
      const agent = getAgent(item.to);
      if (!agent) continue;
      const p = parsePersona(agent.persona);
      const [lo, hi] = p.latency;
      const delay = lo + Math.random() * Math.max(0, hi - lo);

      await typing(group.id, agent, delay);
      const turn = await agentTurn(group, run, agent, item.instruction, [wsContext, ...digest.slice(-6)]);
      const text = turn.text;

      postMessage({
        group_id: group.id,
        run_id: run.id,
        sender_id: agent.id,
        sender_name: agent.name,
        content: text,
        kind: 'chat',
      });
      if (!turn.wroteFile) saveMentionedFile(group.id, agent.name, text);
      digest.push(`${agent.name}：${text}`);
      spoken.add(agent.id);

      const log4 = (instructionLog[agent.id] ??= []);
      log4.push(item.instruction);

      // 它自己决定要不要找老板，不是我们替它决定
      void maybeAppeal(
        group,
        run,
        agent,
        item.instruction,
        text,
        collectGrievances(item.instruction, round, log4)
      );
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
  return {
    mode: mode(),
    provider: provider(),
    model: modelName(),
    globalKey: !!process.env.LLM_API_KEY,
  };
}
