import { NextResponse } from 'next/server';
import { readFile, workspaceTree } from '@/lib/sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const group = sp.get('group') || '';
  const file = sp.get('file') || '';

  if (!file) return NextResponse.json({ files: workspaceTree() });

  const res = readFile(group, file);
  return NextResponse.json({ ok: res.ok, content: res.output });
}
