"use client";

import { useEffect, useRef, useState } from "react";
import { STARTER_QUESTIONS } from "@/lib/assistant/knowledge";
import { APP_TARGETS } from "@/lib/assistant/mentions";

interface Turn {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly action?: { kind: string; href: string; label?: string };
  readonly suggestions?: readonly string[];
}

/**
 * The hero assistant.
 *
 * Answers product questions instantly from the curated knowledge base, and
 * routes `@trade journal …` style commands into the apps. Only a genuinely new
 * question from a signed-in user reaches the model — see /api/assistant.
 */
export function HeroAssistant({
  signedIn,
  products = [],
}: {
  signedIn: boolean;
  /** Products this user can actually open; drives the locked state in the @ menu. */
  products?: readonly string[];
}) {
  const [value, setValue] = useState("");
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [placeholder, setPlaceholder] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Typewriter placeholder — the "it's alive" cue, disabled for reduced motion.
  useEffect(() => {
    if (turns.length > 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPlaceholder("Ask about FXU, or type @ to open an app");
      return;
    }
    const lines = [
      "Ask the FXU agent: what can this suite do for me?",
      "@trade journal  log EURUSD long 2 lots at 1.0842",
      "How much rebate could my volume earn?",
      "@rebate calculator",
    ];
    let li = 0, ci = 0, deleting = false, timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const line = lines[li];
      ci = deleting ? ci - 1 : ci + 1;
      setPlaceholder(line.slice(0, ci));
      let delay = deleting ? 26 : 52;
      if (!deleting && ci === line.length) { delay = 1900; deleting = true; }
      else if (deleting && ci === 0) { deleting = false; li = (li + 1) % lines.length; delay = 320; }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [turns.length]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  // "@" alone lists everything; "@tra" narrows to Trade Journal. Matching the
  // label too means "@journal" and "@Trade Journal" both land.
  const mentionQuery = value.startsWith("@") ? value.slice(1).toLowerCase() : null;
  const mentionMatches =
    mentionQuery === null
      ? []
      : APP_TARGETS.filter(
          (t) =>
            mentionQuery === "" ||
            t.aliases.some((a) => a.startsWith(mentionQuery)) ||
            t.label.toLowerCase().startsWith(mentionQuery),
        );
  const showMentions = mentionQuery !== null && !value.includes(" ") && mentionMatches.length > 0;

  // Reset the highlight whenever the filtered set changes.
  useEffect(() => { setHighlight(0); }, [value]);

  function pickMention(target: (typeof APP_TARGETS)[number]) {
    setValue(`@${target.aliases[0]} `);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showMentions) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % mentionMatches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + mentionMatches.length) % mentionMatches.length);
    } else if (e.key === "Tab" || (e.key === "Enter" && mentionMatches[highlight])) {
      // Enter completes the mention rather than sending a bare "@tra".
      e.preventDefault();
      pickMention(mentionMatches[highlight]!);
    } else if (e.key === "Escape") {
      setValue("");
    }
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setTurns((t) => [...t, { role: "user", text: q }]);
    setValue("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        answer?: string; error?: string;
        action?: { kind: string; href: string; label?: string };
        suggestions?: string[];
      };
      setTurns((t) => [...t, {
        role: "assistant",
        text: data.answer ?? data.error ?? "Something went wrong.",
        action: data.action,
        suggestions: data.suggestions,
      }]);
    } catch {
      setTurns((t) => [...t, { role: "assistant", text: "I couldn't reach the server. Try again." }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="agent" data-open={turns.length > 0 ? "true" : "false"}>
      <div className="agent-ambient" aria-hidden="true" />

      <div className="agent-shell">
        {turns.length > 0 && (
          <div className="agent-log" ref={logRef}>
            {turns.map((t, i) => (
              <div key={i} className={`agent-turn ${t.role}`}>
                <div className="agent-bubble">
                  <Rendered text={t.text} />
                  {t.action && (
                    <a className="agent-action" href={t.action.href}>
                      {t.action.label ?? (t.action.kind === "signin" ? "Sign in" : "Open")} <span className="chev">›</span>
                    </a>
                  )}
                </div>
                {t.suggestions && t.suggestions.length > 0 && (
                  <div className="agent-chips in-log">
                    {t.suggestions.map((s) => (
                      <button key={s} className="agent-chip" onClick={() => ask(s)}>{s}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="agent-turn assistant">
                <div className="agent-bubble">
                  <span className="agent-typing"><i /><i /><i /></span>
                </div>
              </div>
            )}
          </div>
        )}

        <form
          className="agent-input"
          onSubmit={(e) => { e.preventDefault(); void ask(value); }}
        >
          <span className="agent-spark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path d="M12 2.6l1.9 5.1 5.1 1.9-5.1 1.9L12 16.6l-1.9-5.1L5 9.6l5.1-1.9L12 2.6z" fill="currentColor"/>
              <path d="M18.6 15.2l.85 2.3 2.3.85-2.3.85-.85 2.3-.85-2.3-2.3-.85 2.3-.85.85-2.3z" fill="currentColor" opacity=".65"/>
            </svg>
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder || "Ask about FXU, or type @ to open an app"}
            aria-label="Ask the FXU agent"
            onKeyDown={onKeyDown}
            enterKeyHint="send"
          />
          <button type="submit" className="agent-send" disabled={busy || !value.trim()} aria-label="Send">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

        </form>

        {turns.length === 0 && !showMentions && (
          <div className="agent-chips">
            {STARTER_QUESTIONS.map((q) => (
              <button key={q} className="agent-chip" onClick={() => ask(q)}>{q}</button>
            ))}
          </div>
        )}
      </div>

      {showMentions && (
        <div className="agent-mentions" role="listbox" aria-label="Apps">
          {mentionMatches.map((t, i) => {
            const locked = signedIn && t.product !== null && !products.includes(t.product);
            return (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`agent-mention ${i === highlight ? "on" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pickMention(t)}
              >
                <span className="agent-mention-row">
                  <strong>@{t.aliases[0]}</strong>
                  {locked && <em className="agent-mention-lock">Locked</em>}
                </span>
                <span>{locked ? "Included with IB access" : t.hint}</span>
              </button>
            );
          })}
          <p className="agent-mention-foot">
            {signedIn ? "Enter to pick, then type what you want it to do" : "Sign in to run an app"}
          </p>
        </div>
      )}

      <p className="agent-foot">
        {signedIn
          ? "Type @ to run an app · answers are product info only, never financial advice"
          : "Free to ask · answers are product info only, never financial advice"}
      </p>
    </div>
  );
}

/** Minimal **bold** rendering — the answers use it and nothing else. */
function Rendered({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>,
      )}
    </p>
  );
}
