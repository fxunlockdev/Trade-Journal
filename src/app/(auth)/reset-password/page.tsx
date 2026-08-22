"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import "@/app/_home/fxu-home.css";

/**
 * Password reset, step two.
 *
 * Arrived at from /callback, which has already exchanged the recovery code for
 * a session. That session is what authorises the change, so the page's only job
 * is to confirm one exists and then call updateUser.
 *
 * The session check is not decoration. Landing here without one means the link
 * was already used, expired, or opened in a browser that never got the cookie,
 * and updateUser would fail with a message that explains none of that.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setHasSession(data.session !== null);
      setChecking(false);
    });
    return () => { cancelled = true; };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setDone(true);
    // Straight in: the recovery session is a real session, so there is no
    // reason to make someone who just proved control of their inbox sign in
    // again with the password they set two seconds ago.
    setTimeout(() => router.push("/"), 1400);
  }

  return (
    <div className="fxu-home auth-page">
      <div className="orbs" aria-hidden="true">
        <span className="orb o1" />
        <span className="orb o2" />
        <span className="orb o3" />
      </div>

      <div className="auth-inner">
        <a className="auth-brand" href="/" aria-label="FXU home">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect width="24" height="24" rx="6" className="logo-bg" />
            <path d="M7 7h10M7 12h7M7 17h4" className="logo-fg" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>FXU Apps</span>
        </a>

        <h1 className="auth-title">
          Choose a new <span className="grad-text">password.</span>
        </h1>

        <div className="auth-card">
          {checking && (
            <div className="auth-sent">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}

          {!checking && !hasSession && (
            <div className="auth-sent">
              <p className="auth-sent-title">This link has expired.</p>
              <p className="auth-sent-body">
                Reset links work once and last an hour. Request a fresh one and it will
                work straight away.
              </p>
              <a className="btn-primary full" href="/login">Request a new link</a>
            </div>
          )}

          {!checking && hasSession && done && (
            <div className="auth-sent">
              <p className="auth-sent-title">Password updated.</p>
              <p className="auth-sent-body">Signing you in now.</p>
            </div>
          )}

          {!checking && hasSession && !done && (
            <form onSubmit={handleSubmit} className="auth-form">
              <label className="field">
                <span>New password</span>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={saving}
                  autoComplete="new-password"
                />
              </label>
              <label className="field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={saving}
                  autoComplete="new-password"
                />
              </label>
              <button type="submit" className="btn-primary full" disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : "Update password"}
              </button>
            </form>
          )}
        </div>

        <p className="auth-foot">Secure, encrypted, and private by design.</p>
      </div>
    </div>
  );
}
