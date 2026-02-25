'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Zap, LayoutDashboard, Settings, Activity } from 'lucide-react';
import { UserButton } from '@/components/clerk-components';

function DashboardHeader() {
  const pathname = usePathname();

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl">
      <div className="flex h-14 items-center px-6">
        {/* Left: Logo */}
        <Link href="/dashboard" className="flex items-center gap-2.5 mr-8 group">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors">
            <Zap className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <span className="font-semibold text-sm text-zinc-100 tracking-tight">OpenSwarm</span>
        </Link>

        {/* Center: Nav */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Status + User */}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-600">
            <Activity className="h-3 w-3" />
            <span>Control Plane</span>
          </div>
          <UserButton afterSignOutUrl="/" />
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
