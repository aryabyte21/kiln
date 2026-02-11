import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export function SiteFooter() {
  return (
    <footer className="border-t mt-auto">
      <div className="container flex flex-col gap-4 py-10 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">CS5224 Cloud SaaS Monorepo</p>
          <p className="text-sm text-muted-foreground">
            Built for NUS Cloud Computing Project (Spring 2026)
          </p>
        </div>

        <div className="flex flex-col gap-2 md:items-end">
          <nav className="flex items-center gap-1">
            <Button variant="link" size="sm" asChild className="text-muted-foreground">
              <Link href="/docs">Documentation</Link>
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <Button variant="link" size="sm" asChild className="text-muted-foreground">
              <Link href="https://github.com" target="_blank">
                GitHub
              </Link>
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <Button variant="link" size="sm" asChild className="text-muted-foreground">
              <Link href="/api">API</Link>
            </Button>
          </nav>
          <p className="text-xs text-muted-foreground">© 2026 CS5224 Team. MIT License.</p>
        </div>
      </div>
    </footer>
  );
}
