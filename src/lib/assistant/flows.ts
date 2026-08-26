import { computeAutoSize } from "@/lib/trades/auto-size";
import { estimateRebate, rateFor, type AssetClass } from "@/lib/rebate/rates";
import type { AccountCurrency, TradeDirection } from "@/types/database";

/**
 * Conversational flows for the FXU agent.
 *
 * "@risk calculator" shouldn't bounce you to another page; it should ask for
 * what it needs and answer. Each flow declares its slots, the agent asks for the
 * missing ones in order, and the result is computed the moment the last one
 * lands.
 *
 * The calculators run ENTIRELY in the browser using the same pure functions the
 * full pages use (computeAutoSize wraps the lot-size math; estimateRebate backs
 * the rebate page). That means instant answers, no round-trip, no token cost,
 * and no chance of the agent and the page disagreeing.
 *
 * Logging a trade is different: it writes data, so the flow drafts it and the
 * user confirms before anything is saved.
 */

export type FlowId = "risk" | "rebate" | "trade";

export type SlotKind = "text" | "number" | "choice";

export interface SlotDef {
  readonly key: string;
  readonly kind: SlotKind;
  /** What the agent asks when this slot is missing. */
  readonly prompt: string;
  /** Tappable answers, for choice slots and as hints on others. */
  readonly options?: readonly string[];
  readonly optional?: boolean;
  /** Rejects a value with a reason; undefined means accepted. */
  readonly validate?: (v: string, slots: Slots) => string | undefined;
}

export type Slots = Readonly<Record<string, string>>;

export interface FlowDef {
  readonly id: FlowId;
  readonly label: string;
  readonly intro: string;
  readonly slots: readonly SlotDef[];
}

const DIRECTIONS = ["buy", "sell"] as const;
const ASSETS = ["gold", "forex", "crypto", "mixed"] as const;

/** Parse, or null when it isn't a usable number. */
function numOrNull(v: string | undefined): number | null {
  if (v === undefined || isSkip(v)) return null;
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}

function num(v: string): number {
  // Tolerates "1,000", "$10k", "1.0850", "2%".
  const cleaned = v.replace(/[$,%\s]/g, "").toLowerCase();
  const k = cleaned.endsWith("k");
  const n = Number(k ? cleaned.slice(0, -1) : cleaned);
  return k ? n * 1000 : n;
}

const positive = (label: string) => (v: string) =>
  Number.isFinite(num(v)) && num(v) > 0 ? undefined : `${label} needs to be a number above zero.`;

