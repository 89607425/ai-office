import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const runId = new URL(req.url).searchParams.get('runId');
  const rows = runId
    ? db().prepare('SELECT * FROM model_call_logs WHERE run_id = ? ORDER BY created_at DESC LIMIT 120').all(runId)
    : db().prepare('SELECT * FROM model_call_logs ORDER BY created_at DESC LIMIT 120').all();
  return NextResponse.json({ logs: rows });
}
