'use client';

import { useState } from 'react';
import type { AgentPublic, Group } from '@/lib/types';
import Avatar, { colorOf } from './Avatar';

type GroupFull = Group & { members: AgentPublic[]; messages: { id: string }[] };

const PROVIDERS = [
  { id: '', label: '不单独指定（用全局兜底）' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'moonshot', label: 'Kimi / Moonshot' },
  { id: 'qwen', label: '通义千问' },
  { id: 'custom', label: '自定义（填 .env 里的 LLM_BASE_URL）' },
];

const DEFAULT_MODELS: Record<string, string> = {
  deepseek: 'deepseek-chat',
  moonshot: 'moonshot-v1-8k',
  qwen: 'qwen-plus',
};

export default function ContactsView({
  agents,
  groups,
  onReload,
  onOpenDm,
}: {
  agents: AgentPublic[];
  groups: GroupFull[];
  onReload: () => void;
  onOpenDm: (agentId: string) => void;
}) {
  const [panel, setPanel] = useState<'none' | 'agent' | 'group'>('none');

  return (
    <>
      <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-[#E3E3E3] bg-[#F5F5F5] px-4">
        <div>
          <div className="text-[15px] font-medium text-[#191919]">通讯录</div>
          <div className="text-[11px] text-[#8A8A8A]">每个员工可以来自不同厂家，用各自的 key</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPanel(panel === 'agent' ? 'none' : 'agent')}
            className={`rounded px-3 py-1 text-[12px] ${
              panel === 'agent' ? 'bg-[#07C160] text-white' : 'border border-[#D9D9D9] bg-white text-[#6B6B6B]'
            }`}
          >
            + 新建员工
          </button>
          <button
            onClick={() => setPanel(panel === 'group' ? 'none' : 'group')}
            className={`rounded px-3 py-1 text-[12px] ${
              panel === 'group' ? 'bg-[#07C160] text-white' : 'border border-[#D9D9D9] bg-white text-[#6B6B6B]'
            }`}
          >
            + 新建群聊
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#F5F5F5] px-6 py-4">
        <div className="mx-auto max-w-[760px] space-y-5">
          {panel === 'agent' && <NewAgentForm onDone={() => { setPanel('none'); onReload(); }} />}
          {panel === 'group' && (
            <NewGroupForm agents={agents} onDone={() => { setPanel('none'); onReload(); }} />
          )}

          <section>
            <div className="mb-2 text-[12px] text-[#8A8A8A]">员工（{agents.length}）</div>
            <div className="space-y-2">
              {agents.map((a) => (
                <div key={a.id} className="flex items-start gap-3 rounded-lg bg-white p-3">
                  <Avatar id={a.id} text={a.avatar} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium text-[#191919]">{a.name}</span>
                      <span className="text-[11px] text-[#8A8A8A]">{a.role}</span>
                      <span
                        className="ml-auto rounded px-1.5 py-[1px] text-[10px]"
                        style={{
                          background: a.binding === '演示模式' ? '#FFF3E0' : '#E7F6EC',
                          color: a.binding === '演示模式' ? '#E6A23C' : '#07C160',
                        }}
                      >
                        {a.binding}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[#6B6B6B]">
                      {a.system_prompt}
                    </div>
                    <div className="mt-1 text-[11px] text-[#9A9A9A]">
                      {a.key_set ? `自带 key ${a.key_hint}` : '未配 key（走全局或演示模式）'}
                    </div>
                  </div>
                  <button
                    onClick={() => onOpenDm(a.id)}
                    className="shrink-0 rounded border border-[#D9D9D9] px-2 py-1 text-[11px] text-[#6B6B6B] hover:border-[#07C160] hover:text-[#07C160]"
                  >
                    私聊
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 text-[12px] text-[#8A8A8A]">群聊（{groups.length}）</div>
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.id} className="flex items-center gap-3 rounded-lg bg-white p-3">
                  <div className="grid h-[40px] w-[40px] grid-cols-2 grid-rows-2 overflow-hidden rounded-md bg-[#C8C8C8]">
                    {g.members.slice(0, 4).map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-center text-[10px] text-white"
                        style={{ background: colorOf(m.id) }}
                      >
                        {m.avatar}
                      </div>
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-[#191919]">{g.name}</div>
                    <div className="text-[11px] text-[#8A8A8A]">
                      组长 {g.members.find((m) => m.id === g.leader_id)?.name ?? '—'} · 反对者{' '}
                      {g.members.find((m) => m.id === g.critic_id)?.name ?? '—'} · {g.members.length} 人
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function NewAgentForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({
    name: '',
    role: '',
    system_prompt: '',
    provider: 'deepseek',
    api_key: '',
    model: '',
    sassiness: 0.3,
    tone: '',
    catchphrase: '',
    tools_enabled: 0,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    setBusy(true);
    setErr('');
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok) {
      setErr(json.error || '创建失败');
      return;
    }
    onDone();
  }

  return (
    <div className="rounded-lg border border-[#07C160] bg-white p-4">
      <div className="mb-3 text-[13.5px] font-medium text-[#191919]">新建员工</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="名字">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="比如 小周" className={inputCls} />
        </Field>
        <Field label="岗位">
          <input value={f.role} onChange={(e) => set('role', e.target.value)} placeholder="比如 数据分析" className={inputCls} />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="人设（最关键，决定它怎么说话和思考）">
          <textarea
            value={f.system_prompt}
            onChange={(e) => set('system_prompt', e.target.value)}
            rows={3}
            placeholder="你是小周，数据分析师。你只信数据不信感觉，说话爱带数字，对模糊的需求会追问口径。"
            className={`${inputCls} resize-none`}
          />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Field label="厂商">
          <select
            value={f.provider}
            onChange={(e) => {
              set('provider', e.target.value);
              set('model', '');
            }}
            className={inputCls}
          >
            {PROVIDERS.filter((p) => p.id).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="API Key（可留空）">
          <input
            type="password"
            value={f.api_key}
            onChange={(e) => set('api_key', e.target.value)}
            placeholder="sk-..."
            className={inputCls}
          />
        </Field>
        <Field label={`模型（留空用 ${DEFAULT_MODELS[f.provider] ?? '默认'}）`}>
          <input
            value={f.model}
            onChange={(e) => set('model', e.target.value)}
            placeholder={DEFAULT_MODELS[f.provider] ?? ''}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Field label={`怨气值 ${f.sassiness.toFixed(2)}（越高越爱越级汇报）`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={f.sassiness}
            onChange={(e) => set('sassiness', Number(e.target.value))}
            className="w-full"
          />
        </Field>
        <Field label="口头禅（可留空）">
          <input value={f.catchphrase} onChange={(e) => set('catchphrase', e.target.value)} placeholder="这个数不对吧" className={inputCls} />
        </Field>
        <Field label="允许读写文件">
          <label className="flex items-center gap-2 text-[12px] text-[#6B6B6B]">
            <input
              type="checkbox"
              checked={!!f.tools_enabled}
              onChange={(e) => set('tools_enabled', e.target.checked ? 1 : 0)}
            />
            开（只限 workspace 目录）
          </label>
        </Field>
      </div>

      {err && <div className="mt-2 text-[12px] text-[#FA5151]">{err}</div>}

      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => void submit()} disabled={busy} className="rounded bg-[#07C160] px-4 py-1.5 text-[12.5px] text-white hover:bg-[#06AD56] disabled:opacity-40">
          {busy ? '创建中' : '创建'}
        </button>
        <button onClick={onDone} className="rounded border border-[#D9D9D9] px-3 py-1.5 text-[12.5px] text-[#8A8A8A]">
          取消
        </button>
        <span className="ml-auto text-[11px] text-[#9A9A9A]">不填 key 就走全局配置或演示模式</span>
      </div>
    </div>
  );
}

function NewGroupForm({ agents, onDone }: { agents: AgentPublic[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leaderId, setLeaderId] = useState('');
  const [criticId, setCriticId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setMemberIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function submit() {
    setBusy(true);
    setErr('');
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, topic, memberIds, leaderId: leaderId || memberIds[0], criticId }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok) {
      setErr(json.error || '创建失败');
      return;
    }
    onDone();
  }

  return (
    <div className="rounded-lg border border-[#07C160] bg-white p-4">
      <div className="mb-3 text-[13.5px] font-medium text-[#191919]">新建群聊</div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="群名">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如 增长实验群" className={inputCls} />
        </Field>
        <Field label="主题（可留空）">
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="这个群是干嘛的" className={inputCls} />
        </Field>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[11px] text-[#8A8A8A]">成员</div>
        <div className="flex flex-wrap gap-2">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => toggle(a.id)}
              className={`flex items-center gap-1 rounded border px-2 py-1 text-[12px] ${
                memberIds.includes(a.id)
                  ? 'border-[#07C160] bg-[#E7F6EC] text-[#07C160]'
                  : 'border-[#D9D9D9] bg-white text-[#6B6B6B]'
              }`}
            >
              <span style={{ color: colorOf(a.id) }}>{a.avatar}</span>
              {a.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="组长">
          <select value={leaderId} onChange={(e) => setLeaderId(e.target.value)} className={inputCls}>
            <option value="">（默认第一个成员）</option>
            {memberIds.map((id) => {
              const a = agents.find((x) => x.id === id);
              return a ? (
                <option key={id} value={id}>
                  {a.name} · {a.role}
                </option>
              ) : null;
            })}
          </select>
        </Field>
        <Field label="指定反对者（负责挑刺）">
          <select value={criticId} onChange={(e) => setCriticId(e.target.value)} className={inputCls}>
            <option value="">（自动选一个）</option>
            {memberIds.map((id) => {
              const a = agents.find((x) => x.id === id);
              return a ? (
                <option key={id} value={id}>
                  {a.name} · {a.role}
                </option>
              ) : null;
            })}
          </select>
        </Field>
      </div>

      {err && <div className="mt-2 text-[12px] text-[#FA5151]">{err}</div>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy || !name || memberIds.length < 2}
          className="rounded bg-[#07C160] px-4 py-1.5 text-[12.5px] text-white hover:bg-[#06AD56] disabled:opacity-40"
        >
          {busy ? '创建中' : '建群'}
        </button>
        <button onClick={onDone} className="rounded border border-[#D9D9D9] px-3 py-1.5 text-[12.5px] text-[#8A8A8A]">
          取消
        </button>
        <span className="ml-auto text-[11px] text-[#9A9A8A]">至少选 2 个人</span>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded border border-[#D9D9D9] bg-white px-2 py-1.5 text-[12.5px] text-[#191919] outline-none focus:border-[#07C160]';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] text-[#8A8A8A]">{label}</div>
      {children}
    </label>
  );
}
