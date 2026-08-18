"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { computeFlow, seedSlots, FLOWS, type FlowResult } from "@/lib/assistant/flows";

/**
 * The hero's self-playing demo.
 *
 * Shows the agent doing real work before anyone types: a query types itself,
 * the agent thinks, a result card lands, it holds, then the next scenario.
 *
 * The numbers are NOT mocked. Each scenario runs the same seedSlots + computeFlow
 * the live agent runs, so the demo can never drift from the product. If the
 * rebate rates change, the demo changes with them.
 *
 * It yields the moment someone interacts, and never comes back.
 */

export interface DemoFrame {
  /** True from the first frame onward, so the layout settles once. */
  readonly started: boolean;
  readonly typed: string;
  /** The full query, kept after sending so the user bubble can show it. */
  readonly query: string;
  readonly sent: boolean;
  readonly thinking: boolean;
  readonly reply: string | null;
  readonly result: FlowResult | null;
}

const SCENARIOS = [
  {
    flow: "rebate" as const,
    query: "@rebate calculator gold, 100 lots a month",
    reply: "Here's what that volume is worth.",
  },
  {
    flow: "risk" as const,
    query: "@risk calculator XAUUSD buy, 25k account, 1% risk, entry 2388, stop 2380",
    reply: "Here's your position size.",
  },
];

const EMPTY: DemoFrame = { started: false, typed: "", query: "", sent: false, thinking: false, reply: null, result: null };

/** Precomputed once: same functions the live agent uses. */
const FRAMES = SCENARIOS.map((s) => {
  const slots = seedSlots(FLOWS[s.flow], s.query);
  const out = computeFlow(s.flow, slots);
  return { ...s, result: "kind" in out ? out : null };
}).filter((s) => s.result !== null);

export function useAgentDemo(enabled: boolean, hostRef?: React.RefObject<HTMLElement | null>) {
  const [frame, setFrame] = useState<DemoFrame>(EMPTY);
  const [visible, setVisible] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Only run while the hero is actually on screen. Scrolled away, the loop is
  // pure cost: it burns timers and any reflow it causes yanks the page under
  // the reader.
  useEffect(() => {
    const el = hostRef?.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? true),
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hostRef]);

  useEffect(() => {
    if (!enabled || !visible || FRAMES.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Reduced motion: show the finished frame, no typing, no cycling.
      const f = FRAMES[0]!;
      setFrame({ started: true, typed: f.query, query: f.query, sent: true, thinking: false, reply: f.reply, result: f.result });
      return;
    }

    let cancelled = false;
    const at = (ms: number, fn: () => void) => {
      timers.current.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
    };

    function play(i: number) {
      const s = FRAMES[i % FRAMES.length]!;
      let t = 0;

      // Deliberately no blank frame here: clearing to EMPTY between scenarios
      // collapsed the shell and bounced the hero. The first typed character
      // replaces the previous answer instead.

      // Type it out.
      for (let c = 1; c <= s.query.length; c++) {
        t += c < 12 ? 34 : 21; // eases off after the mention
        at(t, () => setFrame({ ...EMPTY, started: true, typed: s.query.slice(0, c), query: s.query }));
      }

      t += 520;
      at(t, () => setFrame({ started: true, typed: "", query: s.query, sent: true, thinking: true, reply: null, result: null }));

      t += 900;
      at(t, () => setFrame({ started: true, typed: "", query: s.query, sent: true, thinking: false, reply: s.reply, result: s.result }));

      t += 5200; // dwell on the answer
      at(t, () => play(i + 1));
    }

    const start = setTimeout(() => play(0), 1400);
    timers.current.push(start);

    return () => {
      cancelled = true;
      for (const id of timers.current) clearTimeout(id);
      timers.current = [];
    };
  }, [enabled, visible]);

  return frame;
}
