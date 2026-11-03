'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentPublic, Group, Message } from '@/lib/types';
import Avatar from './Avatar';
import WorkspacePanel from './WorkspacePanel';

type GroupFull = Group & { members: AgentPublic[]; messages: Message[] };
type DmSession = { id: string; agent: AgentPublic; messages: Message[] };

export default function ChatView({
  mode,
  group,
  dm,
  typing,
  runStatus,
  onReload,
  onOptimistic,
}: {
  mode: 'group' | 'dm';
  group?: GroupFull;
  dm?: DmSession;
  typing: string | null;
  runStatus: { status: string; round: number } | null;
  onReload: () => void;
  onOptimistic: (m: Message) => void;
}) {
  const [goal, setGoal] = useState<string>(() => (typeof window !== 'undefined' ? localStorage.getItem('ai-office:defaultGoal') || '' : ''));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [showWs, setShowWs] = useState(false);
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<{ id: string; agent_name: string | null; tag: string; provider: string; model: string; attempt: number; duration_ms: number; success: number; error: string | null; created_at: number }[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(0);

  function chooseMention(name: string) {
    const ta = taRef.current;
    const pos = ta?.selectionStart ?? draft.length;
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(pos);
    const next = `${before}@${name} ${after}`;
    setDraft(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      ta?.focus();
      const c = before.length + name.length + 2;
      ta?.setSelectionRange(c, c);
    });
  }
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = mode === 'group' ? group?.messages ?? [] : dm?.messages ?? [];
  const members = mode === 'group' ? group?.members ?? [] : dm ? [dm.agent] : [];
  const mentionMatches =
    mode === 'group' ? members.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8) : [];
  // 当查询为空 / 含 all / 含"所有人"时，在联想列表顶部提供"艾特所有人"
  const showAllOption =
    mode === 'group' &&
    (mentionQuery === '' || '所有人'.includes(mentionQuery) || mentionQuery.toLowerCase().includes('all'));

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
    const rid = messages.filter((m) => m.run_id).pop()?.run_id;
    if (!rid) return;
    setStopping(true);
    try {
      await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', runId: rid }),
      });
    } finally {
      setStopping(false);
      onReload();
    }
  }

  async function send() {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    setMentionOpen(false);
    const sessionId = mode === 'group' ? group?.id : dm?.id;
    if (sessionId) {
      // 先插一条临时气泡，发出去那一刻就能看见，不用等服务端往返
      onOptimistic({
        id: `tmp_${Date.now()}`,
        group_id: sessionId,
        run_id: null,
        sender_id: 'boss',
        sender_name: '老板',
        content: t,
        kind: 'human',
        created_at: Date.now(),
        meta: null,
      });
    }
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

  async function openWorkspace() {
    if (showWs) {
      setShowWs(false);
      return;
    }
    const r = await fetch(`/api/workspace?group=${encodeURIComponent(group?.id ?? '')}`);
    const j = (await r.json()) as { files: { name: string; size: number }[] };
    setFiles(j.files ?? []);
    setShowWs(true);
  }

  async function openLogs() {
    if (showLogs) {
      setShowLogs(false);
      return;
    }
    const runId = [...messages].reverse().find((m) => m.run_id)?.run_id;
    const res = await fetch(`/api/logs${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`, { cache: 'no-store' });
    const data = (await res.json()) as { logs?: typeof logs };
    setLogs(data.logs ?? []);
    setShowLogs(true);
  }

  const running = runStatus?.status === 'running';
  const runActive = !!runStatus && (runStatus.status === 'running' || runStatus.status === 'paused');
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
              {runActive && (
                <button
                  onClick={() => void stopRun()}
                  disabled={stopping}
                  className="rounded border border-[#D9534F] bg-white px-2 py-1 text-[12px] text-[#D9534F] hover:bg-[#FCEDED] disabled:opacity-50"
                >
                  {stopping ? '正在结束…' : running ? '中止任务' : '结束任务'}
                </button>
              )}
            </>
          ) : (
            <span className="text-[11px] text-[#8A8A8A]">只有你俩能看到 · 你说的会只进它的记忆</span>
          )}
          {mode === 'group' && (
            <>
              <button
                onClick={() => void openWorkspace()}
              className={`rounded border px-2 py-1 text-[12px] ${
                showWs ? 'border-[#07C160] bg-[#07C160] text-white' : 'border-[#D9D9D9] bg-white text-[#6B6B6B]'
              }`}
              >
                工作区
              </button>
              <button
                onClick={() => void openLogs()}
                className={`rounded border px-2 py-1 text-[12px] ${
                  showLogs ? 'border-[#07C160] bg-[#07C160] text-white' : 'border-[#D9D9D9] bg-white text-[#6B6B6B]'
                }`}
              >
                运行记录
              </button>
            </>
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

                <div ref={bottomRef} />
      </div>

      <div className="relative shrink-0 border-t border-[#E3E3E3] bg-[#F5F5F5]">
        {mode === 'group' && mentionOpen && (mentionMatches.length > 0 || showAllOption) && (
          <div className="absolute bottom-full left-4 right-4 mb-2 max-h-[220px] overflow-y-auto rounded-lg border border-[#E0E0E0] bg-white shadow-lg">
            <div className="sticky top-0 bg-[#FAFAFA] px-3 py-1.5 text-[11px] text-[#8A8A8A] border-b border-[#F0F0F0]">
              输入 @ 后自动列出当前群成员，点选即可 @ 他
            </div>
            {showAllOption && (
              <button
                type="button"
                onClick={() => chooseMention('所有人')}
                className="flex w-full items-center gap-2 border-b border-[#F0F0F0] px-3 py-1.5 text-left text-[13px] text-[#07C160] hover:bg-[#F2F7F2]"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#07C160] text-[11px] text-white">
                  全
                </span>
                <span className="font-medium">艾特所有人</span>
                <span className="ml-auto text-[11px] text-[#B0B0B0]">全员当场回话</span>
              </button>
            )}
            {mentionMatches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => chooseMention(m.name)}
                className="block w-full px-3 py-1.5 text-left text-[13px] text-[#191919] hover:bg-[#F2F7F2]"
              >
                <span className="text-[#576B95]">@{m.name}</span>
                <span className="ml-2 text-[11px] text-[#B0B0B0]">{m.role}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 px-4 pt-2 text-[11px] text-[#8A8A8A]">
          <span>老板（你）</span>
          {mode === 'group' && <span>· 你的话会在下一轮被组长读到 · 输入 @ 可点名当前群成员</span>}
          {mode === 'dm' && <span>· 直接对话，它会立刻回你</span>}
          <button onClick={onReload} className="ml-auto hover:text-[#07C160]">
            刷新
          </button>
        </div>
        <div className="flex items-end gap-2 px-4 py-2">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => {
              const val = e.target.value;
              const pos = e.target.selectionStart ?? val.length;
              setDraft(val);
              if (mode === 'group') {
                const before = val.slice(0, pos);
                const at = before.lastIndexOf('@');
                if (at >= 0 && !/\s/.test(before.slice(at + 1))) {
                  setMentionOpen(true);
                  setMentionQuery(before.slice(at + 1));
                  setMentionStart(at);
                } else {
                  setMentionOpen(false);
                }
              } else {
                setMentionOpen(false);
              }
            }}
            onKeyDown={(e) => {
              if (mentionOpen && (mentionMatches.length || showAllOption)) {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  chooseMention(mentionMatches.length ? mentionMatches[0].name : '所有人');
                  return;
                }
                if (e.key === 'Escape') {
                  setMentionOpen(false);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={mode === 'group' ? '以老板身份插话…（输入 @ 点名）' : '直接跟它说…'}
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

      {showWs && mode === 'group' && group && (
        <WorkspacePanel groupId={group.id} files={files} onClose={() => setShowWs(false)} />
      )}
      {showLogs && mode === 'group' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
          <div className="flex h-[520px] w-[720px] flex-col rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center">
              <div>
                <div className="text-[14px] font-medium text-[#191919]">模型调用记录</div>
                <div className="text-[11px] text-[#8A8A8A]">不记录提示词、回复或 API Key；失败项会显示原因。</div>
              </div>
              <button onClick={() => setShowLogs(false)} className="ml-auto text-[12px] text-[#8A8A8A] hover:text-[#191919]">关闭</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded border border-[#EAEAEA]">
              {!logs.length ? (
                <div className="p-4 text-[12px] text-[#8A8A8A]">还没有模型调用记录。</div>
              ) : logs.map((item) => (
                <div key={item.id} className="border-b border-[#F0F0F0] px-3 py-2 text-[12px] last:border-0">
                  <div className="flex gap-2">
                    <span className={item.success ? 'text-[#07A853]' : 'text-[#FA5151]'}>{item.success ? '成功' : '失败'}</span>
                    <span className="font-medium text-[#191919]">{item.agent_name || '系统'}</span>
                    <span className="text-[#6B6B6B]">{item.provider} / {item.model}</span>
                    <span className="ml-auto text-[#8A8A8A]">{item.duration_ms} ms · 第 {item.attempt} 次</span>
                  </div>
                  {!item.success && item.error && <div className="mt-1 break-all text-[#FA5151]">{item.error}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
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
      <Avatar id={m.sender_id} text={agent?.avatar || m.sender_name.slice(0, 1)} size={34} />
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
