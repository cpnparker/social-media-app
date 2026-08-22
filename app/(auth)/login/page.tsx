"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

/** Return the correct post-login destination based on the current subdomain. */
function getSubdomainDefault(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "ai.thecontentengine.com") return "/";
    if (host === "operations.thecontentengine.com")
      return "/operations/commissioned-cus";
  }
  return "/dashboard";
}

function LoginContent() {
  const searchParams = useSearchParams();
  // Respect callbackUrl from URL params (e.g. /login?callbackUrl=/)
  // so each subdomain returns to the right page after OAuth.
  // Fallback is subdomain-aware so the AI & ops subdomains never
  // accidentally land on /dashboard if the param is lost.
  const explicitUrl = searchParams.get("callbackUrl");
  const callbackUrl = explicitUrl || getSubdomainDefault();

  const handleGoogleLogin = () => {
    signIn("google", { callbackUrl });
  };

  return (
    <div className="space-y-8">
      {/* Mobile logo */}
      <div className="lg:hidden flex justify-center mb-4">
        <img
          src="/assets/logo_engine_text_blue.png"
          alt="The Content Engine"
          width={216}
          height={26}
          className="h-[26px] w-auto"
        />
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground">
          Sign in to your account to continue
        </p>
      </div>

      <Button
        variant="outline"
        className="w-full h-12 text-base font-medium gap-3"
        onClick={handleGoogleLogin}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Sign in with your Google workspace account to get started.
      </p>
    </div>
  );
}
