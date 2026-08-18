"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  ASSET_RATES, RATES_ARE_ILLUSTRATIVE, isConfirmedRate, estimateRebate, formatUsd, rateFor, type AssetClass,
} from "@/lib/rebate/rates";
import "../_home/fxu-home.css";

/**
 * Rebate Calculator — a free tool for IBs, and our lead capture.
 *
 * The estimate is computed live as you move the inputs (nothing hidden behind
 * the form). Unlocking reveals the full breakdown — per-lot rates, annual
 * projection, next steps — in exchange for name/email/phone, which is the point
 * of the tool. Submission goes through capture_rebate_lead(), a definer function
 * that validates and appends; the browser can never read the lead list back.
 */
export function RebateCalculator() {
  const { resolvedTheme, setTheme } = useTheme();
  const [asset, setAsset] = useState<AssetClass>("gold");
  const [lots, setLots] = useState(100);
  const [unlocked, setUnlocked] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const est = useMemo(() => estimateRebate(asset, lots), [asset, lots]);
  const rate = rateFor(asset);
  const isDark = resolvedTheme === "dark";

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/rebate/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name, email, phone,
          assetClass: asset,
          monthlyLots: lots,
          estimatedRebate: Math.round(est.monthlyMid),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not save your details.");
        return;
      }
      setUnlocked(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fxu-home">
      <header className="nav">
        <div className="nav-inner">
          <Link className="nav-brand" href="/" aria-label="FXU home">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect width="24" height="24" rx="6" className="logo-bg" />
              <path d="M7 7h10M7 12h7M7 17h4" className="logo-fg" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <span>FXU Apps</span>
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/#apps">Apps</Link>
            <Link href="/#affiliates">For Affiliates</Link>
          </nav>
          <div className="nav-right">
            <button className="icon-btn" onClick={() => setTheme(isDark ? "light" : "dark")} aria-label="Toggle dark mode">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="M12 8.5A5 5 0 1 1 6.5 3 4 4 0 0 0 12 8.5z" fill="currentColor" />
              </svg>
            </button>
            <Link href="/login" className="nav-signin">Sign in</Link>
          </div>
        </div>
      </header>

      <main className="rc-page">
        <div className="orbs" aria-hidden="true">
          <span className="orb o1" /><span className="orb o2" />
        </div>

        <div className="rc-inner">
          <div className="kicker">Free tool for IBs</div>
          <h1 className="rc-title">What is your volume <span className="grad-text">actually worth?</span></h1>
          <p className="rc-sub">
            Estimate the monthly rebate on the flow you already introduce. Move the sliders and the
            numbers update as you go.
          </p>

          <div className="rc-grid">
            {/* Inputs */}
            <section className="rc-card">
              <label className="rc-field">
                <span className="rc-label">Assets traded</span>
                <div className="rc-assets">
                  {ASSET_RATES.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      className={`rc-asset ${asset === a.key ? "on" : ""}`}
                      onClick={() => setAsset(a.key)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <p className="rc-note">
                  {rate.note}
                  {!isConfirmedRate(asset) && " Indicative rate, confirmed with FXU before you sign."}
                </p>
              </label>

              <label className="rc-field">
                <span className="rc-label">
                  Volume per month
                  <strong>{lots.toLocaleString()} lots</strong>
                </span>
                <input
                  type="range" min={0} max={2000} step={10}
                  value={lots}
                  onChange={(e) => setLots(Number(e.target.value))}
                  className="rc-range"
                  aria-label="Monthly volume in lots"
                />
                <div className="rc-range-scale"><span>0</span><span>1,000</span><span>2,000+</span></div>
                <input
                  type="number" min={0} max={1000000} value={lots}
                  onChange={(e) => setLots(Math.max(0, Math.min(1000000, Number(e.target.value) || 0)))}
                  className="rc-number"
                  aria-label="Monthly volume, exact"
                />
              </label>
            </section>

            {/* Result */}
            <section className="rc-card rc-result">
              <div className="rc-result-label">Estimated monthly rebate</div>
              <div className="rc-amount">{formatUsd(est.monthlyMid)}</div>
              <div className="rc-range-text">
                {formatUsd(est.monthlyLow)} – {formatUsd(est.monthlyHigh)} depending on terms
              </div>

              {unlocked ? (
                <div className="rc-unlocked">
                  <dl className="rc-breakdown">
                    <div><dt>Per-lot rebate</dt><dd>${est.perLotLow} – ${est.perLotHigh}</dd></div>
                    <div><dt>Monthly volume</dt><dd>{lots.toLocaleString()} lots</dd></div>
                    <div><dt>Annual projection</dt><dd>{formatUsd(est.annualMid)}</dd></div>
                  </dl>
                  <p className="rc-done">
                    Thanks. We&apos;ll be in touch with your real terms. Meanwhile, your FXU account is
                    free and includes the Trade Journal.
                  </p>
                  <Link className="btn-primary full" href="/login?mode=signup">Create your free account</Link>
                </div>
              ) : (
                <form className="rc-gate" onSubmit={unlock}>
                  <p className="rc-gate-copy">
                    Unlock the full breakdown: per-lot rates, annual projection and next steps.
                  </p>
                  <input className="rc-input" placeholder="Full name" value={name}
                    onChange={(e) => setName(e.target.value)} autoComplete="name" required />
                  <input className="rc-input" type="email" placeholder="Email" value={email}
                    onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
                  <input className="rc-input" placeholder="Phone" value={phone}
                    onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
                  {error && <p className="rc-error">{error}</p>}
                  <button className="btn-primary full" disabled={saving}>
                    {saving ? "Unlocking…" : "Unlock full breakdown"}
                  </button>
                  <p className="rc-privacy">We use this to send your terms. No spam, no resale.</p>
                </form>
              )}
            </section>
          </div>

          <p className="rc-disclaimer">
            Estimates, not an offer or a guarantee of earnings. Your actual rebate depends on the
            broker, instrument, account type and your agreement with FXU.
            {RATES_ARE_ILLUSTRATIVE &&
              " Gold is a confirmed FXU rate; the other asset classes show indicative industry ranges until yours are set."}
          </p>
        </div>
      </main>

      <div className="footer-outer">
        <footer className="footer">
          <span>Copyright © {new Date().getFullYear()} FXU. All rights reserved.</span>
          <span className="links"><Link href="/#apps">Apps</Link><Link href="/#affiliates">Affiliates</Link></span>
        </footer>
      </div>
    </div>
  );
}
