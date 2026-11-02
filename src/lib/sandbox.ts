import fs from 'node:fs';
import path from 'node:path';
import { store } from './bus';

export const SANDBOX_ROOT = path.join(process.cwd(), 'workspace');

function rootFor(group_id: string): string {
  const p = path.join(SANDBOX_ROOT, safeId(group_id));
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'default';
}

export type ToolResult = { ok: boolean; output: string };

/**
 * 额外允许的根目录。默认只有 workspace/<群>，
 * 想让它往别处写（比如桌面）就在 .env.local 里加：
 *   SANDBOX_EXTRA_ROOTS=/Users/houjunyi/Desktop
 * 多个用逗号分隔。**开了就等于把那个目录交给模型，自己掂量。**
 */
function extraRoots(): string[] {
  return (process.env.SANDBOX_EXTRA_ROOTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s));
}

/** 路径白名单：工作目录内，或显式落在额外根目录内 */
function resolveSafe(group_id: string, rel: string): string | null {
  if (path.isAbsolute(rel)) {
    const abs = path.resolve(rel);
    const ok = extraRoots().some((r) => abs === r || abs.startsWith(r + path.sep));
    return ok ? abs : null;
  }
  const root = rootFor(group_id);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

const MAX_READ = 16000;
const MAX_WRITE = 60000;

export function readFile(group_id: string, rel: string, start?: number, end?: number): ToolResult {
  const abs = resolveSafe(group_id, rel);
  if (!abs) return { ok: false, output: '拒绝：路径越界（只允许访问 workspace 目录内）' };
  if (!fs.existsSync(abs)) return { ok: false, output: `文件不存在：${rel}` };
  const raw = fs.readFileSync(abs, 'utf8');
  const total = raw.length;
  const hasRange = typeof start === 'number' || typeof end === 'number';
  if (hasRange) {
    const lines = raw.split('\n');
    const s = Math.max(1, start ?? 1);
    const e = Math.min(lines.length, end ?? lines.length);
    const slice = lines.slice(s - 1, e).join('\n');
    return { ok: true, output: `（${rel} 共 ${lines.length} 行，以下为第 ${s}-${e} 行）\n${slice}` };
  }
  let content = raw;
  if (content.length > MAX_READ)
    content = content.slice(0, MAX_READ) + `\n…（已截断，共 ${total} 字符，可用 read_file 的 start/end 读指定行范围）`;
  return { ok: true, output: content };
}

export function writeFile(group_id: string, rel: string, content: string, append = false): ToolResult {
  const abs = resolveSafe(group_id, rel);
  if (!abs) return { ok: false, output: '拒绝：路径越界（只允许访问 workspace 目录内）' };
  if (content.length > MAX_WRITE)
    return { ok: false, output: `拒绝：单次写入内容超过 ${MAX_WRITE} 字符，请改用 append:true 分多段追加写` };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (append && fs.existsSync(abs)) {
    fs.appendFileSync(abs, content, 'utf8');
  } else {
    fs.writeFileSync(abs, content, 'utf8');
  }
  return { ok: true, output: `${append ? '已追加' : '已写入'} ${rel}（${content.length} 字符）` };
}

/**
 * 跨文件搜索：在工作区所有源码/文档里按关键词（不区分大小写）查找，
 * 返回 文件:行号:内容。用于多模块项目里追踪定义/引用，远比整篇读文件省 token。
 */
export function searchFiles(group_id: string, query: string, max = 60): ToolResult {
  const root = rootFor(group_id);
  if (!query || !query.trim()) return { ok: false, output: '缺少搜索关键词' };
  const q = query.toLowerCase();
  const out: string[] = [];
  let filesScanned = 0;
  const walk = (dir: string): void => {
    if (out.length >= max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.')) walk(full);
      } else if (/\.(md|txt|json|js|ts|tsx|jsx|py|html|css|yml|yaml|csv|go|rs|java|rb|sh|sql|xml|vue)$/i.test(e.name)) {
        filesScanned++;
        try {
          const lines = fs.readFileSync(full, 'utf8').split('\n');
          for (let i = 0; i < lines.length && out.length < max; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              const rel = path.relative(root, full);
              out.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            }
          }
        } catch {
          /* 跳过不可读文件 */
        }
      }
    }
  };
  walk(root);
  if (!out.length) return { ok: true, output: `未找到匹配「${query}」的内容（已扫描 ${filesScanned} 个文件）` };
  return {
    ok: true,
    output: `匹配「${query}」共 ${out.length} 条（已扫描 ${filesScanned} 个文件）：\n` + out.join('\n'),
  };
}

