import Link from 'next/link';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function ClerkUserButton() {
  if (!clerkEnabled) return null;

  // Dynamic import to avoid errors when ClerkProvider is absent
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { UserButton } = require('@clerk/nextjs');
  return (
    <UserButton
      afterSignOutUrl="/"
      appearance={{
        elements: {
          avatarBox: 'h-8 w-8',
        },
      }}
    />
  );
}

function DashboardHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-900/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-900/60">
      <div className="container flex h-14 items-center justify-between">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-bold text-lg text-zinc-100"
          >
            <Zap className="h-5 w-5 text-emerald-400" />
            <span>OpenSwarm</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild className="text-zinc-400 hover:text-zinc-100">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </nav>
        </div>

        {/* Right: Clerk UserButton */}
        <div className="flex items-center gap-3">
          <ClerkUserButton />
        </div>
      </div>
    </header>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <DashboardHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
