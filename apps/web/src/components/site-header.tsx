import Link from 'next/link';
import { Menu, Github, Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Button variant="ghost" asChild className="h-auto px-0 hover:bg-transparent">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <Cloud className="h-6 w-6 text-primary" />
            <span>CS5224</span>
          </Link>
        </Button>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">Home</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/showcase">Components</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/docs">Documentation</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/api">API</Link>
          </Button>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="hidden md:inline-flex">
            <a href="https://github.com" target="_blank" rel="noopener noreferrer">
              <Github className="h-4 w-4" />
            </a>
          </Button>

          {/* Mobile Menu */}
          <Sheet>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="sm">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px]">
              <nav className="flex flex-col gap-4 mt-8">
                <Button variant="ghost" asChild className="justify-start">
                  <Link href="/">Home</Link>
                </Button>
                <Button variant="ghost" asChild className="justify-start">
                  <Link href="/showcase">Components</Link>
                </Button>
                <Button variant="ghost" asChild className="justify-start">
                  <Link href="/docs">Documentation</Link>
                </Button>
                <Button variant="ghost" asChild className="justify-start">
                  <Link href="/api">API</Link>
                </Button>
                <div className="border-t pt-4 mt-4">
                  <Button variant="outline" size="sm" asChild className="w-full justify-start">
                    <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                      <Github className="h-4 w-4 mr-2" />
                      GitHub
                    </a>
                  </Button>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