export const FLOWS: Readonly<Record<FlowId, FlowDef>> = {
  risk: {
    id: "risk",
    label: "Risk Calculator",
    intro: "Let's size it properly. A few quick things:",
    slots: [
      { key: "instrument", kind: "text", prompt: "Which instrument?", options: ["EURUSD", "XAUUSD", "GBPUSD", "BTCUSD"] },
      { key: "direction", kind: "choice", prompt: "Buy or sell?", options: ["buy", "sell"],
        validate: (v) => (DIRECTIONS.includes(v.toLowerCase() as never) ? undefined : "Say buy or sell.") },
      { key: "balance", kind: "number", prompt: "Account balance?", options: ["5000", "10000", "25000"], validate: positive("Balance") },
      { key: "risk", kind: "number", prompt: "Risk per trade, in percent?", options: ["0.5", "1", "2"],
        validate: (v) => {
          const n = num(v);
          if (!Number.isFinite(n) || n <= 0) return "Risk needs to be a number above zero.";
          return n > 10 ? "That's above 10%. Type a smaller number." : undefined;
        } },
      { key: "entry", kind: "number", prompt: "Entry price?", validate: positive("Entry") },
      { key: "stop", kind: "number", prompt: "Stop loss price?",
        validate: (v, s) => {
          const stop = num(v), entry = num(s.entry ?? "");
          if (!Number.isFinite(stop) || stop <= 0) return "Stop needs to be a number above zero.";
          if (!Number.isFinite(entry)) return undefined;
          if (stop === entry) return "Stop can't equal entry.";
          const dir = (s.direction ?? "buy").toLowerCase();
          if (dir === "buy" && stop > entry) return "For a buy, the stop sits below entry.";
          if (dir === "sell" && stop < entry) return "For a sell, the stop sits above entry.";
          return undefined;
        } },
    ],
  },
  rebate: {
    id: "rebate",
    label: "Rebate Calculator",
    intro: "Let's see what your flow is worth:",
    slots: [
      { key: "asset", kind: "choice", prompt: "Which assets do your clients mostly trade?",
        options: ["gold", "forex", "crypto", "mixed"],
        validate: (v) => (ASSETS.includes(v.toLowerCase() as never) ? undefined : "Pick gold, forex, crypto or mixed.") },
      { key: "lots", kind: "number", prompt: "Monthly volume, in lots?", options: ["50", "100", "500"], validate: positive("Volume") },
    ],
  },
  trade: {
    id: "trade",
    label: "Trade Journal",
    intro: "I'll draft the entry. Nothing saves until you confirm.",
    slots: [
      { key: "instrument", kind: "text", prompt: "Which instrument?", options: ["EURUSD", "XAUUSD", "GBPUSD", "BTCUSD"] },
      { key: "direction", kind: "choice", prompt: "Buy or sell?", options: ["buy", "sell"],
        validate: (v) => (DIRECTIONS.includes(v.toLowerCase() as never) ? undefined : "Say buy or sell.") },
      { key: "entry", kind: "number", prompt: "Entry price?", validate: positive("Entry") },
      { key: "lots", kind: "number", prompt: "Size, in lots?", options: ["0.1", "0.5", "1"], validate: positive("Size") },
      // Optional, but still validated: a typo must be caught here rather than
      // silently becoming NaN in the draft.
      { key: "stop", kind: "number", prompt: "Stop loss? (or say skip)", optional: true,
        validate: (v) => (isSkip(v) || Number.isFinite(num(v)) ? undefined : "That doesn't look like a price. Give me a number, or say skip.") },
      { key: "target", kind: "number", prompt: "Take profit? (or say skip)", optional: true,
        validate: (v) => (isSkip(v) || Number.isFinite(num(v)) ? undefined : "That doesn't look like a price. Give me a number, or say skip.") },
    ],
  },
};

/** True when the user is waving the slot away. */
export function isSkip(v: string): boolean {
  return /^(skip|none|no|n\/a|-)$/i.test(v.trim());
}

export function nextMissingSlot(flow: FlowDef, slots: Slots): SlotDef | null {
  for (const s of flow.slots) {
    const v = slots[s.key];
    if (v === undefined || v === "") return s;
  }
  return null;
}

/* ── Results ────────────────────────────────────────────── */

export interface RiskResult {
  readonly kind: "risk";
  readonly instrument: string;
  readonly direction: string;
  readonly lots: number;
  readonly units: number;
  readonly riskAmount: number;
  readonly pipsAtRisk: number;
  readonly balance: number;
  readonly riskPercent: number;
  readonly notes: readonly string[];
}

export interface RebateResult {
  readonly kind: "rebate";
  readonly assetLabel: string;
  readonly lots: number;
  readonly monthlyLow: number;
  readonly monthlyHigh: number;
  readonly monthlyMid: number;
  readonly annualMid: number;
  readonly perLotLow: number;
  readonly perLotHigh: number;
}

export interface TradeDraft {
  readonly kind: "trade";
  readonly instrument: string;
  readonly direction: TradeDirection;
  readonly entry: number;
  readonly lots: number;
  readonly stop: number | null;
  readonly target: number | null;
  readonly riskReward: number | null;
}

export type FlowResult = RiskResult | RebateResult | TradeDraft;

