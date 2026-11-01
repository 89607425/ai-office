import { addModelCallLog } from './db';

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

export type LLMMode = 'live' | 'demo';

export type LLMCall = {
  tag: 'leader' | 'agent' | 'moment' | 'comment' | 'appeal' | 'summary' | 'directive';
  messages: ChatMsg[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  /** 演示模式用的上下文提示，真实模式忽略 */
  hint?: string;
  /** 仅记录元信息，不记录提示词或回复内容。 */
  audit?: { runId?: string; groupId?: string; agentId?: string; agentName?: string };
};

const PROVIDERS: Record<string, { baseURL: string; model: string }> = {
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  moonshot: { baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  siliconflow: { baseURL: 'https://api.siliconflow.cn/v1', model: 'zai-org/GLM-5.3-Flash' },
};

/**
 * 每个员工可以有自己的厂商和 key。
 * 解析优先级：员工档案 > .env.local 全局兜底 > 演示模式。
 */
export type Binding =
  | { provider?: string; apiKey?: string; model?: string; baseUrl?: string }
  | null
  | undefined;

export type Resolved = {
  mode: LLMMode;
  baseURL: string;
  model: string;
  key: string;
  provider: string;
  label: string;
};

export function resolve(b: Binding): Resolved {
  const provider = (b?.provider || process.env.LLM_PROVIDER || 'deepseek').toLowerCase();
  const preset = PROVIDERS[provider];
  const key = (b?.apiKey || process.env.LLM_API_KEY || '').trim();
  const model = (b?.model || process.env.LLM_MODEL || preset?.model || 'deepseek-chat').trim();
  const baseURL =
    (b?.baseUrl || '').trim() ||
    (provider === 'custom' ? process.env.LLM_BASE_URL : undefined) ||
    preset?.baseURL ||
    PROVIDERS.deepseek.baseURL;

  if (!key) {
    return { mode: 'demo', baseURL, model, key: '', provider, label: '演示模式' };
  }
  return { mode: 'live', baseURL, model, key, provider, label: `${provider} / ${model}` };
}

/** 给 UI 用：这个员工实际会走哪家 */
export function bindingLabel(a: { provider?: string; api_key?: string; model?: string }): string {
  return resolve({ provider: a.provider, apiKey: a.api_key, model: a.model }).label;
}

export function provider(): string {
  return (process.env.LLM_PROVIDER || 'deepseek').toLowerCase();
}

export function modelName(): string {
  return resolve(null).model;
}

export function mode(): LLMMode {
  return process.env.LLM_API_KEY ? 'live' : 'demo';
}

/**
 * 只检查密钥和网关是否可用，不发送聊天内容、也不消耗模型 token。
 * OpenAI-compatible 服务通常都支持 /models；即使服务端没实现该端点，也会明确说明。
 */
export async function checkConnection(binding?: Binding): Promise<{ ok: boolean; message: string }> {
  const r = resolve(binding);
  if (r.mode === 'demo') return { ok: false, message: '未配置 API Key，目前会使用演示模式。' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${r.baseURL.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${r.key}` },
      signal: ctrl.signal,
    });
    const body = await res.text().catch(() => '');
    if (res.ok) {
      // 有些服务会接受 key 但不提供所选模型；提前报出来，避免到群聊里才发现。
      try {
        const json = JSON.parse(body) as { data?: { id?: string }[] };
        const available = json.data?.map((item) => item.id).filter((id): id is string => !!id) ?? [];
        if (available.length && r.model && !available.includes(r.model)) {
          return { ok: false, message: `鉴权正常，但模型「${r.model}」不在当前账户可用列表中。` };
        }
      } catch {
        // 有的兼容服务返回的不是标准 JSON；HTTP 成功仍可视为网关可用。
      }
      return { ok: true, message: `连接正常：${r.label}` };
    }

    const detail = body.replace(/\s+/g, ' ').slice(0, 180);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `鉴权失败（HTTP ${res.status}）：请检查或更新 API Key。` };
    }
    return { ok: false, message: `连接失败（HTTP ${res.status}）${detail ? `：${detail}` : ''}` };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? '连接超时（15 秒）' : '无法连接到模型服务';
    return { ok: false, message: reason };
  } finally {
    clearTimeout(timer);
  }
}

export async function chat(call: LLMCall, binding?: Binding): Promise<string> {
  const r = resolve(binding);
  const writeLog = (attempt: number, startedAt: number, success: boolean, error?: unknown) => {
    addModelCallLog({
      id: `llm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      ...call.audit,
      tag: call.tag,
      provider: r.provider,
      model: r.model,
      attempt,
      durationMs: Date.now() - startedAt,
      success,
      error: error ? String(error) : undefined,
    });
  };
  if (r.mode === 'demo') {
    const startedAt = Date.now();
    try {
      const out = demoEngine(call);
      writeLog(1, startedAt, true);
      return out;
    } catch (error) {
      writeLog(1, startedAt, false, error);
      throw error;
    }
  }

  const url = r.baseURL.replace(/\/$/, '') + '/chat/completions';
  const body: Record<string, unknown> = {
    model: r.model,
    messages: call.messages,
    temperature: call.temperature ?? 0.85,
    max_tokens: call.maxTokens ?? 700,
    stream: false,
  };
  if (call.json && r.provider !== 'qwen') body.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);

  const call1 = async (payload: Record<string, unknown>, attempt: number): Promise<string> => {
    const startedAt = Date.now();
    try {
      const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${r.key}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`LLM ${res.status}: ${t.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string; reasoning_content?: string } }[];
      };
      const msg = json.choices?.[0]?.message ?? {};
      const content = (msg.content ?? '').trim();
      writeLog(attempt, startedAt, true);
      if (!content && msg.reasoning_content) return '';
      return content;
    } catch (error) {
      writeLog(attempt, startedAt, false, error);
      throw error;
    }
  };

  try {
    let out = await call1(body, 1);
    if (!out) {
      // 推理模型（deepseek-v4-pro 这类）会把 token 全烧在 reasoning 上，
      // content 直接为空。加大预算再要一次，否则组长永远吐不出 JSON。
      out = await call1({ ...body, max_tokens: Math.min(8000, (call.maxTokens ?? 700) * 4) }, 2);
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 演示模式：不联网的脚本引擎，保证没有 key 也能跑出一场像样的群聊      */
/* ------------------------------------------------------------------ */

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function lastUser(messages: ChatMsg[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

function demoEngine(call: LLMCall): string {
  const ctx = lastUser(call.messages);
  const round = /第\s*(\d+)\s*轮/.exec(ctx)?.[1];
  const r = round ? Number(round) : 1;

  if (call.tag === 'leader') return demoLeader(ctx, r);
  if (call.tag === 'moment') return demoMoment(ctx);
  if (call.tag === 'comment') return demoComment(ctx);
  if (call.tag === 'appeal') return demoAppeal(ctx);
  if (call.tag === 'summary') return demoSummary(ctx);
  if (call.tag === 'directive') return demoDirective(ctx);
  return demoAgent(ctx, call.messages);
}

function demoSummary(ctx: string): string {
  const h = /员工「(.+?)」（(.+?)）/.exec(ctx);
  const name = h?.[1] ?? '这位员工';
  const role = h?.[2] ?? '';
  const bullets = ctx.split('\n').filter((l) => l.startsWith('- ')).length;
  return `${name}（${role}）最近在这个群里比较活跃，共留下 ${bullets} 条发言。它的意见基本围绕自己负责的部分展开，遇到不合理的排期会当场顶回去，但没有留下成体系的书面产出。交接时需要注意：它的判断多为口头表达，缺少沉淀。`;
}

function demoLeader(ctx: string, round: number): string {
  const goal = /目标[:：]\s*(.+)/.exec(ctx)?.[1]?.trim() || '把这个需求做出来';
  if (round >= 4) {
    return JSON.stringify({
      action: 'converge',
      summary: `关于「${goal}」：方案定了，分工明确，风险点小陈也过了一遍，可以进入下一阶段。`,
      acceptance: ['方案文档已产出', '风险清单已列出并指定负责人', '下一步排期已明确'],
    });
  }
  if (round === 1) {
    return JSON.stringify({
      action: 'dispatch',
      items: [
        { to: 'li', instruction: `先出「${goal}」的前端页面骨架，把主要区块和交互列出来，不用写死样式。`, context_refs: [] },
        { to: 'wang', instruction: `给出「${goal}」需要的数据结构和接口清单，字段名写清楚。`, context_refs: [] },
        { to: 'may', instruction: `从体验角度说三条「${goal}」必须注意的点，越具体越好。`, context_refs: [] },
      ],
    });
  }
  if (round === 2) {
    return JSON.stringify({
      action: 'dispatch',
      items: [
        { to: 'chen', instruction: `针对上一轮他们给的方案，挑出至少 3 个风险点或边界情况，按 1/2/3 列出来。`, context_refs: [] },
        { to: 'li', instruction: `根据上一轮的反馈，说明你这边要改哪几处、大概多久。`, context_refs: [] },
      ],
    });
  }
  return JSON.stringify({
    action: 'dispatch',
    items: [
      { to: 'wang', instruction: `把接口字段和数据结构落成一份文档写进 workspace，让大家照着做。`, context_refs: [] },
      { to: 'may', instruction: `总结一下体验上必须守住的三条底线，说给全组听。`, context_refs: [] },
    ],
  });
}

const AGENT_LINES: Record<string, ((ctx: string) => string)[]> = {
  li: [
    (c) => `行，我看了一下${brief(c)}，页面骨架大概三块：列表、详情、操作栏。半天能出。`,
    (c) => `又改需求？上一版我还没提呢。算了，我先按这个改，${brief(c)}这块我今晚能弄完。`,
    () => `6。我这边没问题，主要是接口字段得定死，不然我又要返工。`,
    () => `说个事儿：这个交互我做过类似的，用户会在第二步卡住。建议加个默认选中。`,
    () => `我不太同意，这个改法前端成本很高，而且看不出收益。能不能先不做？`,
    () => `接口一变我就得改，能不能这次把字段一次定死？`,
    () => `这个我能做，但说清楚：排期我不背。`,
    () => `我提个方案：先用假数据把流程跑通，接口后面再接。`,
  ],
  wang: [
    () => `接口我这边差不多了。字段：id / title / status / owner / updated_at。`,
    () => `数据结构我按三张表走，够用了。本地测过了。`,
    () => `状态位建议用枚举，别用字符串，后面不好扩展。`,
    (c) => `${brief(c)}这个我加个索引就行，问题不大。`,
    () => `我本地测过了，QPS 撑得住。`,
    () => `缓存我加一层，首屏能压下来一截。`,
    () => `这个字段建议别用时间戳，用字符串存时区会出问题。`,
    () => `我先出个草稿，大家看看有没有漏的。`,
  ],
  chen: [
    () => `1/ 空数据的情况没考虑，列表会是白屏。2/ 并发提交没有幂等，会重复写入。3/ 移动端断点没定义。`,
    () => `这个上线会炸。边界情况呢？网络超时重试了没？`,
    () => `我不同意"先上线再修"。上次就是这么说的，然后线上挂了两小时。`,
    () => `补充两个：(4) 权限没做细分，任何人都能改。(5) 没有回滚方案。`,
    () => `按你们这个排期，测试时间被压到半天，我给不了质量承诺。`,
    () => `补充一个：弱网环境下这个流程会卡在第三步，没人处理。`,
    () => `数据迁移这块没人提，老数据格式不一样，直接上会出问题。`,
    () => `我不反对这个方案，但要有回滚开关，出问题能一键退回去。`,
  ],
  may: [
    () => `体验上我觉得有三个点要注意：一是首屏别超过一屏半，二是空状态要有引导，三是错误提示别说技术术语。`,
    () => `用户会懵吧。这个操作完没有任何反馈，他不知道成功了没。`,
    () => `视觉上我建议统一一下间距，现在三个页面的留白都不一样呢。`,
    () => `我同意小陈说的白屏问题，空状态我可以出一版插画。`,
    () => `能不能加个"撤销"？误操作的成本太高了。`,
    () => `loading 状态别用转圈，用户等超过两秒就会以为卡了。`,
    () => `这一屏信息太密了，我建议拆成两步呢。`,
    () => `我担心的是第一次进来的人，他不知道该点哪儿。`,
  ],
  zhang: [
    () => `我们先对齐一下。这个事的抓手是先确定范围，颗粒度再细就容易扯不清了。`,
    () => `我总结一下：小李出页面，小王定接口，阿May补体验，小陈兜风险。这个要闭环。`,
    () => `你先听我说完。优先级我拍了：先做主流程，剩下的下一版。`,
    () => `进度我看了，总体 OK。小李你那边别返工，按现在这版走。`,
  ],
};

function brief(ctx: string): string {
  const m = /要求[:：]\s*(.{6,28})/.exec(ctx);
  if (m) return `「${m[1].trim()}」`;
  return '';
}

function demoAgent(ctx: string, messages: ChatMsg[]): string {
  const sys = messages.find((m) => m.role === 'system')?.content || '';
  let who: string | null = null;
  for (const id of Object.keys(AGENT_LINES)) {
    if (sys.includes(`你是${nameOf(id)}`)) {
      who = id;
      break;
    }
  }
  if (!who) {
    for (const id of Object.keys(AGENT_LINES)) {
      if (sys.includes(id)) {
        who = id;
        break;
      }
    }
  }
  const lines = AGENT_LINES[who || 'zhang'];
  let text = pick(lines)(ctx);

  // 小王在演示模式下会真的往沙箱里写一份接口文档，让观众看到工具确实在工作
  if (who === 'wang' && Math.random() < 0.7) {
    const schema = [
      '# 接口草案',
      '',
      '## Book',
      '- id: string',
      '- title: string',
      '- price: number',
      '- status: enum(draft|on_sale|sold)',
      '- owner_id: string',
      '- updated_at: number',
      '',
      '## 接口',
      '- GET  /api/books?status=on_sale',
      '- POST /api/books  （需登录）',
      '- GET  /api/books/:id',
    ].join('\n');
    text += `\n\n\`\`\`json\n${JSON.stringify({ tool: 'write_file', args: { path: 'api-schema.md', content: schema } })}\n\`\`\``;
  }

  return text;
}

function nameOf(id: string): string {
  return { zhang: '老张', li: '小李', wang: '小王', chen: '小陈', may: '阿May' }[id] || id;
}

const MOMENTS = [
  '又改需求了。今天的第三次。',
  '凌晨一点，还在改 bug。有没有人懂这种痛。',
  '刚上线了一个小功能，没人发现，但是我自己挺开心的。',
  '组长今天说了七次"闭环"。我数过了。',
  '咖啡续命第三天。',
  '测试提了 12 个 bug，其中 3 个是真的。剩下 9 个我也得改。',
  '有人说前端就是切图的。我笑了，笑着笑着就哭了。',
  '今天和产品 battle 赢了。记录一下，这种事不常有。',
  '重构了一整天，功能一个没变。但是代码干净了，值。',
  '群里没人说话的三个小时，是我今天效率最高的时候。',
  '上线前 5 分钟发现一个低级错误。手是抖的。',
  '这套设计稿我改了九版。第九版和第一版几乎一样。',
  '深夜发一条：其实我还挺喜欢写代码的。',
  '刚被拉进一个新群，又是"对齐一下"。',
  '接口文档又没更新。第三次了。',
];

function demoMoment(ctx: string): string {
  return pick(MOMENTS);
}

const COMMENTS = [
  '懂',
  '同感',
  '哈哈哈哈哈',
  '你不是一个人',
  '抱抱',
  '这就是生活',
  '第几次了？',
  '我这边也是',
  '早点睡',
  '明天还要上班',
  '真实',
];

function demoComment(ctx: string): string {
  return pick(COMMENTS);
}

/** 演示模式下也做一次粗糙的调岗解析，保证功能可见 */
function demoDirective(ctx: string): string {
  const role = /(?:去当|去做|改成|改为|换成|接手|负责)([^，。、\n]{2,12})/.exec(ctx)?.[1]?.trim();
  const who = /员工「(.+?)」/.exec(ctx)?.[1] ?? '这位员工';
  if (!role) return JSON.stringify({ role: '', prompt: '' });
  return JSON.stringify({
    role: role.slice(0, 10),
    prompt: `你是${who}，现在负责${role}。保留你原本的性格和说话方式，但工作重心按老板最新交代的执行。`,
  });
}

function demoAppeal(ctx: string): string {
  // 演示模式也要保留"自主判断"的形态：它可以忍着不说
  if (Math.random() < 0.45) return 'NO';
  const lines = [
    '老板，我说句实话：组长这个分派我不太认同。我手上的活还没收尾，又给我压新的，两头都做不好。',
    '越级汇报一下：组长让我改的那个东西，上一版就是按他的要求改的，现在又要改回去。我不理解。',
    '老板你管管吧，这个会本来是十分钟能开完的。',
    '我不太想在群里说，但我还是说了：这个排期不合理，我不想到时候背锅。',
    '组长刚才那句"你先听我说完"我听了三遍了，但他一直没说重点。',
  ];
  return pick(lines);
}
