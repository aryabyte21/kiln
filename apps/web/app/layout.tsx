import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export const metadata: Metadata = {
  title: {
    default: 'CS5224 Cloud SaaS Monorepo',
    template: '%s | CS5224',
  },
  description:
    'Production-ready polyglot monorepo with Next.js 15, React 19, FastAPI, Go, and Drizzle ORM',
  keywords: ['Next.js', 'React', 'FastAPI', 'Go', 'PostgreSQL', 'Cloud Computing', 'CS5224'],
  authors: [{ name: 'CS5224 Team' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    title: 'CS5224 Cloud SaaS Monorepo',
    description: 'Production-ready polyglot monorepo for building cloud-native SaaS applications',
    siteName: 'CS5224 Monorepo',
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
