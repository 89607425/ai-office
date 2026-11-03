import React from 'react';

export type AiIconKey = 'ds' | 'gpt' | 'gemini' | 'glm' | 'kimi' | 'hunyuan' | 'doubao' | 'claude' | 'grok' | 'kiro' | 'qwen';

/** 给新建/编辑员工选头像用的主流 AI 图标清单（对应 public/assets 下真实图标） */
export const AI_ICON_META: { key: AiIconKey; name: string }[] = [
  { key: 'ds', name: 'DeepSeek' },
  { key: 'gpt', name: 'GPT' },
  { key: 'gemini', name: 'Gemini' },
  { key: 'glm', name: '智谱 GLM' },
  { key: 'kimi', name: 'Kimi' },
  { key: 'hunyuan', name: '混元' },
  { key: 'doubao', name: '豆包' },
  { key: 'claude', name: 'Claude' },
  { key: 'grok', name: 'Grok' },
  { key: 'kiro', name: 'Kiro' },
  { key: 'qwen', name: '通义千问' },
];

/** 真实图标文件，与 public/assets 下文件一一对应 */
const FILE: Record<AiIconKey, string> = {
  ds: 'ds.jpg',
  gpt: 'gpt.jpg',
  gemini: 'gemini.jpeg',
  glm: 'glm.png',
  kimi: 'kimi.png',
  doubao: 'doubao.png',
  hunyuan: 'hunyuan.svg',
  claude: 'claude.png',
  grok: 'grok.png',
  kiro: 'kiro.png',
  qwen: 'qwen.jpeg',
};

/** 品牌底色，仅做图标加载前的占位/兜底 */
const BRAND: Record<AiIconKey, string> = {
  ds: '#4D6BFE',
  gpt: '#10A37F',
  gemini: '#4285F4',
  glm: '#6E4FF0',
  kimi: '#FF6A3D',
  hunyuan: '#0052D9',
  doubao: '#00A4FF',
  claude: '#D97757',
  grok: '#111827',
  kiro: '#2DA89E',
  qwen: '#5B5BD6',
};

export default function AiIcon({
  kind,
  size = 36,
  radius = 6,
}: {
  kind: string;
  size?: number;
  radius?: number;
}) {
  const key = (kind in FILE ? kind : 'ds') as AiIconKey;
  const bg = BRAND[key];
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        background: bg,
        lineHeight: 0,
        flexShrink: 0,
      }}
      role="img"
      aria-label={key}
    >
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/assets/${FILE[key]}`}
        width={size}
        height={size}
        alt={key}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </span>
  );
}
