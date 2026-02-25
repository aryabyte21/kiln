'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';

/**
 * Conditional ClerkProvider that only initializes when a publishable key is
 * available. In CI or local builds without Clerk keys, children render without
 * auth context so the build doesn't crash.
 *
 * NEXT_PUBLIC_ env vars are inlined at build time by Next.js, so this check
 * works on both server and client.
 */
export function ConditionalClerkProvider({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <>{children}</>;
  }

  return <ClerkProvider appearance={{ baseTheme: dark }}>{children}</ClerkProvider>;
}
