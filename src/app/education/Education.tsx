"use client";

import { useRef } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useAppleMotion } from "../_home/useAppleMotion";
import "../_home/fxu-home.css";

/**
 * Live Education page — a public marketing surface for FXU's partner-community
 * sessions. Shares the landing's design system (fxu-home.css, scoped .fxu-home).
 */
export function Education() {
  const { resolvedTheme, setTheme } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);

  useAppleMotion(rootRef);

  const isDark = resolvedTheme === "dark";

  return (
    <div className="fxu-home" ref={rootRef}>
      <header className="nav" id="nav">
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
            <Link href="/education">Live Education</Link>
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
            <Link href="/login" className="nav-signin">Sign in</Link>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="orbs" aria-hidden="true">
            <span className="orb o1" />
            <span className="orb o2" />
          </div>
          <div className="hero-inner">
            <div className="pill hero-el" style={{ ["--d" as string]: 0 }}>
              <span className="pill-dot" /> Live education
            </div>
            <h1 className="hero-el" style={{ ["--d" as string]: 1 }}>
              Trading, <span className="grad-text">taught properly.</span>
            </h1>
            <p className="hero-sub hero-el" style={{ ["--d" as string]: 2 }}>
              Live, practical sessions for FXU partner communities. No indicator
              sales, no signal hype. Just the craft, and how each concept plugs
              into the tools you already use.
            </p>
            <div className="hero-ctas hero-el" style={{ ["--d" as string]: 3 }}>
              <Link className="btn-primary" href="/login?mode=signup">
                Create your account
              </Link>
              <Link className="btn-ghost" href="/#affiliates">
                Become a partner <span className="chev">›</span>
              </Link>
            </div>
          </div>
        </section>

        <section className="section" id="curriculum">
          <div className="section-head reveal">
            <div className="kicker">The curriculum</div>
            <h2 data-split>Four pillars, taught live.</h2>
            <p>Every session is hands-on and runs with live Q&amp;A inside partner communities.</p>
          </div>
          <div className="edu-grid">
            {TOPICS.map((t, i) => (
              <div className="edu-card reveal spot" style={{ ["--d" as string]: i }} data-hue={t.hue} key={t.n}>
                <div className="edu-num">{t.n}</div>
                <h4>{t.title}</h4>
                <p>{t.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="schedule" style={{ paddingTop: 40 }}>
          <div className="section-head reveal">
            <div className="kicker">How it runs</div>
            <h2 data-split>A rhythm you can build on.</h2>
            <p>Weekly live sessions, recorded for your community, with the workbook and journal templates included.</p>
          </div>
          <div className="edu-grid">
            {CADENCE.map((c, i) => (
              <div className="edu-card reveal spot" style={{ ["--d" as string]: i }} data-hue={c.hue} key={c.when}>
                <div className="edu-num">{c.when}</div>
                <h4>{c.title}</h4>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
          <div className="edu-note reveal">
            <p>Sessions are exclusive to FXU partner communities. Join as a trader to follow along, or as a partner to host them for your own audience.</p>
          </div>
        </section>

        <section className="waitband" id="get-started">
          <div className="orbs" aria-hidden="true">
            <span className="orb o1" />
            <span className="orb o2" />
          </div>
          <div className="waitband-inner reveal">
            <div className="kicker">Get started</div>
            <h2 data-split>Learn the craft. Keep the receipts.</h2>
            <p>Create your account, journal every trade, and bring the lessons back to your own data.</p>
            <Link className="btn-primary lg" href="/login?mode=signup">Create your account</Link>
          </div>
        </section>
      </main>

      <div className="footer-outer">
        <footer className="footer">
          <span>Copyright © {new Date().getFullYear()} FXU. All rights reserved.</span>
          <span className="links">
            <Link href="/#apps">Apps</Link>
            <Link href="/#affiliates">Affiliates</Link>
            <Link href="/education">Education</Link>
          </span>
        </footer>
      </div>
    </div>
  );
}

const TOPICS: readonly { n: string; hue: string; title: string; body: string }[] = [
  { n: "01", hue: "blue", title: "Identifying patterns", body: "Read structure instead of guessing: trends, ranges, liquidity and the handful of repeatable setups worth trading." },
  { n: "02", hue: "green", title: "Risk management", body: "Position sizing, risk-reward and drawdown control, and making the numbers work before every entry." },
  { n: "03", hue: "orange", title: "Trading psychology", body: "Discipline over dopamine: handling losing streaks, avoiding revenge trades, and rules you can actually follow." },
  { n: "04", hue: "purple", title: "Review & journaling", body: "Turn your own entries into an edge. Tag setups, review sessions, and let the patterns surface." },
];

const CADENCE: readonly { when: string; hue: string; title: string; body: string }[] = [
  { when: "LIVE", hue: "blue", title: "Weekly live session", body: "A focused topic each week, taught live with real charts and open Q&A for the community." },
  { when: "VOD", hue: "green", title: "Recorded for later", body: "Every session is recorded and shared, so members who miss it can catch up on their own time." },
  { when: "KIT", hue: "orange", title: "Workbook & templates", body: "Each session ships with a short workbook and the journal templates that go with it." },
  { when: "Q&A", hue: "purple", title: "Ongoing support", body: "Between sessions, questions get answered inside your partner community, not left hanging." },
];
