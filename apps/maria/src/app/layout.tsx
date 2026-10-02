import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import './globals.css';

export const metadata: Metadata = {
  title: 'MarIA',
  description: 'Agent OS — pilotage de missions Claude Code et Ruflo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
