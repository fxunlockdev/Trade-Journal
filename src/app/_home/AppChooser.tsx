"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EDUCATION_URL, isExternalEducation } from "@/lib/education-url";
import type { ProductKey } from "@/lib/auth/entitlements";

export interface AppChooserProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly firstName: string;
  readonly tierLabel: string;
  readonly tierBlurb: string;
  readonly products: readonly ProductKey[];
}

/**
 * The signed-in app chooser.
 *
 * FXU Home is the platform; this is where you pick which app to open. It uses
 * the landing's own modal styling (fxu-home.css) so it feels part of the site
 * rather than a bolted-on dashboard.
 *
 * Apps the user isn't entitled to are shown locked with how to get access —
 * hiding them makes the platform look broken rather than tiered.
 */
export function AppChooser({
  open, onClose, firstName, tierLabel, tierBlurb, products,
}: AppChooserProps) {
  const router = useRouter();

  // Escape to close + lock background scroll while open (matches the original
  // waitlist modal behaviour this replaces).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [open, onClose]);

  if (!open) return null;

  const has = (p: ProductKey) => products.includes(p);
  const eduExternal = isExternalEducation();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    onClose();
    router.refresh();
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="app-chooser-title">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-card">
        <button className="modal-x" onClick={onClose} aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <div className="modal-body">
          <h3 id="app-chooser-title">Hi {firstName} 👋</h3>
          <p className="modal-sub">
            {tierLabel ? <><strong>{tierLabel}</strong> · {tierBlurb}. </> : null}
            Pick an app to open.
          </p>

          <div className="chooser-list">
            <ChooserItem
              href="/dashboard"
              name="Trade Journal"
              desc="Log trades, review performance, spot the patterns."
              unlocked={has("journal")}
              accent="journal"
            />
            <ChooserItem
              href="/crm"
              name="Affiliate CRM"
              desc="Your affiliates, commissions and partner activity."
              unlocked={has("crm")}
              lockedNote="Included with IB access — ask an admin to upgrade you."
              accent="crm"
            />
            <ChooserItem
              href={EDUCATION_URL}
              name="Live Education"
              desc="Live, practical sessions for partner communities."
              unlocked
              external={eduExternal}
              accent="edu"
            />
            {has("admin") && (
              <ChooserItem
                href="/admin"
                name="Platform Admin"
                desc="Manage members and access levels."
                unlocked
                accent="admin"
              />
            )}
          </div>

          <button className="chooser-signout" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

interface ChooserItemProps {
  readonly href: string;
  readonly name: string;
  readonly desc: string;
  readonly unlocked: boolean;
  readonly lockedNote?: string;
  readonly external?: boolean;
  readonly accent: "journal" | "crm" | "edu" | "admin";
}

function ChooserItem({ href, name, desc, unlocked, lockedNote, external, accent }: ChooserItemProps) {
  const body = (
    <>
      <span className={`chip-icon ${accent}`} aria-hidden="true">
        {ICONS[accent]}
      </span>
      <span className="chooser-text">
        <span className="chooser-name">
          {name}
          {!unlocked && <span className="chooser-lock">Locked</span>}
        </span>
        <span className="chooser-desc">{unlocked ? desc : (lockedNote ?? desc)}</span>
      </span>
      {unlocked && <span className="chip-arrow">›</span>}
    </>
  );

  if (!unlocked) return <div className="chooser-item locked">{body}</div>;

  // Plain anchors: opening an app is a full navigation (it leaves the marketing
  // shell), and external education needs a new tab.
  return (
    <a
      className="chooser-item"
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
    >
      {body}
    </a>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  journal: (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none"><rect x="9" y="14" width="4" height="20" rx="1" fill="#fff" opacity=".55"/><rect x="22" y="20" width="4" height="14" rx="1" fill="#fff"/><rect x="35" y="10" width="4" height="24" rx="1" fill="#fff" opacity=".85"/></svg>
  ),
  crm: (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none"><circle cx="14" cy="17" r="5" fill="#fff"/><circle cx="34" cy="17" r="5" fill="#fff" opacity=".75"/><path d="M5 36c0-5 4-9 9-9s9 4 9 9v3H5v-3z" fill="#fff"/><path d="M25 36c0-5 4-9 9-9s9 4 9 9v3H25v-3z" fill="#fff" opacity=".75"/></svg>
  ),
  edu: (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none"><path d="M24 8L4 18l20 10 20-10L24 8z" fill="#fff"/><path d="M12 23v9c0 3.3 5.4 6 12 6s12-2.7 12-6v-9" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" opacity=".75"/></svg>
  ),
  admin: (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none"><path d="M24 6l14 6v10c0 9-6 16.5-14 20-8-3.5-14-11-14-20V12l14-6z" fill="#fff"/></svg>
  ),
};
