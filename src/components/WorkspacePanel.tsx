'use client';

import { useEffect, useState } from 'react';

export default function WorkspacePanel({
  groupId,
  files,
  onClose,
}: {
  groupId: string;
  files: { name: string; size: number }[];
  onClose: () => void;
}) {
  const [cur, setCur] = useState<string | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!cur) return;
    void (async () => {
      const r = await fetch(`/api/workspace?group=${encodeURIComponent(groupId)}&file=${encodeURIComponent(cur)}`);
      const j = (await r.json()) as { ok: boolean; content: string };
      setText(j.content);
    })();
  }, [cur, groupId]);

  const mine = files.filter((f) => f.name.startsWith(groupId + '/') || !f.name.includes('/'));
  const list = mine.length ? mine : files;

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[380px] flex-col border-l border-[#D9D9D9] bg-white shadow-xl">
      <div className="flex h-[48px] shrink-0 items-center border-b border-[#E3E3E3] px-3">
        <span className="text-[13.5px] font-medium text-[#191919]">工作区</span>
        <span className="ml-2 text-[11px] text-[#8A8A8A]">workspace/{groupId}/</span>
        <button onClick={onClose} className="ml-auto text-[12px] text-[#8A8A8A] hover:text-[#07C160]">
          收起
        </button>
      </div>

      {!list.length ? (
        <div className="p-4 text-[12.5px] leading-relaxed text-[#8A8A8A]">
          还没有文件。员工只能在
          <code className="mx-1 rounded bg-[#F2F2F2] px-1">workspace/{groupId}/</code>
          里读写，越界会被拦下来。
          <br />
          想让它写东西，就在群里点名说清楚，比如「小智，把方案写成文件」。
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-[140px] shrink-0 overflow-y-auto border-r border-[#EDEDED] bg-[#FAFAFA]">
            {list.map((f) => (
              <button
                key={f.name}
                onClick={() => setCur(f.name.replace(groupId + '/', ''))}
                className={`block w-full truncate px-2 py-2 text-left text-[11.5px] ${
                  cur === f.name.replace(groupId + '/', '')
                    ? 'bg-[#E7F6EC] text-[#07C160]'
                    : 'text-[#6B6B6B] hover:bg-[#F2F2F2]'
                }`}
                title={f.name}
              >
                {f.name.replace(groupId + '/', '')}
                <span className="ml-1 text-[10px] text-[#B0B0B0]">{f.size}B</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-auto p-3">
            {cur ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-[#191919]">
                {text}
              </pre>
            ) : (
              <div className="text-[12px] text-[#8A8A8A]">左边选一个文件</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
