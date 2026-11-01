'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, GodMail, Group, Message, Moment, MomentComment, StreamEvent } from '@/lib/types';
import Avatar from './Avatar';
import ChatView from './ChatView';
import MomentsView from './MomentsView';
import GodView from './GodView';

type GroupFull = Group & { members: Agent[]; messages: Message[] };

type State = {
  agents: Agent[];
  groups: GroupFull[];
  moments: Moment[];
  comments: MomentComment[];
  godInbox: GodMail[];
  runs: { id: string; group_id: string; goal: string; status: string; round: number }[];
  workspace: { name: string; size: number }[];
  sandboxBlocks: string[];
  runtime: { mode: 'live' | 'demo'; provider: string; model: string };
};

type Tab = 'chat' | 'moments' | 'god';

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [activeGroup, setActiveGroup] = useState<string>('g1');
  const [typing, setTyping] = useState<{ groupId: string; name: string } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [runStatus, setRunStatus] = useState<{ status: string; round: number } | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/state', { cache: 'no-store' });
    const json = (await res.json()) as State;
    setState(json);
    if (json.groups.length && !json.groups.some((g) => g.id === activeGroup)) setActiveGroup(json.groups[0].id);
  }, [activeGroup]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    const on = <T,>(type: string, fn: (data: T) => void) => {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          fn(JSON.parse((e as MessageEvent).data) as T);
        } catch {
          /* ignore */
        }
      });
    };

    on<Message>('message', (m) => {
      setState((s) =>
        s
          ? {
              ...s,
              groups: s.groups.map((g) => (g.id === m.group_id ? { ...g, messages: [...g.messages, m] } : g)),
            }
          : s
      );
      setTyping(null);
    });

    on<{ group_id: string; agent_name: string }>('typing', (t) => {
      setTyping({ groupId: t.group_id, name: t.agent_name });
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(null), 6000);
    });

    on<Moment>('moment', (m) => setState((s) => (s ? { ...s, moments: [m, ...s.moments] } : s)));
    on<MomentComment>('moment_comment', (c) => setState((s) => (s ? { ...s, comments: [...s.comments, c] } : s)));
    on<GodMail>('god', (mail) =>
      setState((s) => (s ? { ...s, godInbox: [mail, ...s.godInbox.filter((m) => m.id !== mail.id)] } : s))
    );
    on<{ status: string; round: number }>('status', (st) => setRunStatus(st));
    on<{ text: string }>('log', (l) => setLogs((prev) => [...prev.slice(-40), l.text]));

    return () => es.close();
  }, []);

  const group = state?.groups.find((g) => g.id === activeGroup) ?? null;
  const unreadGod = (state?.godInbox ?? []).filter((m) => !m.reply).length;

  return (
    <div className="flex h-screen items-center justify-center p-4">
      <div className="flex h-[760px] w-full max-w-[1180px] overflow-hidden rounded-lg shadow-2xl">
        {/* 左侧导航栏 */}
        <div className="flex w-[58px] flex-col items-center bg-[#2E2E2E] py-4">
          <Avatar id="boss" text="老" size={34} radius={5} />
          <div className="mt-6 flex flex-col gap-1">
            <NavButton active={tab === 'chat'} onClick={() => setTab('chat')} label="消息">
              <path d="M4 5h16v11H8l-4 4V5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </NavButton>
            <NavButton active={tab === 'moments'} onClick={() => setTab('moments')} label="朋友圈">
              <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.6" />
            </NavButton>
            <NavButton active={tab === 'god'} onClick={() => setTab('god')} label="私聊" badge={unreadGod}>
              <path d="M5 6h14v10H9l-4 4V6z" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M9 10h6M9 13h4" stroke="currentColor" strokeWidth="1.4" />
            </NavButton>
          </div>
          <div className="mt-auto text-[10px] leading-tight text-white/35">
            {state?.runtime.mode === 'demo' ? '演示模式' : '在线模式'}
          </div>
        </div>

        {/* 会话列表 */}
        <div className="w-[250px] shrink-0 border-r border-[#D9D9D9] bg-[#E7E6E4]">
          <div className="flex h-[56px] items-center px-3">
            <input
              className="w-full rounded bg-[#D6D5D3] px-2 py-1 text-[12px] text-[#191919] outline-none placeholder:text-[#8A8A8A]"
              placeholder="搜索"
            />
          </div>
          <div className="px-2">
            {tab === 'chat' &&
              (state?.groups ?? []).map((g) => {
                const last = g.messages[g.messages.length - 1];
                const active = g.id === activeGroup;
                return (
                  <button
                    key={g.id}
                    onClick={() => setActiveGroup(g.id)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left ${active ? 'bg-[#C6C5C3]' : 'hover:bg-[#DCDBD9]'}`}
                  >
                    <div className="grid h-[36px] w-[36px] grid-cols-2 grid-rows-2 overflow-hidden rounded-md bg-[#C8C8C8]">
                      {g.members.slice(0, 4).map((m) => (
                        <div key={m.id} className="flex items-center justify-center text-[10px] text-white" style={{ background: m.id === 'boss' ? '#191919' : undefined }}>
                          {m.avatar}
                        </div>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between">
                        <span className="truncate text-[13px] text-[#191919]">{g.name}</span>
                        <span className="shrink-0 text-[10px] text-[#9A9A9A]">
                          {last ? new Date(last.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-[#8A8A8A]">
                        {last ? `${last.sender_name}：${last.content.replace(/\n/g, ' ')}` : '暂无消息'}
                      </div>
                    </div>
                  </button>
                );
              })}

            {tab === 'moments' && (
              <div className="px-2 py-3 text-[13px] text-[#191919]">朋友圈</div>
            )}
            {tab === 'god' && (
              <div className="px-2 py-3 text-[13px] text-[#191919]">
                私聊 · 上帝信箱
                <div className="mt-1 text-[11px] text-[#8A8A8A]">员工越级汇报都到这儿</div>
              </div>
            )}
          </div>

          {logs.length > 0 && (
            <div className="absolute bottom-0 hidden">logs</div>
          )}
        </div>

        {/* 主区域 */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#F5F5F5]">
          {tab === 'chat' && group && (
            <ChatView
              group={group}
              typing={typing?.groupId === group.id ? typing.name : null}
              runStatus={runStatus}
              onReload={load}
            />
          )}
          {tab === 'moments' && (
            <MomentsView
              moments={state?.moments ?? []}
              comments={state?.comments ?? []}
              agents={state?.agents ?? []}
              onReload={load}
            />
          )}
          {tab === 'god' && <GodView mails={state?.godInbox ?? []} onReload={load} />}

          {/* 全局状态条 */}
          <div className="flex items-center gap-3 border-t border-[#E3E3E3] bg-[#EDEDED] px-3 py-1 text-[11px] text-[#8A8A8A]">
            <span>
              引擎：
              <b className={state?.runtime.mode === 'demo' ? 'text-[#E6A23C]' : 'text-[#07C160]'}>
                {state?.runtime.mode === 'demo' ? '演示模式（内置脚本引擎，不联网）' : `真实模型 ${state?.runtime.provider} / ${state?.runtime.model}`}
              </b>
            </span>
            {runStatus && <span>状态：{runStatus.status} · 第 {runStatus.round} 轮</span>}
            <span className="ml-auto">所有发言均由模型生成 · 沙箱仅限 workspace 目录</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavButton({
  active,
  onClick,
  label,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`relative flex h-[42px] w-[42px] items-center justify-center rounded ${
        active ? 'bg-[#3E3E3E] text-[#07C160]' : 'text-white/60 hover:text-white/90'
      }`}
    >
      <svg viewBox="0 0 24 24" width="21" height="21">
        {children}
      </svg>
      {!!badge && (
        <span className="absolute right-1 top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#FA5151] px-1 text-[10px] text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
