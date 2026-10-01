import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MarIA',
  description: 'Agent OS — pilotage de missions Claude Code et Ruflo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
