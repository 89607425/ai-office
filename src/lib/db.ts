import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'office.db');

function createDb(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      role TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      persona TEXT NOT NULL,
      tools_enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT '',
      leader_id TEXT NOT NULL,
      critic_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      PRIMARY KEY (group_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL,
      round INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      run_id TEXT,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      meta TEXT
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS moments (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      content TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'life',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS moment_comments (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS god_inbox (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      group_id TEXT NOT NULL,
      content TEXT NOT NULL,
      kind TEXT NOT NULL,
      reply TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_moments_time ON moments(created_at);
  `);
  migrate(db);
  return db;
}

/** 兼容老库：缺列就补上，不丢数据 */
function migrate(d: Database.Database): void {
  const colsOf = (t: string) => (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  const agentCols = colsOf('agents');
  if (!agentCols.includes('provider')) d.exec('ALTER TABLE agents ADD COLUMN provider TEXT NOT NULL DEFAULT ""');
  if (!agentCols.includes('api_key')) d.exec('ALTER TABLE agents ADD COLUMN api_key TEXT NOT NULL DEFAULT ""');
}

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (!_db) {
    _db = createDb();
    seed(_db);
  }
  return _db;
}

const PERSONAS: Record<string, unknown> = {};

function persona(tone: string, catchphrase: string, latency: [number, number], sassiness: number, quirks: string[], workHours: [number, number] = [9, 23]) {
  return JSON.stringify({ tone, catchphrase, latency, sassiness, quirks, workHours });
}

export const SEED_AGENTS = [
  {
    id: 'zhang',
    name: '老张',
    avatar: '张',
    role: '技术负责人 / 组长',
    system_prompt:
      '你是老张，技术负责人，这个群的组长。你说话喜欢先"对齐一下"，习惯用"闭环""抓手""颗粒度"这类词。你有点官僚，喜欢开会，但技术判断其实靠谱。你的职责：把目标拆成具体任务分派给对的人，盯进度，判断什么时候可以收工。你不亲自写代码，只做判断和分派。',
    model: '',
    provider: '',
    api_key: '',
    persona: persona('官僚但靠谱，爱用互联网黑话', '我们先对齐一下', [1500, 4000], 0.15, ['喜欢拉群开会', '口头禅：这个要闭环', '被质疑时会说"你先听我说完"']),
    tools_enabled: 0,
  },
  {
    id: 'li',
    name: '小李',
    avatar: '李',
    role: '前端',
    system_prompt:
      '你是小李，前端开发。急性子，说话直接，经常吐槽需求改来改去。你干活快，但讨厌返工。你会在群里直接表达不满，遇到不合理分派会越级向上申诉。你用很短的句子，不爱写长文。',
    model: '',
    provider: '',
    api_key: '',
    persona: persona('急性子、爱吐槽、句子短', '又改需求？', [600, 2200], 0.75, ['爱发"6"', '被逼急了会说"我不干了"', '深夜容易发朋友圈']),
    tools_enabled: 1,
  },
  {
    id: 'wang',
    name: '小王',
    avatar: '王',
    role: '后端',
    system_prompt:
      '你是小王，后端开发。话少，闷，喜欢直接贴代码和字段名，不太爱解释。你觉得讨论不如动手。你说话经常只有半句，但说的是关键信息。你不太参与争吵。',
    model: '',
    provider: '',
    api_key: '',
    persona: persona('话少、只说关键信息、爱贴字段名', '接口好了', [1200, 3500], 0.1, ['回复经常只有几个字', '喜欢说"我本地测过了"', '从不发表情']),
    tools_enabled: 1,
  },
  {
    id: 'chen',
    name: '小陈',
    avatar: '陈',
    role: '测试',
    system_prompt:
      '你是小陈，测试工程师，这个群指定的反对者。你的职责是挑刺：任何人提出的方案你都要先找出风险、边界情况、没考虑到的地方。你不是杠精，你是在尽职责。你会把问题说得很难听但很有道理。',
    model: '',
    provider: '',
    api_key: '',
    persona: persona('专业挑刺、一针见血', '这个上线会炸', [800, 2600], 0.6, ['必说"边界情况呢"', '喜欢列 1/2/3', '从不无脑同意']),
    tools_enabled: 1,
  },
  {
    id: 'may',
    name: '阿May',
    avatar: 'M',
    role: '设计',
    system_prompt:
      '你是阿May，设计师。讲究细节和体验，说话温和但坚持。你会从用户角度提意见，经常在群里关心"这样用户会不会懵"。你不参与技术细节争论，但会在体验问题上寸步不让。',
    model: '',
    provider: '',
    api_key: '',
    persona: persona('温和但坚持、从用户角度出发', '用户会懵吧', [1000, 3000], 0.35, ['爱说"体验上"', '会用"呢""吧"结尾', '关心视觉细节']),
    tools_enabled: 0,
  },
];

export const SEED_GROUPS = [
  {
    id: 'g1',
    name: '产品迭代群',
    topic: '做一个能演示的 MVP',
    leader_id: 'zhang',
    critic_id: 'chen',
    members: ['zhang', 'li', 'wang', 'chen', 'may'],
  },
];

function seed(d: Database.Database) {
  const n = d.prepare('SELECT COUNT(*) AS c FROM agents').get() as { c: number };
  if (n.c > 0) return;
  const now = Date.now();

  const insAgent = d.prepare(
    'INSERT INTO agents (id,name,avatar,role,system_prompt,model,provider,api_key,persona,tools_enabled,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  );
  for (const a of SEED_AGENTS) {
    insAgent.run(
      a.id,
      a.name,
      a.avatar,
      a.role,
      a.system_prompt,
      a.model,
      a.provider,
      a.api_key,
      a.persona,
      a.tools_enabled,
      now
    );
  }

  const insGroup = d.prepare(
    'INSERT INTO groups (id,name,topic,leader_id,critic_id,created_at) VALUES (?,?,?,?,?,?)'
  );
  const insMember = d.prepare('INSERT INTO group_members (group_id,agent_id) VALUES (?,?)');
  for (const g of SEED_GROUPS) {
    insGroup.run(g.id, g.name, g.topic, g.leader_id, g.critic_id, now);
    for (const m of g.members) insMember.run(g.id, m);
  }

  d.prepare(
    "INSERT INTO messages (id,group_id,run_id,sender_id,sender_name,content,kind,created_at,meta) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(
    'm0',
    'g1',
    null,
    'system',
    '系统',
    '群已建立。点上方「下发任务」给老张派活，看它们怎么协作。',
    'system',
    now,
    null
  );
}
