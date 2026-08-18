"use client";

import { useEffect, useRef, useState } from "react";
import { STARTER_QUESTIONS } from "@/lib/assistant/knowledge";
import { APP_TARGETS, parseMention } from "@/lib/assistant/mentions";
import {
  FLOWS, computeFlow, nextMissingSlot, seedSlots, isSkip,
  type FlowId, type Slots, type FlowResult, type SlotDef,
} from "@/lib/assistant/flows";
import { AgentResult } from "./AgentResult";
import { useAgentDemo } from "./useAgentDemo";

interface Turn {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly action?: { kind: string; href: string; label?: string };
  readonly suggestions?: readonly string[];
  /** An inline computed answer (risk / rebate / trade draft). */
  readonly result?: FlowResult;
}

/** An in-progress conversation with one of the apps. */
interface FlowState {
  readonly id: FlowId;
  readonly slots: Slots;
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [placeholder, setPlaceholder] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [flow, setFlow] = useState<FlowState | null>(null);
  // The demo runs until the first real interaction, then never returns.
  const [live, setLive] = useState(false);
  const demo = useAgentDemo(!live, rootRef);
  const demoing = !live && demo.started;

  function goLive() {
    if (!live) setLive(true);
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Typewriter placeholder — the "it's alive" cue, disabled for reduced motion.
  useEffect(() => {
    if (turns.length > 0 || !live) return;
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

  // Bring the newest reply's TOP into view rather than slamming to the bottom:
  // a result card is taller than the viewport slice, and landing mid-card hides
  // the headline number that is the whole point.
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const last = log.lastElementChild as HTMLElement | null;
    if (!last) return;
    const target =
      last.offsetHeight > log.clientHeight - 24
        ? last.offsetTop - 12                       // tall: show its top
        : log.scrollHeight;                          // short: normal bottom
    log.scrollTo({ top: target, behavior: "smooth" });
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

  function say(text: string, extra: Partial<Turn> = {}) {
    setTurns((t) => [...t, { role: "assistant", text, ...extra }]);
  }

  /** Ask for the next missing slot, or compute if we have everything. */
  function advance(id: FlowId, slots: Slots) {
    const def = FLOWS[id];
    const missing = nextMissingSlot(def, slots);

    if (missing) {
      setFlow({ id, slots });
      say(missing.prompt, { suggestions: missing.options ?? [] });
      return;
    }

    const out = computeFlow(id, slots);
    setFlow(null);
    if ("error" in out) {
      say(out.error);
      return;
    }
    if (out.kind === "trade") {
      say("Here's the draft. Nothing is saved yet.", {
        result: out,
        action: { kind: "open", href: `/ai-chat?q=${encodeURIComponent(tradeSentence(slots))}`, label: "Open in Trade Journal to save" },
      });
      return;
    }
    say(
      out.kind === "risk"
        ? "Here's your position size."
        : "Here's what that volume is worth.",
      { result: out, suggestions: ["Start over"] },
    );
  }

  function startFlow(id: FlowId, rest: string) {
    const def = FLOWS[id];
    const seeded = seedSlots(def, rest);
    say(def.intro);
    advance(id, seeded);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    goLive();
    setTurns((t) => [...t, { role: "user", text: q }]);
    setValue("");

    if (/^start over$/i.test(q)) {
      setFlow(null);
      say("Fresh start. Ask me anything, or type @ to run an app.");
      return;
    }

    // A fresh @mention always wins, even mid-conversation: someone typing
    // "@risk calculator" while half-way through another flow means switch, not
    // "here's my answer".
    const switching = /^@/.test(q);

    // 1. Mid-conversation: treat the message as the answer to the pending slot.
    if (flow && !switching) {
      const def = FLOWS[flow.id];
      const slot = nextMissingSlot(def, flow.slots) as SlotDef | null;
      if (slot) {
        if (slot.optional && isSkip(q)) {
          advance(flow.id, { ...flow.slots, [slot.key]: "skip" });
          return;
        }
        const problem = slot.validate?.(q, flow.slots);
        if (problem) {
          say(problem, { suggestions: slot.options ?? [] });
          return;
        }
        advance(flow.id, { ...flow.slots, [slot.key]: q });
        return;
      }
    }

    // 2. An @mention that maps to an operable flow runs it here rather than
    //    sending the user off to another page.
    //
    //    Use the SHARED parser, not a local regex: aliases contain spaces, so a
    //    lazy pattern captured "trade" out of "@trade journal ..." and matched
    //    nothing, which silently fell through to the link-out path. parseMention
    //    tries the longest alias first, which is the only correct way here.
    const mention = parseMention(q);
    if (mention) {
      const { target, instruction } = mention;
      const locked = signedIn && target.product !== null && !products.includes(target.product);

      if (!locked) {
        if (target.id === "risk") { startFlow("risk", instruction); return; }
        if (target.id === "rebate") { startFlow("rebate", instruction); return; }
        // Any hint of logging something starts the draft; a bare "@trade
        // journal" still just opens the app.
        if (target.id === "journal" && /\b(add|log|record|new|enter|book)\b/i.test(instruction)) {
          startFlow("trade", instruction); return;
        }
      }
    }

    // 3. Anything else goes to the server (knowledge base, cache, then model).
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
      say(data.answer ?? data.error ?? "Something went wrong.", {
        action: data.action,
        suggestions: data.suggestions,
      });
    } catch {
      say("I couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="agent" ref={rootRef} data-open={turns.length > 0 || demoing ? "true" : "false"}>
      <div className="agent-ambient" aria-hidden="true" />

      <div className="agent-shell">
        {demoing && (
          <div className="agent-log agent-log-demo" aria-hidden="true">
            {demo.sent && (
              <div className="agent-turn user">
                <div className="agent-bubble">
                  <p>{demo.query}</p>
                </div>
              </div>
            )}
            {demo.thinking && (
              <div className="agent-turn assistant">
                <div className="agent-bubble">
                  <span className="agent-typing"><i /><i /><i /></span>
                </div>
              </div>
            )}
            {demo.reply && (
              <div className="agent-turn assistant">
                <div className="agent-bubble">
                  <p>{demo.reply}</p>
                  {demo.result && <AgentResult result={demo.result} />}
                </div>
              </div>
            )}
          </div>
        )}

        {turns.length > 0 && (
          <div className="agent-log" ref={logRef}>
            {turns.map((t, i) => (
              <div key={i} className={`agent-turn ${t.role}`}>
                <div className="agent-bubble">
                  <Rendered text={t.text} />
                  {t.result && <AgentResult result={t.result} />}
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
            value={live ? value : demo.typed}
            onFocus={goLive}
            onChange={(e) => { goLive(); setValue(e.target.value); }}
            placeholder={live ? (placeholder || "Ask about FXU, or type @ to open an app") : "Ask about FXU, or type @ to open an app"}
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

        {live && turns.length === 0 && !showMentions && (
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

/** Rebuild a plain-English trade so the journal's own parser can log it. */
function tradeSentence(s: Slots): string {
  const bits = [
    `${s.direction} ${s.lots} lots ${s.instrument}`,
    `at ${s.entry}`,
    s.stop && !isSkip(s.stop) ? `stop ${s.stop}` : "",
    s.target && !isSkip(s.target) ? `target ${s.target}` : "",
  ];
  return bits.filter(Boolean).join(" ");
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
