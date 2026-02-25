import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'OpenSwarm Dashboard',
    template: '%s | OpenSwarm',
  },
  description: 'Kubernetes-like orchestrator for AI agent fleets',
  keywords: ['OpenSwarm', 'AI Agents', 'Orchestration', 'Cloud Computing', 'CS5224'],
  authors: [{ name: 'CS5224 Team' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    title: 'OpenSwarm Dashboard',
    description: 'Kubernetes-like orchestrator for AI agent fleets',
    siteName: 'OpenSwarm',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider appearance={{ baseTheme: dark }}>
      <html lang="en" suppressHydrationWarning>
        <body className="min-h-screen flex flex-col antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
