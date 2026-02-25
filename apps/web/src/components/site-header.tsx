import Link from 'next/link';
import { Menu, Github, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function AuthSection() {
  if (!clerkEnabled) {
    return (
      <Button size="sm" asChild className="hidden md:inline-flex">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }

  // Dynamic import to avoid errors when ClerkProvider is absent
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SignedIn, SignedOut, SignInButton, UserButton } = require('@clerk/nextjs');
  return (
    <>
      <SignedOut>
        <SignInButton mode="redirect">
          <Button size="sm" className="hidden md:inline-flex">
            Sign in
          </Button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </>
  );
}

function MobileAuthSection() {
  if (!clerkEnabled) {
    return (
      <Button size="sm" asChild className="w-full justify-start">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SignedIn, SignedOut, SignInButton, UserButton } = require('@clerk/nextjs');
  return (
    <>
      <SignedOut>
        <SignInButton mode="redirect">
          <Button size="sm" className="w-full justify-start">
            Sign in
          </Button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <div className="flex items-center gap-2 px-2">
          <UserButton afterSignOutUrl="/" />
          <span className="text-sm text-muted-foreground">Account</span>
        </div>
      </SignedIn>
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Button variant="ghost" asChild className="h-auto px-0 hover:bg-transparent">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <Zap className="h-6 w-6 text-primary" />
            <span>OpenSwarm</span>
          </Link>
        </Button>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">Home</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="hidden md:inline-flex">
            <a href="https://github.com" target="_blank" rel="noopener noreferrer">
              <Github className="h-4 w-4" />
            </a>
          </Button>

          <AuthSection />

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
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
                <div className="border-t pt-4 mt-4 space-y-2">
                  <Button variant="outline" size="sm" asChild className="w-full justify-start">
                    <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                      <Github className="h-4 w-4 mr-2" />
                      GitHub
                    </a>
                  </Button>
                  <MobileAuthSection />
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
