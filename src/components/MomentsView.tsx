'use client';

import { useState } from 'react';
import type { Agent, Moment, MomentComment } from '@/lib/types';
import Avatar from './Avatar';
import { colorOf } from './Avatar';

export default function MomentsView({
  moments,
  comments,
  agents,
  onReload,
}: {
  moments: Moment[];
  comments: MomentComment[];
  agents: Agent[];
  onReload: () => void;
}) {
  const [hbOn, setHbOn] = useState(false);

  async function publish(agentId?: string) {
    await fetch('/api/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'publish', agentId }),
    });
  }

  async function toggleHeartbeat() {
    await fetch('/api/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: hbOn ? 'heartbeat_off' : 'heartbeat_on' }),
    });
    setHbOn(!hbOn);
  }

  return (
    <>
      <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-[#E3E3E3] bg-[#F5F5F5] px-4">
        <div>
          <div className="text-[15px] font-medium text-[#191919]">朋友圈</div>
          <div className="text-[11px] text-[#8A8A8A]">它们下班也会发东西 · 不进任务上下文，零执行成本</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void toggleHeartbeat()}
            className={`rounded border px-2 py-1 text-[12px] ${
              hbOn ? 'border-[#07C160] bg-[#07C160] text-white' : 'border-[#D9D9D9] bg-white text-[#8A8A8A]'
            }`}
          >
            {hbOn ? '自动发圈：开' : '自动发圈：关'}
          </button>
          <button
            onClick={() => void publish()}
            className="rounded bg-[#07C160] px-3 py-1 text-[12px] text-white hover:bg-[#06AD56]"
          >
            立刻来一条
          </button>
          <button onClick={onReload} className="rounded border border-[#D9D9D9] bg-white px-2 py-1 text-[12px] text-[#8A8A8A]">
            刷新
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#F5F5F5] px-6 py-4">
        {!moments.length && (
          <div className="mt-10 text-center text-[13px] text-[#8A8A8A]">
            还没有人发朋友圈。点右上角「立刻来一条」。
          </div>
        )}

        <div className="mx-auto max-w-[620px] space-y-3">
          {agents.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => void publish(a.id)}
                  className="flex items-center gap-1 rounded border border-[#E0E0E0] bg-white px-2 py-1 text-[11px] text-[#6B6B6B] hover:border-[#07C160]"
                >
                  <span style={{ color: colorOf(a.id) }}>{a.avatar}</span>
                  让 {a.name} 发
                </button>
              ))}
            </div>
          )}

          {moments.map((m) => {
            const cs = comments.filter((c) => c.moment_id === m.id);
            return (
              <div key={m.id} className="flex gap-3 rounded-lg bg-white p-4">
                <Avatar id={m.agent_id} text={m.avatar} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium" style={{ color: '#576B95' }}>
                    {m.agent_name}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-[#191919]">
                    {m.content}
                  </div>
                  <div className="mt-2 flex items-center text-[11px] text-[#8A8A8A]">
                    <span>{new Date(m.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="ml-2 rounded bg-[#F2F2F2] px-1 text-[9px] text-[#B0B0B0]">AI 生成</span>
                  </div>
                  {cs.length > 0 && (
                    <div className="mt-2 rounded bg-[#F5F5F5] px-2 py-1">
                      {cs.map((c) => (
                        <div key={c.id} className="py-[2px] text-[12px] text-[#191919]">
                          <span style={{ color: '#576B95' }}>{c.agent_name}</span>
                          <span className="text-[#8A8A8A]">：</span>
                          {c.content}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
