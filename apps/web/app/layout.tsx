import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CS5224 Cloud Starter',
  description: 'Polyglot monorepo starter with Next.js, FastAPI, Go, and Drizzle'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
