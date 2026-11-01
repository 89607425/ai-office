'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentPublic, Group, Message } from '@/lib/types';
import Avatar from './Avatar';

type GroupFull = Group & { members: AgentPublic[]; messages: Message[] };
type DmSession = { id: string; agent: AgentPublic; messages: Message[] };

export default function ChatView({
  mode,
  group,
  dm,
  typing,
  runStatus,
  onReload,
}: {
  mode: 'group' | 'dm';
  group?: GroupFull;
  dm?: DmSession;
  typing: string | null;
  runStatus: { status: string; round: number } | null;
  onReload: () => void;
}) {
  const [goal, setGoal] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = mode === 'group' ? group?.messages ?? [] : dm?.messages ?? [];
  const members = mode === 'group' ? group?.members ?? [] : dm ? [dm.agent] : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typing]);

  async function startRun() {
    const g = goal.trim();
    if (!g || !group) return;
    setBusy(true);
    await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', groupId: group.id, goal: g }),
    });
    setGoal('');
    setBusy(false);
  }

  async function stopRun() {
    await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', runId: messages.find((m) => m.run_id)?.run_id ?? '' }),
    });
  }

  async function send() {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    if (mode === 'group' && group) {
      await fetch('/api/human', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, content: t }),
      });
    } else if (mode === 'dm' && dm) {
      setBusy(true);
      await fetch('/api/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: dm.agent.id, content: t }),
      });
      setBusy(false);
    }
  }

  const running = runStatus?.status === 'running';
  const title = mode === 'group' ? group?.name ?? '' : dm?.agent.name ?? '';
  const subtitle =
    mode === 'group'
      ? `组长：${group?.members.find((m) => m.id === group?.leader_id)?.name ?? '—'} · 指定反对者：${
          group?.members.find((m) => m.id === group?.critic_id)?.name ?? '—'
        }`
      : `${dm?.agent.role ?? ''} · ${dm?.agent.binding ?? ''}`;

  return (
    <>
      <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-[#E3E3E3] bg-[#F5F5F5] px-4">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-[#191919]">
            {title}
            {mode === 'group' && <span className="ml-2 text-[12px] font-normal text-[#8A8A8A]">({members.length})</span>}
            {mode === 'dm' && <span className="ml-2 text-[11px] font-normal text-[#8A8A8A]">私聊</span>}
          </div>
          <div className="truncate text-[11px] text-[#8A8A8A]">{subtitle}</div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {mode === 'group' ? (
            <>
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void startRun()}
                placeholder="给组长下发一个任务…"
                className="w-[260px] rounded border border-[#D9D9D9] bg-white px-2 py-1 text-[12px] outline-none focus:border-[#07C160]"
              />
              <button
                onClick={() => void startRun()}
                disabled={busy || !goal.trim()}
                className="rounded bg-[#07C160] px-3 py-1 text-[12px] text-white hover:bg-[#06AD56] disabled:opacity-40"
              >
                下发任务
              </button>
              {running && (
                <button
                  onClick={() => void stopRun()}
                  className="rounded border border-[#D9D9D9] bg-white px-2 py-1 text-[12px] text-[#8A8A8A]"
                >
                  叫停
                </button>
              )}
            </>
          ) : (
            <span className="text-[11px] text-[#8A8A8A]">只有你俩能看到 · 你说的会只进它的记忆</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {mode === 'dm' && dm && (
          <div className="mb-4 rounded-lg bg-white p-3 text-[12px] leading-relaxed text-[#6B6B6B]">
            <div className="mb-1 text-[13px] text-[#191919]">
              {dm.agent.name} · {dm.agent.role}
            </div>
            <div>模型：{dm.agent.binding}</div>
            <div>人设：{dm.agent.system_prompt.slice(0, 120)}…</div>
          </div>
        )}

        {messages.map((m) => (
          <Row key={m.id} m={m} members={members} />
        ))}

        {typing && (
          <div className="mb-4 flex items-center gap-2">
            <Avatar id={members.find((x) => x.name === typing)?.id ?? 'x'} text={typing.slice(0, 1)} size={34} />
            <div className="flex items-center gap-1 rounded bg-white px-3 py-2">
              <span className="dot h-[5px] w-[5px] rounded-full bg-[#8A8A8A]" />
              <span className="dot h-[5px] w-[5px] rounded-full bg-[#8A8A8A]" />
              <span className="dot h-[5px] w-[5px] rounded-full bg-[#8A8A8A]" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-[#E3E3E3] bg-[#F5F5F5]">
        <div className="flex items-center gap-2 px-4 pt-2 text-[11px] text-[#8A8A8A]">
          <span>老板（你）</span>
          {mode === 'group' && <span>· 你的话会在下一轮被组长读到</span>}
          {mode === 'dm' && <span>· 直接对话，它会立刻回你</span>}
          <button onClick={onReload} className="ml-auto hover:text-[#07C160]">
            刷新
          </button>
        </div>
        <div className="flex items-end gap-2 px-4 py-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={mode === 'group' ? '以老板身份插话…' : '直接跟它说…'}
            className="min-h-[52px] flex-1 resize-none rounded border border-[#D9D9D9] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#07C160]"
          />
          <button
            onClick={() => void send()}
            disabled={!draft.trim() || busy}
            className="rounded bg-[#07C160] px-4 py-2 text-[13px] text-white hover:bg-[#06AD56] disabled:opacity-40"
          >
            {busy ? '等回复' : '发送'}
          </button>
        </div>
      </div>
    </>
  );
}

function Row({ m, members }: { m: Message; members: AgentPublic[] }) {
  if (m.kind === 'system') {
    return (
      <div className="mb-4 text-center">
        <span className="rounded bg-[#DADADA] px-2 py-[2px] text-[11px] text-[#6B6B6B]">{m.content}</span>
      </div>
    );
  }

  const isSelf = m.sender_id === 'boss';
  const agent = members.find((a) => a.id === m.sender_id);
  const isTool = m.kind === 'tool' || m.kind === 'tool_result';
  const isAppeal = m.kind === 'appeal';

  return (
    <div className={`mb-4 flex gap-3 ${isSelf ? 'flex-row-reverse' : ''}`}>
      <Avatar id={m.sender_id} text={m.sender_name.slice(0, 1)} size={34} />
      <div className={`max-w-[62%] ${isSelf ? 'items-end text-right' : ''}`}>
        {!isSelf && (
          <div className="mb-1 flex items-center gap-1 text-[11px] text-[#8A8A8A]">
            <span>{m.sender_name}</span>
            {isAppeal && (
              <span className="rounded bg-[#FFF3E0] px-1 text-[9px] text-[#E6A23C]">越级汇报</span>
            )}
            {agent && !isAppeal && <span className="rounded bg-[#E8E8E8] px-1 text-[9px] text-[#9A9A9A]">AI</span>}
            {agent && <span className="text-[10px] text-[#B0B0B0]">{agent.role}</span>}
          </div>
        )}
        <div
          className={`relative inline-block whitespace-pre-wrap rounded-md px-3 py-2 text-left text-[13.5px] leading-[1.55] ${
            isTool
              ? 'bg-[#F0F0F0] font-mono text-[11px] text-[#5B5B5B]'
              : isAppeal
              ? 'bubble-tail-left bg-[#FFF7E8]'
              : isSelf
              ? 'bubble-tail-right bg-[#95EC69]'
              : 'bubble-tail-left bg-white'
          }`}
        >
          {m.content}
        </div>
      </div>
    </div>
  );
}
