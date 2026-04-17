"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type AuthMode = "login" | "signup";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
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
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="w-full max-w-md animate-pulse px-4">
        <div className="mb-8 text-center">
          <div className="mx-auto h-10 w-24 rounded bg-muted" />
          <div className="mx-auto mt-3 h-4 w-48 rounded bg-muted" />
        </div>
        <div className="h-96 rounded-lg border border-border bg-card" />
      </div>
    </div>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const supabase = createClient();

  // Show error from URL params (e.g., OAuth failure). Must fire from an effect
  // — toasting during render was causing duplicate toasts on every re-render
  // and the classic "setState during render" warning in React 19.
  const urlError = searchParams.get("error");
  const errorDetail = searchParams.get("detail");
  useEffect(() => {
    if (urlError) {
      toast.error(errorDetail ?? "Authentication failed. Please try again.");
    }
  }, [urlError, errorDetail]);

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/callback`,
      },
    });

    if (error) {
      toast.error(error.message);
      setGoogleLoading(false);
    }
  }

  async function handleEmailLogin() {
    if (!email || !password) {
      toast.error("Please fill in all fields.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  async function handleSignUp() {
    if (!email || !password || !confirmPassword) {
      toast.error("Please fill in all fields.");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/callback`,
      },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    toast.success("Check your email for a confirmation link.");
    setLoading(false);
    setMode("login");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "login") {
      handleEmailLogin();
    } else {
      handleSignUp();
    }
  }

  function toggleMode() {
    setMode((prev) => (prev === "login" ? "signup" : "login"));
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-muted to-primary/5">
      {/* Subtle gradient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-primary/[0.06] blur-3xl" />
        <div className="absolute -bottom-1/2 left-1/4 h-[600px] w-[600px] rounded-full bg-primary/[0.04] blur-3xl" />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative z-10 w-full max-w-md px-4">
        {/* Brand */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            FX Unlock
          </h1>
          <p className="mt-2 text-sm font-medium tracking-widest uppercase text-muted-foreground">
            Trade Journal
          </p>
        </div>

        <Card className="border-border bg-card shadow-xl shadow-border/50 backdrop-blur-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl text-foreground">
              {mode === "login" ? "Welcome back" : "Create account"}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {mode === "login"
                ? "Sign in to access your trading dashboard"
                : "Get started with your trading journey"}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Google OAuth */}
            <Button
              variant="outline"
              className="w-full border-border bg-card text-foreground hover:bg-muted hover:text-foreground"
              onClick={handleGoogleLogin}
              disabled={googleLoading || loading}
            >
              {googleLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              Continue with Google
            </Button>

            {/* Divider */}
            <div className="relative flex items-center gap-4">
              <Separator className="flex-1 bg-muted" />
              <span className="text-xs font-medium uppercase text-muted-foreground">
                or
              </span>
              <Separator className="flex-1 bg-muted" />
            </div>

            {/* Email form */}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="trader@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/30"
                  disabled={loading}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/30"
                  disabled={loading}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
              </div>

              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-foreground">
                    Confirm Password
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/30"
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={loading || googleLoading}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : mode === "login" ? (
                  "Sign In"
                ) : (
                  "Create Account"
                )}
              </Button>
            </form>

            {/* Toggle mode */}
            <p className="text-center text-sm text-muted-foreground">
              {mode === "login"
                ? "Don't have an account?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={toggleMode}
                className="font-medium text-primary underline-offset-4 transition-colors hover:text-primary/90 hover:underline"
              >
                {mode === "login" ? "Sign Up" : "Sign In"}
              </button>
            </p>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Secure, encrypted, and private by design.
        </p>
      </div>
    </div>
  );
}