export function listFiles(group_id: string): ToolResult {
  const root = rootFor(group_id);
  const walk = (dir: string, prefix = ''): string[] => {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      out.push(prefix + e.name + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory() && out.length < 100) out.push(...walk(path.join(dir, e.name), prefix + e.name + '/'));
    }
    return out;
  };
  try {
    const files = walk(root);
    return { ok: true, output: files.length ? files.join('\n') : '（空目录）' };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

export function workspaceTree(): { name: string; size: number }[] {
  try {
    if (!fs.existsSync(SANDBOX_ROOT)) return [];
    return fs
      .readdirSync(SANDBOX_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((d) => {
        const dir = path.join(SANDBOX_ROOT, d.name);
        return fs.readdirSync(dir, { withFileTypes: true })
          .filter((f) => f.isFile())
          .map((f) => ({ name: `${d.name}/${f.name}`, size: fs.statSync(path.join(dir, f.name)).size }));
      });
  } catch {
    return [];
  }
}

/** 取某群工作区里最近被改动过的文件（相对名），用于"把刚才群里写的改了"这类没有明确文件名的指令 */
export function latestFile(group_id: string): string | null {
  try {
    const root = rootFor(group_id);
    const files = fs
      .readdirSync(root)
      .filter((f) => fs.statSync(path.join(root, f)).isFile());
    if (!files.length) return null;
    files.sort(
      (a, b) =>
        fs.statSync(path.join(root, b)).mtimeMs - fs.statSync(path.join(root, a)).mtimeMs
    );
    return files[0];
  } catch {
    return null;
  }
}

/** agent 输出里最后一个 ```json 代码块会被当作工具调用 */
export type ToolCall = {
  tool: 'read_file' | 'write_file' | 'list_files' | 'post_group' | 'post_dm' | 'search_files';
  args: Record<string, string>;
};

/**
 * 输出被 max_tokens 截断时，最后一个代码块常常没有闭合的 ```。
 * 这种情况下不能整个丢掉 —— 截到最后一个 } 再试着解析。
 */
export function parseToolCall(text: string): ToolCall | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  let raw = blocks.length ? blocks[blocks.length - 1][1] : '';

  if (!raw) {
    const open = text.lastIndexOf('```json');
    if (open >= 0) {
      const rest = text.slice(open + 7);
      const last = rest.lastIndexOf('}');
      if (last > 0) raw = rest.slice(0, last + 1);
    }
  }
  if (!raw) return null;

  try {
    const obj = JSON.parse(raw) as ToolCall;
    if (!obj || typeof obj.tool !== 'string') return null;
    if (!['read_file', 'write_file', 'list_files', 'post_group', 'post_dm', 'search_files'].includes(obj.tool)) return null;
    return obj;
  } catch {
    return null;
  }
}

/** 把工具代码块从展示文本里清掉，包括那些没闭合的 */
export function stripToolBlocks(text: string): string {
  let out = text.replace(/```json[\s\S]*?```/g, '');
  const open = out.lastIndexOf('```json');
  if (open >= 0) out = out.slice(0, open);
  return out.trim();
}

export function runTool(group_id: string, call: ToolCall): ToolResult {
  const a = call.args;
  switch (call.tool) {
    case 'read_file': {
      const start = a.start ? parseInt(a.start, 10) : undefined;
      const end = a.end ? parseInt(a.end, 10) : undefined;
      return readFile(
        group_id,
        a.path || '',
        Number.isFinite(start) ? start : undefined,
        Number.isFinite(end) ? end : undefined
      );
    }
    case 'write_file': {
      const append = /^(true|1|yes)$/i.test(a.append || '');
      return writeFile(group_id, a.path || 'untitled.md', a.content || '', append);
    }
    case 'list_files':
      return listFiles(group_id);
    case 'search_files':
      return searchFiles(group_id, a.query || '');
    // post_group / post_dm 由调度内核真实发送；这里只给软成功，避免被当未知工具丢弃
    case 'post_group':
      return { ok: true, output: '（已在群内发布，由调度内核发送）' };
    case 'post_dm':
      return { ok: true, output: '（已发给老板，由调度内核送达）' };
    default:
      return { ok: false, output: '未知工具' };
  }
}

/** 记录一次越界尝试，方便在调试面板看到沙箱真的拦住了 */
export function logSandboxBlock(group_id: string, detail: string): void {
  const key = 'sandbox_blocks';
  const arr = (store[key] as string[]) || [];
  arr.push(`${new Date().toLocaleTimeString('zh-CN')} · ${group_id} · ${detail}`);
  store[key] = arr.slice(-20);
}
