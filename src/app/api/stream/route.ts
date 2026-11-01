import { subscribe } from '@/lib/bus';
import type { StreamEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* 客户端已断开 */
        }
      };

      send(`retry: 3000\n\n`);
      send(`event: ping\ndata: ${JSON.stringify({ ok: true })}\n\n`);

      const unsubscribe = subscribe((e: StreamEvent) => {
        send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      });

      const ping = setInterval(() => send(`: keepalive\n\n`), 15000);

      req.signal.addEventListener('abort', () => {
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
