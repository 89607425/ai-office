'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentPublic, Group, Message, Moment, MomentComment, StreamEvent } from '@/lib/types';
import Avatar from './Avatar';
import ChatView from './ChatView';
import MomentsView from './MomentsView';
import ContactsView from './ContactsView';

type GroupFull = Group & { members: AgentPublic[]; messages: Message[] };
type DmSession = { id: string; agent: AgentPublic; messages: Message[] };

type State = {
  agents: AgentPublic[];
  groups: GroupFull[];
  dms: DmSession[];
  moments: Moment[];
  comments: MomentComment[];
  workspace: { name: string; size: number }[];
  sandboxBlocks: string[];
  runtime: { mode: 'live' | 'demo'; provider: string; model: string; globalKey: boolean };
};

type Tab = 'chat' | 'moments' | 'contacts';

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [activeSession, setActiveSession] = useState<string>('g1');
  const [typing, setTyping] = useState<{ id: string; name: string } | null>(null);
  const [runStatus, setRunStatus] = useState<{ status: string; round: number } | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/state', { cache: 'no-store' });
    const json = (await res.json()) as State;
    setState(json);
    if (json.groups.length && !json.groups.some((g) => g.id === activeSession) && !json.dms.some((d) => d.id === activeSession)) {
      setActiveSession(json.groups[0].id);
    }
  }, [activeSession]);

  /** 发送后先把气泡插进界面，不等服务端；真消息到了再把它顶掉 */
  const pushOptimistic = useCallback((m: Message) => {
    setState((s) =>
      s
        ? {
            ...s,
            groups: s.groups.map((g) => (g.id === m.group_id ? { ...g, messages: [...g.messages, m] } : g)),
            dms: s.dms.map((d) => (d.id === m.group_id ? { ...d, messages: [...d.messages, m] } : d)),
          }
        : s
    );
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    const on = <T,>(type: string, fn: (data: T) => void) => {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          fn(JSON.parse(e.data) as T);
        } catch {
          /* ignore */
        }
      });
    };

    on<Message>('message', (m) => {
      // 真消息到了，用它顶掉同一会话里同一发送者的临时气泡
      const dropTmp = (list: Message[]) => [
        ...list.filter((x) => !(x.id.startsWith('tmp_') && x.sender_id === m.sender_id)),
        m,
      ];
      setState((s) =>
        s
          ? {
              ...s,
              groups: s.groups.map((g) => (g.id === m.group_id ? { ...g, messages: dropTmp(g.messages) } : g)),
              dms: s.dms.map((d) => (d.id === m.group_id ? { ...d, messages: dropTmp(d.messages) } : d)),
            }
          : s
      );
      setTyping(null);
    });

    on<{ group_id: string; agent_name: string }>('typing', (t) => {
      setTyping({ id: t.group_id, name: t.agent_name });
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(null), 8000);
    });

    on<Moment>('moment', (m) => setState((s) => (s ? { ...s, moments: [m, ...s.moments] } : s)));
    on<MomentComment>('moment_comment', (c) => setState((s) => (s ? { ...s, comments: [...s.comments, c] } : s)));
    on<{ status: string; round: number }>('status', (st) => setRunStatus(st));

    return () => es.close();
  }, []);

  const group = state?.groups.find((g) => g.id === activeSession) ?? null;
  const dm = state?.dms.find((d) => d.id === activeSession) ?? null;

  const unreadDm = (s: DmSession) => {
    const last = s.messages[s.messages.length - 1];
    return !!last && last.sender_id !== 'boss';
  };
  const dmBadge = (state?.dms ?? []).filter(unreadDm).length;

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
            <NavButton active={tab === 'contacts'} onClick={() => setTab('contacts')} label="通讯录">
              <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M5.5 19c0-3.3 2.9-5.4 6.5-5.4s6.5 2.1 6.5 5.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </NavButton>
            <NavButton active={tab === 'moments'} onClick={() => setTab('moments')} label="朋友圈">
              <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.6" />
            </NavButton>
          </div>
          <div className="mt-auto text-center text-[10px] leading-tight text-white/35">
            {state?.runtime.mode === 'demo' ? '演示模式' : '在线'}
          </div>
        </div>

        {/* 会话列表 */}
        <div className="w-[250px] shrink-0 overflow-y-auto border-r border-[#D9D9D9] bg-[#E7E6E4]">
          <div className="flex h-[56px] items-center px-3">
            <input
              className="w-full rounded bg-[#D6D5D3] px-2 py-1 text-[12px] text-[#191919] outline-none placeholder:text-[#8A8A8A]"
              placeholder="搜索"
            />
          </div>

          {tab === 'chat' && (
            <>
              <Section title="群聊">
                {(state?.groups ?? []).map((g) => {
                  const last = g.messages[g.messages.length - 1];
                  const active = g.id === activeSession;
                  return (
                    <SessionRow
                      key={g.id}
                      active={active}
                      onClick={() => setActiveSession(g.id)}
                      composite={g.members.map((m) => m.avatar)}
                      title={g.name}
                      time={last?.created_at}
                      preview={last ? `${last.sender_name}：${last.content.replace(/\n/g, ' ')}` : '暂无消息'}
                    />
                  );
                })}
              </Section>

              <Section title={`私聊${dmBadge ? `（${dmBadge} 条未读）` : ''}`}>
                {(state?.dms ?? []).map((d) => {
                  const last = d.messages[d.messages.length - 1];
                  const active = d.id === activeSession;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setActiveSession(d.id)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left ${
                        active ? 'bg-[#C6C5C3]' : 'hover:bg-[#DCDBD9]'
                      }`}
                    >
                      <Avatar id={d.agent.id} text={d.agent.avatar} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between">
                          <span className="truncate text-[13px] text-[#191919]">{d.agent.name}</span>
                          <span className="shrink-0 text-[10px] text-[#9A9A9A]">
                            {last
                              ? new Date(last.created_at).toLocaleTimeString('zh-CN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : ''}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-[#8A8A8A]">
                          {last ? `${last.kind === 'appeal' ? '【越级汇报】' : ''}${last.content.replace(/\n/g, ' ')}` : '还没聊过'}
                        </div>
                      </div>
                      {unreadDm(d) && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#FA5151]" />}
                    </button>
                  );
                })}
              </Section>
            </>
          )}

          {tab === 'contacts' && (
            <div className="px-4 py-3 text-[12px] leading-relaxed text-[#8A8A8A]">
              在右边新建员工、组建群聊。
              <br />
              每个员工可以来自不同厂家。
            </div>
          )}
          {tab === 'moments' && (
            <div className="px-4 py-3 text-[12px] leading-relaxed text-[#8A8A8A]">
              它们下班也会发状态。
              <br />
              不进任务上下文。
            </div>
          )}
        </div>

        {/* 主区域 */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-[#F5F5F5]">
          {tab === 'chat' && group && (
            <ChatView
              mode="group"
              group={group}
              typing={typing?.id === group.id ? typing.name : null}
              runStatus={runStatus}
              onReload={load}
              onOptimistic={pushOptimistic}
            />
          )}
          {tab === 'chat' && dm && (
            <ChatView
              mode="dm"
              dm={dm}
              typing={typing?.id === dm.id ? typing.name : null}
              runStatus={null}
              onReload={load}
              onOptimistic={pushOptimistic}
            />
          )}
          {tab === 'chat' && !group && !dm && (
            <div className="flex flex-1 items-center justify-center text-[13px] text-[#8A8A8A]">左边选一个会话</div>
          )}
          {tab === 'moments' && (
            <MomentsView
              moments={state?.moments ?? []}
              comments={state?.comments ?? []}
              agents={state?.agents ?? []}
              onReload={load}
            />
          )}
          {tab === 'contacts' && (
            <ContactsView
              agents={state?.agents ?? []}
              groups={state?.groups ?? []}
              onReload={load}
              onOpenDm={(id) => {
                setActiveSession(`dm:${id}`);
                setTab('chat');
              }}
            />
          )}

          <div className="flex items-center gap-3 border-t border-[#E3E3E3] bg-[#EDEDED] px-3 py-1 text-[11px] text-[#8A8A8A]">
            <span>
              引擎：
              <b className={state?.runtime.globalKey ? 'text-[#07C160]' : 'text-[#E6A23C]'}>
                {state?.runtime.globalKey ? '全局 key 已配' : '无全局 key（未单独配 key 的员工走演示模式）'}
              </b>
            </span>
            {runStatus && <span>状态：{runStatus.status} · 第 {runStatus.round} 轮</span>}
            <span className="ml-auto">所有发言均由模型生成 · API key 不出现在浏览器</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1 px-2">
      <div className="px-2 py-1 text-[11px] text-[#9A9A9A]">{title}</div>
      {children}
    </div>
  );
}

function SessionRow({
  active,
  onClick,
  composite,
  title,
  time,
  preview,
}: {
  active: boolean;
  onClick: () => void;
  composite: string[];
  title: string;
  time?: number;
  preview: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left ${
        active ? 'bg-[#C6C5C3]' : 'hover:bg-[#DCDBD9]'
      }`}
    >
      <div className="grid h-[36px] w-[36px] grid-cols-2 grid-rows-2 overflow-hidden rounded-md bg-[#C8C8C8]">
        {composite.slice(0, 4).map((c, i) => (
          <div key={i} className="flex items-center justify-center text-[10px] text-white">
            {c}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between">
          <span className="truncate text-[13px] text-[#191919]">{title}</span>
          <span className="shrink-0 text-[10px] text-[#9A9A9A]">
            {time ? new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
        </div>
        <div className="truncate text-[11px] text-[#8A8A8A]">{preview}</div>
      </div>
    </button>
  );
}

function NavButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
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
    </button>
  );
}
