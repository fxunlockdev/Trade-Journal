"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeInternalPath } from "@/lib/safe-next";
import { stashSignupIntent, type SignupIntent } from "@/lib/auth/signup-intent";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import "@/app/_home/fxu-home.css";

type AuthMode = "login" | "signup" | "reset";

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
  const [mode, setMode] = useState<AuthMode>(
    searchParams.get("mode") === "signup" ? "signup" : "login",
  );

  // Post-auth destination — guarded to a relative in-app path so a crafted
  // ?next=//evil.com can't bounce the user off-site. Middleware sets ?next
  // when it redirects an unauthenticated user here from /crm or /admin.
  const safeNext = safeInternalPath(searchParams.get("next"), "/");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Defaults to trader because that is the overwhelming majority and it is the
  // choice that grants nothing beyond the journal everyone already gets.
  const [intent, setIntent] = useState<SignupIntent>("trader");
  const [resetSent, setResetSent] = useState(false);

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
    // OAuth carries no payload of our own, so the answer goes to sessionStorage
    // and is picked up after the redirect lands. Only meaningful when signing
    // up; an existing user already has an intent recorded and it is write-once.
    if (mode === "signup") stashSignupIntent(intent);
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

    router.push(safeNext);
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

    // Two carriers, deliberately. user_metadata survives the confirmation link
    // being opened later in another browser; sessionStorage covers the case
    // where the account is confirmed in this same tab.
    stashSignupIntent(intent);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/callback`,
        data: { signup_intent: intent },
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

  /**
   * Password reset, step one.
   *
   * The recovery link is pointed at /callback, which exchanges the code and
   * then forwards to /reset-password. Reusing the callback rather than landing
   * on the reset page directly means the session is established by the same
   * hardened path as every other sign-in.
   *
   * Success is reported the same way whether or not the address has an account.
   * Saying "no account found" here would turn this form into a way to test
   * which email addresses are registered.
   */
  async function handleResetRequest() {
    if (!email) {
      toast.error("Enter the email you signed up with.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/callback?next=%2Freset-password`,
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setResetSent(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "reset") {
      void handleResetRequest();
    } else if (mode === "login") {
      void handleEmailLogin();
    } else {
      void handleSignUp();
    }
  }

  function goToMode(next: AuthMode) {
    setMode(next);
    setPassword("");
    setConfirmPassword("");
    setResetSent(false);
  }

  function toggleMode() {
    goToMode(mode === "login" ? "signup" : "login");
  }

  return (
    <div className="fxu-home auth-page">
      {/* Same ambient orbs as the landing hero — one visual system. */}
      <div className="orbs" aria-hidden="true">
        <span className="orb o1" />
        <span className="orb o2" />
        <span className="orb o3" />
      </div>

      <div className="auth-inner">
        {/* Brand — the platform sign-in, not a per-app login */}
        <a className="auth-brand" href="/" aria-label="FXU home">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect width="24" height="24" rx="6" className="logo-bg" />
            <path d="M7 7h10M7 12h7M7 17h4" className="logo-fg" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>FXU Apps</span>
        </a>

        <h1 className={mode === "login" ? "auth-title auth-title-solo" : "auth-title"}>
          {mode === "login" && <>Welcome back to <span className="grad-text">FXU.</span></>}
          {mode === "signup" && <>Join <span className="grad-text">FXU.</span></>}
          {mode === "reset" && <>Reset your <span className="grad-text">password.</span></>}
        </h1>
        {mode === "signup" && (
          <p className="auth-sub">One account for the journal and your partnerships.</p>
        )}
        {mode === "reset" && (
          <p className="auth-sub">We&apos;ll email you a link to choose a new one.</p>
        )}

        {mode === "reset" ? (
          <div className="auth-card">
            {resetSent ? (
              <div className="auth-sent">
                <p className="auth-sent-title">Check your inbox.</p>
                <p className="auth-sent-body">
                  If an FXU account uses <strong>{email}</strong>, a reset link is on its
                  way. It expires in an hour.
                </p>
                <button type="button" className="btn-ghost full" onClick={() => goToMode("login")}>
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                <form onSubmit={handleSubmit} className="auth-form">
                  <label className="field">
                    <span>Email</span>
                    <input
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      autoComplete="email"
                    />
                  </label>
                  <button type="submit" className="btn-primary full" disabled={loading}>
                    {loading ? <Loader2 className="size-4 animate-spin" /> : "Send reset link"}
                  </button>
                </form>
                <p className="auth-toggle">
                  Remembered it?{" "}
                  <button type="button" onClick={() => goToMode("login")}>Sign in</button>
                </p>
              </>
            )}
          </div>
        ) : (
        <div className="auth-card">
          <button
            className="auth-google"
            onClick={handleGoogleLogin}
            disabled={googleLoading || loading}
            type="button"
          >
            {googleLoading ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </button>
          <p className="auth-hint">Existing FXU accounts sign in with Google.</p>

          <div className="auth-divider"><span>or</span></div>

          {mode === "signup" && (
            <fieldset className="auth-intent">
              <legend>What brings you to FXU?</legend>
              {(
                [
                  { id: "trader", title: "I trade my own account", sub: "Journal, analytics and the calculators" },
                  { id: "ib", title: "I introduce clients", sub: "Also request the Affiliate CRM" },
                ] as const
              ).map((option) => (
                <label
                  key={option.id}
                  className={`auth-intent-opt ${intent === option.id ? "on" : ""}`}
                >
                  <input
                    type="radio"
                    name="signup-intent"
                    value={option.id}
                    checked={intent === option.id}
                    onChange={() => setIntent(option.id)}
                    disabled={loading || googleLoading}
                  />
                  <span>
                    <strong>{option.title}</strong>
                    <em>{option.sub}</em>
                  </span>
                </label>
              ))}
              {/* Said plainly, so nobody picks IB expecting the CRM to appear. */}
              <p className="auth-intent-note">
                Either way your Trade Journal is ready straight away. The Affiliate CRM
                opens once an FXU admin approves you.
              </p>
            </fieldset>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoComplete="email"
              />
            </label>

            {/* A div, not a label: "Forgot password?" is a real button, and a
                button nested inside a label never receives its own click. The
                browser forwards it to the labelled input instead, so the
                handler silently never ran. The input keeps its association
                through htmlFor. */}
            <div className="field">
              <span className="field-label-row">
                <label htmlFor="auth-password">Password</label>
                {mode === "login" && (
                  <button
                    type="button"
                    className="field-aside"
                    onClick={() => goToMode("reset")}
                  >
                    Forgot password?
                  </button>
                )}
              </span>
              <input
                id="auth-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>

            {mode === "signup" && (
              <label className="field">
                <span>Confirm password</span>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </label>
            )}

            <button type="submit" className="btn-primary full" disabled={loading || googleLoading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="auth-toggle">
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button type="button" onClick={toggleMode}>
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
        )}

        <p className="auth-foot">Secure, encrypted, and private by design.</p>
      </div>
    </div>
  );
}
