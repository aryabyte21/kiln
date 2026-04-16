"use client";

import { useAuth, SignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";

function McpAuthInner() {
  const { isSignedIn, getToken } = useAuth();
  const searchParams = useSearchParams();
  const callback = searchParams.get("callback");

  useEffect(() => {
    if (!isSignedIn || !callback) return;

    getToken().then((token) => {
      if (token) {
        const sep = callback.includes("?") ? "&" : "?";
        window.location.href = `${callback}${sep}__clerk_session_token=${token}`;
      }
    });
  }, [isSignedIn, callback, getToken]);

  if (!callback) {
    return <div className="flex items-center justify-center min-h-screen text-white">Missing callback parameter.</div>;
  }

  if (!isSignedIn) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <SignIn afterSignInUrl={`/mcp-auth?callback=${encodeURIComponent(callback)}`} />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen text-white">
      Authenticating with MCP server...
    </div>
  );
}

export default function McpAuthPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-white">Loading...</div>}>
      <McpAuthInner />
    </Suspense>
  );
}
