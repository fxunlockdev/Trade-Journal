"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "next-themes";
import { EDUCATION_URL, isExternalEducation } from "@/lib/education-url";
import { useAppleMotion } from "./useAppleMotion";
import { AppChooser } from "./AppChooser";
import type { ProductKey } from "@/lib/auth/entitlements";
import "./fxu-home.css";

/**
 * FXU Home landing — the public face of the platform.
 *
 * A faithful port of the standalone FXNUHOME marketing site: same structure,
 * copy, device screenshots and Apple-style scroll choreography (see
 * useAppleMotion). The only product change is that the Risk Calculator is gone
 * — everything else matches the original.
 *
 * Wiring differences from the static site (behaviour, not design):
 *  - CTAs point at the real in-app SSO (/login) instead of external Vercel apps
 *    and the old GitHub-issues waitlist.
 *  - Dark mode is driven by next-themes, not localStorage.
 *  - Live Education points at EDUCATION_URL (external when configured).
 */
export interface HomeUser {
  readonly firstName: string;
  readonly products: readonly ProductKey[];
  readonly tierLabel: string;
  readonly tierBlurb: string;
}

export function Landing({ user = null }: { user?: HomeUser | null }) {
  const { resolvedTheme, setTheme } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  useAppleMotion(rootRef);

  const [chooserOpen, setChooserOpen] = useState(false);

  const isDark = resolvedTheme === "dark";
  const eduExternal = isExternalEducation();
  const signedIn = user !== null;

  // Signed in: every app entry point opens the chooser (you stay on FXU Home
  // and pick an app). Signed out: it takes you to the single sign-in.
  const openApps = (e: React.MouseEvent) => {
    if (!signedIn) return; // let the <Link href="/login"> do its job
    e.preventDefault();
    setChooserOpen(true);
  };
  const appHref = signedIn ? "#" : "/login";

  return (
    <div className="fxu-home" ref={rootRef}>
      {/* ══ Nav ══ */}
      <header className="nav" id="nav">
        <div className="nav-inner">
          <a className="nav-brand" href="#top" aria-label="FXU home">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect width="24" height="24" rx="6" className="logo-bg" />
              <path d="M7 7h10M7 12h7M7 17h4" className="logo-fg" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <span>FXU</span>
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a href="#apps">Apps</a>
            <a href="#affiliates">For Affiliates</a>
            <a
              href={EDUCATION_URL}
              {...(eduExternal ? { target: "_blank", rel: "noopener" } : {})}
            >
              Live Education
            </a>
          </nav>
          <div className="nav-right">
            <button
              className="icon-btn"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              aria-label="Toggle dark mode"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="M12 8.5A5 5 0 1 1 6.5 3 4 4 0 0 0 12 8.5z" fill="currentColor" />
              </svg>
            </button>
            {signedIn ? (
              <button className="nav-user" onClick={() => setChooserOpen(true)}>
                <span className="nav-user-dot" />
                Hi {user.firstName}
              </button>
            ) : (
              <Link href="/login" className="nav-signin">Sign in</Link>
            )}
          </div>
        </div>
      </header>

      <main id="top">
        {/* ══ Hero ══ */}
        <section className="hero">
          <div className="orbs" aria-hidden="true">
            <span className="orb o1" /><span className="orb o2" /><span className="orb o3" />
          </div>
          <div className="hero-inner">
            <div className="pill hero-el" style={{ ["--d" as string]: 0 }}>
              <span className="pill-dot" /> The FXU app suite
            </div>
            <h1 className="hero-el" style={{ ["--d" as string]: 1 }}>
              The toolkit for<br /><span className="grad-text">serious traders.</span>
            </h1>
            <p className="hero-sub hero-el" style={{ ["--d" as string]: 2 }}>
              Journal every trade. Track every partner. Grow every partnership.<br className="bp" />
              Two apps and a community, built for the way you actually work.
            </p>
            <div className="hero-ctas hero-el" style={{ ["--d" as string]: 3 }}>
              <a className="btn-primary" href="#apps" onClick={openApps}>Explore the apps</a>
              <Link className="btn-ghost" href={appHref} onClick={openApps}>{signedIn ? "Open an app" : "Sign in"} <span className="chev">›</span></Link>
            </div>

            {/* FX ticker marquee */}
            <div className="ticker hero-el" style={{ ["--d" as string]: 4 }} aria-hidden="true">
              <div className="ticker-track">
                {TICKER.concat(TICKER).map((t, i) => (
                  <span className="tick-item" key={i}>
                    {t.sym} <b className={t.up ? "up" : "down"}>{t.up ? "▲" : "▼"} {t.px}</b>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="hero-shot hero-el" style={{ ["--d" as string]: 5 }}>
            <div className="device tilt" data-tilt data-hero>
              <div className="device-bar">
                <span /><span /><span />
                <div className="device-url">trade-journal.fxu</div>
              </div>
              <Image
                src="/trade-journal.png"
                alt="FXU Trade Journal dashboard showing P&L, win rate and equity curve"
                width={2454}
                height={1662}
                priority
              />
            </div>
            <div className="hero-glow" aria-hidden="true" />
          </div>
        </section>

        {/* ══ Apps intro ══ */}
        <section className="section" id="apps">
          <div className="section-head reveal">
            <div className="kicker">The apps</div>
            <h2 data-split>Two apps. One workflow.</h2>
            <p>
              Everything talks the same language. Sign in once and move between journal and
              partnerships without missing a beat. And when you&apos;re ready to level up, join a
              live session.
            </p>
          </div>

          {/* Quick switcher tiles */}
          <div className="app-row">
            <Link className="chip-tile reveal" style={{ ["--d" as string]: 0 }} href={appHref} onClick={openApps}>
              <span className="chip-icon journal" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 48 48" fill="none"><rect x="9" y="14" width="4" height="20" rx="1" fill="#fff" opacity=".55"/><rect x="22" y="20" width="4" height="14" rx="1" fill="#fff"/><rect x="35" y="10" width="4" height="24" rx="1" fill="#fff" opacity=".85"/></svg>
              </span>
              <span className="chip-name">Trade Journal</span>
              <span className="chip-arrow">›</span>
            </Link>
            <Link className="chip-tile reveal" style={{ ["--d" as string]: 1 }} href={appHref} onClick={openApps}>
              <span className="chip-icon crm" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 48 48" fill="none"><circle cx="14" cy="17" r="5" fill="#fff"/><circle cx="34" cy="17" r="5" fill="#fff" opacity=".75"/><path d="M5 36c0-5 4-9 9-9s9 4 9 9v3H5v-3z" fill="#fff"/><path d="M25 36c0-5 4-9 9-9s9 4 9 9v3H25v-3z" fill="#fff" opacity=".75"/></svg>
              </span>
              <span className="chip-name">Affiliate CRM</span>
              <span className="chip-arrow">›</span>
            </Link>
            <a
              className="chip-tile reveal"
              style={{ ["--d" as string]: 2 }}
              href={EDUCATION_URL}
              {...(eduExternal ? { target: "_blank", rel: "noopener" } : {})}
            >
              <span className="chip-icon edu" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 48 48" fill="none"><path d="M24 8L4 18l20 10 20-10L24 8z" fill="#fff"/><path d="M12 23v9c0 3.3 5.4 6 12 6s12-2.7 12-6v-9" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" opacity=".75"/></svg>
              </span>
              <span className="chip-name">Live Education</span>
              <span className="chip-arrow">›</span>
            </a>
          </div>

          {/* ── Trade Journal feature ── */}
          <article className="feature" data-accent="ink">
            <div className="feature-copy reveal">
              <div className="kicker">Trade Journal</div>
              <h3 data-split>Every trade, examined.</h3>
              <p>
                Log positions, tag setups and let the patterns surface. Your equity curve, win
                rate and drawdown are always one glance away.
              </p>
              <ul className="feature-list">
                <li>P&amp;L, win rate, profit factor &amp; max drawdown</li>
                <li>Filters for range, direction and asset, forex or crypto</li>
                <li>AI insights, signals and a built-in risk calc</li>
              </ul>
              <Link className="text-link" href={signedIn ? "/dashboard" : "/login"} prefetch={false}>Open Trade Journal <span className="chev">›</span></Link>
            </div>
            <div className="feature-shot reveal">
              <div className="device tilt" data-tilt>
                <div className="device-bar"><span /><span /><span /><div className="device-url">trade-journal.fxu</div></div>
                <Image src="/trade-journal.png" alt="Trade Journal dashboard" width={2454} height={1662} loading="lazy" />
              </div>
            </div>
          </article>

          {/* ── Affiliate CRM feature ── */}
          <article className="feature flip" data-accent="blue">
            <div className="feature-copy reveal">
              <div className="kicker crm-k">Affiliate CRM</div>
              <h3 data-split>Partnerships, under control.</h3>
              <p>
                Built for introducing brokers. Track every affiliate from lead to active, log
                commissions monthly, and see who is actually trading.
              </p>
              <ul className="feature-list">
                <li>Affiliates with status, terms &amp; joining dates</li>
                <li>Commission ledger: pending, paid and cancelled</li>
                <li>See which of your affiliates are active in the app</li>
              </ul>
              <Link className="text-link" href={signedIn ? "/crm" : "/login"} prefetch={false}>Open Affiliate CRM <span className="chev">›</span></Link>
            </div>
            <div className="feature-shot reveal">
              <div className="device tilt" data-tilt>
                <div className="device-bar"><span /><span /><span /><div className="device-url">affiliate-crm.fxu</div></div>
                <Image src="/affiliate-crm.png" alt="Affiliate CRM dashboard" width={2940} height={1662} loading="lazy" />
              </div>
            </div>
          </article>
        </section>

        {/* ══ For affiliates (dark band) ══ */}
        <section className="dark-band" id="affiliates">
          <div className="dark-inner">
            <div className="section-head light reveal">
              <div className="kicker">For affiliates &amp; IBs</div>
              <h2 data-split>You bring the community. We bring everything else.</h2>
              <p>
                We sit in the middle of the FX ecosystem, matching educators, creators and
                introducing brokers with the right regulated brokers, then backing them with
                software and support.
              </p>
            </div>
            <div className="bento">
              <div className="bento-card wide reveal spot" style={{ ["--d" as string]: 0 }}>
                <div className="bento-icon grad-blue" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" fill="#fff"/><rect x="13" y="3" width="8" height="8" rx="2" fill="#fff" opacity=".7"/><rect x="3" y="13" width="8" height="8" rx="2" fill="#fff" opacity=".7"/><rect x="13" y="13" width="8" height="8" rx="2" fill="#fff" opacity=".4"/></svg>
                </div>
                <h4>The full software suite</h4>
                <p>Trade Journal and Affiliate CRM, for you and your whole community. Professional tooling your members would otherwise pay for, included in the partnership.</p>
              </div>
              <div className="bento-card reveal spot" style={{ ["--d" as string]: 1 }}>
                <div className="bento-icon grad-purple" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3a7 7 0 0 1 7 7c0 2.5-1.4 4.4-3 5.6V18a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-2.4c-1.6-1.2-3-3.1-3-5.6a7 7 0 0 1 7-7z" fill="#fff"/><rect x="9" y="20.5" width="6" height="1.8" rx=".9" fill="#fff" opacity=".7"/></svg>
                </div>
                <h4>Community support</h4>
                <p>Help running and engaging your trading community: content, live sessions and answers when your members need them.</p>
              </div>
              <div className="bento-card reveal spot" style={{ ["--d" as string]: 2 }}>
                <div className="bento-icon grad-cyan" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6" stroke="#fff" strokeWidth="2.4"/><path d="M15.5 15.5 21 21" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/></svg>
                </div>
                <h4>Guidance &amp; research</h4>
                <p>Market research and best-practice guidance for your channels, so what you publish is sharp, current and credible.</p>
              </div>
              <div className="bento-card wide reveal spot" style={{ ["--d" as string]: 3 }}>
                <div className="bento-icon grad-green" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 12l5 5L20 6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <h4>Fair, transparent partnerships</h4>
                <p>We match you with regulated brokers on terms that reflect the true value of your audience, with payouts you can actually track in your own CRM.</p>
              </div>
            </div>
            <div className="dark-cta reveal">
              <Link className="btn-light" href={appHref} onClick={openApps}>Become a partner</Link>
              <span className="dark-cta-note">Educators · Content creators · Introducing brokers</span>
            </div>
          </div>
        </section>

        {/* ══ Education ══ */}
        <section className="section" id="education">
          <div className="section-head reveal">
            <div className="kicker">Education</div>
            <h2 data-split>Sessions that make you a better trader.</h2>
            <p>
              Live, practical sessions for our partner communities. No indicator sales, no signal
              hype. Just the craft of trading, taught properly.
            </p>
          </div>
          <div className="edu-grid">
            {EDU.map((e, i) => (
              <div className="edu-card reveal spot" style={{ ["--d" as string]: i }} data-hue={e.hue} key={e.n}>
                <div className="edu-num">{e.n}</div>
                <h4>{e.title}</h4>
                <p>{e.body}</p>
              </div>
            ))}
          </div>
          <div className="edu-note reveal">
            <p>Sessions run live with Q&amp;A inside partner communities, and every concept plugs straight into the FXU apps you already use.</p>
            <a
              className="text-link"
              href={EDUCATION_URL}
              style={{ marginTop: 14, display: "inline-flex" }}
              {...(eduExternal ? { target: "_blank", rel: "noopener" } : {})}
            >
              See the live sessions &amp; schedule <span className="chev">›</span>
            </a>
          </div>
        </section>

        {/* ══ Get started band ══ */}
        <section className="waitband" id="get-started">
          <div className="orbs" aria-hidden="true">
            <span className="orb o1" /><span className="orb o2" />
          </div>
          <div className="waitband-inner reveal">
            <div className="kicker">Get started</div>
            <h2 data-split>Your trading, in one place.</h2>
            <p>One account for the journal and your partnerships. Sign in and pick up where you left off.</p>
            <Link className="btn-primary lg" href={appHref} onClick={openApps}>{signedIn ? "Open an app" : "Sign in to FXU"}</Link>
          </div>
        </section>
      </main>

      {/* ══ Footer ══ */}
      {signedIn && (
        <AppChooser
          open={chooserOpen}
          onClose={() => setChooserOpen(false)}
          firstName={user.firstName}
          tierLabel={user.tierLabel}
          tierBlurb={user.tierBlurb}
          products={user.products}
        />
      )}

      <div className="footer-outer">
        <footer className="footer">
          <span>Copyright © {new Date().getFullYear()} FXU. All rights reserved.</span>
          <span className="links">
            <a href="#apps">Apps</a>
            <a href="#affiliates">Affiliates</a>
            <a href="#education">Education</a>
          </span>
        </footer>
      </div>
    </div>
  );
}

const TICKER: readonly { sym: string; px: string; up: boolean }[] = [
  { sym: "EURUSD", px: "1.0842", up: true },
  { sym: "GBPUSD", px: "1.2704", up: false },
  { sym: "USDJPY", px: "156.20", up: true },
  { sym: "XAUUSD", px: "2,388.4", up: true },
  { sym: "BTCUSD", px: "96,410", up: true },
  { sym: "US30", px: "42,116", up: false },
  { sym: "EURCHF", px: "0.9752", up: true },
  { sym: "NAS100", px: "21,904", up: true },
];

const EDU: readonly { n: string; hue: string; title: string; body: string }[] = [
  { n: "01", hue: "blue", title: "Identifying patterns", body: "Read structure instead of guessing: trends, ranges, liquidity and the handful of repeatable setups worth trading. Learn to see what the chart is actually telling you." },
  { n: "02", hue: "green", title: "Risk management", body: "The part that keeps you in the game. Position sizing, risk-reward, drawdown control, plus how to make the built-in calculators do the math before every entry." },
  { n: "03", hue: "orange", title: "Trading psychology", body: "Discipline over dopamine. Handling losing streaks, avoiding revenge trades, and building rules you can actually follow when it matters." },
  { n: "04", hue: "purple", title: "Review & journaling", body: "Your own data is your best teacher. Journal every trade, tag your setups, then review sessions turn those entries into your edge." },
];
