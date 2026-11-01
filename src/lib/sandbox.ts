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

/** 路径白名单：解析后必须落在工作目录内 */
function resolveSafe(group_id: string, rel: string): string | null {
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

/** agent 输出里最后一个 ```json 代码块会被当作工具调用 */
export type ToolCall = { tool: 'read_file' | 'write_file' | 'list_files'; args: Record<string, string> };

export function parseToolCall(text: string): ToolCall | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  const raw = blocks[blocks.length - 1][1];
  try {
    const obj = JSON.parse(raw) as ToolCall;
    if (!obj || typeof obj.tool !== 'string') return null;
    if (!['read_file', 'write_file', 'list_files'].includes(obj.tool)) return null;
    return obj;
  } catch {
    return null;
  }
}

export function runTool(group_id: string, call: ToolCall): ToolResult {
  switch (call.tool) {
    case 'read_file':
      return readFile(group_id, call.args.path || '');
    case 'write_file':
      return writeFile(group_id, call.args.path || 'untitled.md', call.args.content || '');
    case 'list_files':
      return listFiles(group_id);
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
