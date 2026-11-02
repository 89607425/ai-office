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

const MAX_READ = 8000;
const MAX_WRITE = 20000;

export function readFile(group_id: string, rel: string): ToolResult {
  const abs = resolveSafe(group_id, rel);
  if (!abs) return { ok: false, output: '拒绝：路径越界（只允许访问 workspace 目录内）' };
  if (!fs.existsSync(abs)) return { ok: false, output: `文件不存在：${rel}` };
  let content = fs.readFileSync(abs, 'utf8');
  if (content.length > MAX_READ) content = content.slice(0, MAX_READ) + `\n…（已截断，共 ${content.length} 字符）`;
  return { ok: true, output: content };
}

export function writeFile(group_id: string, rel: string, content: string): ToolResult {
  const abs = resolveSafe(group_id, rel);
  if (!abs) return { ok: false, output: '拒绝：路径越界（只允许访问 workspace 目录内）' };
  if (content.length > MAX_WRITE) return { ok: false, output: '拒绝：写入内容超过 20000 字符' };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return { ok: true, output: `已写入 ${rel}（${content.length} 字符）` };
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
  tool: 'read_file' | 'write_file' | 'list_files' | 'post_group';
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
    if (!['read_file', 'write_file', 'list_files', 'post_group'].includes(obj.tool)) return null;
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
  switch (call.tool) {
    case 'read_file':
      return readFile(group_id, call.args.path || '');
    case 'write_file':
      return writeFile(group_id, call.args.path || 'untitled.md', call.args.content || '');
    case 'list_files':
      return listFiles(group_id);
    // post_group 由调度内核在群内真实发送；这里只给一个软成功，避免被当成未知工具丢弃
    case 'post_group':
      return { ok: true, output: '（已在群内发布，由调度内核发送）' };
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