/** Runs the flow's computation. Pure, instant, browser-side. */
export function computeFlow(flow: FlowId, slots: Slots): FlowResult | { error: string } {
  if (flow === "risk") {
    const balance = num(slots.balance!);
    const riskPercent = num(slots.risk!);
    const sized = computeAutoSize({
      capital: balance,
      accountCurrency: "USD" as AccountCurrency,
      riskPercent,
      instrument: slots.instrument!.toUpperCase(),
      direction: slots.direction!.toLowerCase() as TradeDirection,
      entryPrice: num(slots.entry!),
      stopLossPrice: num(slots.stop!),
    });
    if (!sized) {
      return { error: "I couldn't size that one. Check the entry and stop are on the right sides." };
    }
    return {
      kind: "risk",
      instrument: slots.instrument!.toUpperCase(),
      direction: slots.direction!.toLowerCase(),
      lots: sized.lots,
      units: sized.quantity,
      riskAmount: sized.riskAmount,
      pipsAtRisk: sized.pipsAtRisk,
      balance,
      riskPercent,
      notes: sized.notes,
    };
  }

  if (flow === "rebate") {
    const asset = slots.asset!.toLowerCase() as AssetClass;
    const lots = num(slots.lots!);
    const e = estimateRebate(asset, lots);
    return {
      kind: "rebate",
      assetLabel: rateFor(asset).label,
      lots,
      monthlyLow: e.monthlyLow,
      monthlyHigh: e.monthlyHigh,
      monthlyMid: e.monthlyMid,
      annualMid: e.annualMid,
      perLotLow: e.perLotLow,
      perLotHigh: e.perLotHigh,
    };
  }

  // trade
  const entry = num(slots.entry!);
  const stop = numOrNull(slots.stop);
  const target = numOrNull(slots.target);
  const rr =
    stop !== null && target !== null && Math.abs(entry - stop) > 0
      ? Math.abs(target - entry) / Math.abs(entry - stop)
      : null;
  return {
    kind: "trade",
    instrument: slots.instrument!.toUpperCase(),
    direction: slots.direction!.toLowerCase() as TradeDirection,
    entry,
    lots: num(slots.lots!),
    stop,
    target,
    riskReward: rr,
  };
}

/**
 * Pull whatever the opening message already told us, so "@risk calculator EURUSD
 * buy" doesn't ask for things the user just said.
 */
export function seedSlots(flow: FlowDef, text: string): Slots {
  const out: Record<string, string> = {};
  const t = text.toLowerCase();

  if (flow.slots.some((s) => s.key === "direction")) {
    if (/\bbuy|long\b/.test(t)) out.direction = "buy";
    else if (/\bsell|short\b/.test(t)) out.direction = "sell";
  }
  if (flow.slots.some((s) => s.key === "asset")) {
    const hit = ASSETS.find((a) => t.includes(a));
    if (hit) out.asset = hit;
  }
  if (flow.slots.some((s) => s.key === "instrument")) {
    const m = text.match(/\b([A-Z]{6}|XAU[A-Z]{3}|BTC[A-Z]{3}|[A-Z]{3}\/[A-Z]{3})\b/);
    if (m) out.instrument = m[1].replace("/", "");
  }
  const lots = t.match(/([\d.]+)\s*lots?\b/);
  if (lots && flow.slots.some((s) => s.key === "lots")) out.lots = lots[1];

  const has = (k: string) => flow.slots.some((s) => s.key === k);

  // "25k account", "$10,000 balance", "balance 5000"
  if (has("balance")) {
    // "25k account" first: the keyword-then-number form was skipping across a
    // comma and grabbing the "1" out of "1% risk".
    const m =
      t.match(/\$?([\d.,]+k?)\s*(?:account|balance)/) ??
      t.match(/(?:balance|account)\s*(?:of|is|:)?\s*\$?([\d.,]+k?)/);
    if (m) out.balance = m[1];
  }
  // "1% risk", "risking 0.5%"
  if (has("risk")) {
    const m = t.match(/([\d.]+)\s*%/) ?? t.match(/risk(?:ing)?\D{0,4}([\d.]+)/);
    if (m) out.risk = m[1];
  }
  // "entry 2388" / "@ 1.0850" / "in at 2388"
  if (has("entry")) {
    const m = t.match(/(?:entry|enter|in at|@)\D{0,3}([\d.]+)/);
    if (m) out.entry = m[1];
  }
  // "stop 2380" / "sl 2380"
  if (has("stop")) {
    const m = t.match(/(?:stop(?:\s*loss)?|sl)\D{0,3}([\d.]+)/);
    if (m) out.stop = m[1];
  }
  // "target 2410" / "tp 2410"
  if (has("target")) {
    const m = t.match(/(?:target|take\s*profit|tp)\D{0,3}([\d.]+)/);
    if (m) out.target = m[1];
  }

  return out;
}
