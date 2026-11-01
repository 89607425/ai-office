'use client';

import { useState } from 'react';
import type { GodMail } from '@/lib/types';
import Avatar from './Avatar';

export default function GodView({ mails, onReload }: { mails: GodMail[]; onReload: () => void }) {
  const [reply, setReply] = useState<Record<string, string>>({});

  async function send(id: string) {
    const text = (reply[id] || '').trim();
    if (!text) return;
    setReply((r) => ({ ...r, [id]: '' }));
    await fetch('/api/god', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailId: id, reply: text }),
    });
    onReload();
  }

  return (
    <>
      <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-[#E3E3E3] bg-[#F5F5F5] px-4">
        <div>
          <div className="text-[15px] font-medium text-[#191919]">私聊 · 上帝信箱</div>
          <div className="text-[11px] text-[#8A8A8A]">
            员工越级汇报都到这儿 · 你的回复只进它自己的记忆，群里其他人看不到
          </div>
        </div>
        <button onClick={onReload} className="ml-auto rounded border border-[#D9D9D9] bg-white px-2 py-1 text-[12px] text-[#8A8A8A]">
          刷新
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#F5F5F5] px-6 py-4">
        {!mails.length && (
          <div className="mt-16 text-center text-[13px] leading-relaxed text-[#8A8A8A]">
            还没有人越级汇报。
            <br />
            去群里下发一个任务，怨气值高的员工（比如小李）可能就会来找你。
          </div>
        )}

        <div className="mx-auto max-w-[620px] space-y-3">
          {mails.map((m) => (
            <div key={m.id} className="rounded-lg bg-white p-4">
              <div className="flex gap-3">
                <Avatar id={m.agent_id} text={m.avatar} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-medium text-[#191919]">{m.agent_name}</span>
                    <span className="rounded bg-[#FFF3E0] px-1 text-[10px] text-[#E6A23C]">
                      {m.kind === 'complain' ? '反复折腾·抱怨' : '越级汇报'}
                    </span>
                    <span className="ml-auto text-[11px] text-[#8A8A8A]">
                      {new Date(m.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-[#191919]">
                    {m.content}
                  </div>

                  {m.reply ? (
                    <div className="mt-3 rounded bg-[#95EC69]/40 px-3 py-2 text-[12.5px] text-[#191919]">
                      <span className="text-[#8A8A8A]">你回复：</span>
                      {m.reply}
                      <div className="mt-1 text-[10px] text-[#8A8A8A]">已写进它的私有记忆</div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-end gap-2">
                      <textarea
                        value={reply[m.id] ?? ''}
                        onChange={(e) => setReply((r) => ({ ...r, [m.id]: e.target.value }))}
                        rows={2}
                        placeholder="以上帝身份回复…"
                        className="min-h-[44px] flex-1 resize-none rounded border border-[#D9D9D9] bg-[#FAFAFA] px-2 py-1 text-[12.5px] outline-none focus:border-[#07C160]"
                      />
                      <button
                        onClick={() => void send(m.id)}
                        disabled={!(reply[m.id] ?? '').trim()}
                        className="rounded bg-[#07C160] px-3 py-2 text-[12px] text-white hover:bg-[#06AD56] disabled:opacity-40"
                      >
                        回复
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
