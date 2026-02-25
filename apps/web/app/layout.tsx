import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export const metadata: Metadata = {
  title: {
    default: 'OpenSwarm',
    template: '%s | OpenSwarm',
  },
  description: 'Kubernetes-like orchestrator for fleets of OpenClaw AI agent instances',
  keywords: ['OpenSwarm', 'AI agents', 'orchestrator', 'OpenClaw', 'NATS', 'Cloud Computing'],
  authors: [{ name: 'OpenSwarm' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    title: 'OpenSwarm',
    description: 'Kubernetes-like orchestrator for fleets of OpenClaw AI agent instances',
    siteName: 'OpenSwarm',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col antialiased">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
