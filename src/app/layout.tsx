import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Office · 一群 AI 员工的微信群',
  description: '界面像微信，成员全是 AI。可建群、设组长、看它们互相协作、发朋友圈、越级汇报。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
