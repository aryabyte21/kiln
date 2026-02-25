'use client';

import {
  SignedIn as ClerkSignedIn,
  SignedOut as ClerkSignedOut,
  SignInButton as ClerkSignInButton,
  UserButton as ClerkUserButton,
} from '@clerk/nextjs';

/**
 * Thin wrappers around Clerk components that render nothing when Clerk is not
 * configured. NEXT_PUBLIC_ env vars are inlined at build time by Next.js, so
 * the tree-shaker can eliminate the Clerk code paths in keyless builds.
 */

const enabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function SignedIn({ children }: { children: React.ReactNode }) {
  if (!enabled) return null;
  return <ClerkSignedIn>{children}</ClerkSignedIn>;
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  if (!enabled) return null;
  return <ClerkSignedOut>{children}</ClerkSignedOut>;
}

export function SignInButton({
  children,
  mode,
}: {
  children?: React.ReactNode;
  mode?: 'redirect' | 'modal';
}) {
  if (!enabled) return null;
  return <ClerkSignInButton mode={mode}>{children}</ClerkSignInButton>;
}

export function UserButton({ afterSignOutUrl }: { afterSignOutUrl?: string }) {
  if (!enabled) return null;
  return (
    <ClerkUserButton
      afterSignOutUrl={afterSignOutUrl}
      appearance={{ elements: { avatarBox: 'h-8 w-8' } }}
    />
  );
}
