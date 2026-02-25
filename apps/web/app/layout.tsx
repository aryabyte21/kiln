import type { Metadata } from 'next';
import { ConditionalClerkProvider } from '@/components/clerk-provider';
import './globals.css';

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
    <ConditionalClerkProvider>
      <html lang="en" className="dark" suppressHydrationWarning>
        <body className="min-h-screen flex flex-col antialiased">{children}</body>
      </html>
    </ConditionalClerkProvider>
  );
}
