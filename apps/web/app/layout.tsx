import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
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

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const content = (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col antialiased">{children}</body>
    </html>
  );

  if (!clerkKey) {
    return content;
  }

  return <ClerkProvider appearance={{ baseTheme: dark }}>{content}</ClerkProvider>;
}
