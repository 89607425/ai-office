import { db } from './db';
import { chat } from './llm';
import { addMemory, bindingOf, getAgent, getAgents, postMessage } from './kernel';
import type { Agent } from './types';

const ROLE_CHANGE_HINT =
  /不用干|别干|别做|不用做|转去做|转去当|去当|去做|改成|改为|换成|换岗|调岗|调到|负责起|接手|不再负责|以后只|从今天起|以后就/;

/**
 * 老板说的话要落进员工记忆里，而且是要落进"被点名的那个"员工的记忆里。
 * 更进一步的：如果这句话是在调整它的岗位职责，就直接改它的档案，
 * 光记在脑子里没用 —— 下次它说话还是按旧岗位说。
 */
export async function applyDirective(
  text: string,
  opts: { groupId?: string; forcedAgentId?: string }
): Promise<string[]> {
  const notes: string[] = [];
  const targets = pickTargets(text, opts.forcedAgentId);

  if (!targets.length) {
    // 群里没点名，就当是给全体的背景信息
    if (opts.groupId) {
      db()
        .prepare('INSERT INTO memories (id,agent_id,scope,content,created_at) VALUES (?,?,?,?,?)')
        .run(`mem_${Date.now().toString(36)}`, '__group__', 'group', `老板在群里说：${text}`, Date.now());
      notes.push('已记入本群共享背景');
    }
    return notes;
  }

  for (const a of targets) {
    addMemory(a.id, 'private', `老板对我说：${text}`);
    notes.push(`已写进 ${a.name} 的记忆`);

    if (!ROLE_CHANGE_HINT.test(text)) continue;

    const patch = await buildPatch(a, text);
    if (!patch) continue;

    db().prepare('UPDATE agents SET role = ?, system_prompt = ? WHERE id = ?').run(patch.role, patch.prompt, a.id);
    addMemory(a.id, 'private', `我的岗位职责被老板调整为：${patch.role}`);
    notes.push(`${a.name} 的岗位已改为「${patch.role}」`);

    if (opts.groupId) {
      postMessage({
        group_id: opts.groupId,
        run_id: null,
        sender_id: 'system',
        sender_name: '系统',
        content: `已按老板的意思，把 ${a.name} 的岗位调整为「${patch.role}」，人设同步更新。`,
        kind: 'system',
      });
    }
  }
  return notes;
}

function pickTargets(text: string, forcedAgentId?: string): Agent[] {
  if (forcedAgentId) {
    const a = getAgent(forcedAgentId);
    return a ? [a] : [];
  }
  const all = getAgents();
  return all.filter((a) => text.includes(`@${a.name}`) || text.includes(a.name));
}

type Patch = { role: string; prompt: string };

async function buildPatch(agent: Agent, directive: string): Promise<Patch | null> {
  const out = await chat(
    {
      tag: 'directive',
      messages: [
        {
          role: 'user' as const,
          content: `员工「${agent.name}」现在的岗位和人设是：
岗位：${agent.role}
人设：${agent.system_prompt}

老板对它下达了一条新指令：
${directive}

这条指令改变了它的岗位职责。请给出调整后的岗位与人设。
只输出 JSON：{"role":"新岗位（不超过10个字）","prompt":"新人设（第二人称，说明它是谁、负责什么、怎么说话，200字以内，保留它原本的性格特点）"}
如果你判断这不是岗位调整，输出 {"role":"","prompt":""}`,
        },
      ],
      temperature: 0.4,
      maxTokens: 400,
      json: true,
    },
    bindingOf(agent)
  );

  try {
    const raw = out.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    const obj = JSON.parse(raw.slice(s, e + 1)) as { role?: string; prompt?: string };
    if (!obj.role || !obj.prompt) return null;
    return { role: obj.role.slice(0, 20), prompt: obj.prompt };
  } catch {
    return null;
  }
}
