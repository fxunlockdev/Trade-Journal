/**
 * Is this signal the shape a real one has?
 *
 * The grammar checks geometry: stop on the far side, targets on the near
 * side. A mistyped digit keeps the geometry and breaks the proportions: a
 * target 10% away on a scalp, a stop twenty times further than the first
 * target, a ladder out of order, an entry nowhere near where this room
 * last traded the instrument. None of those can be corrected by a machine,
 * because the right number is in the trader's head; all of them can be
 * refused and named, so the trader edits the message and the edit logs.
 *
 * What this cannot catch, and says so: a typo that stays plausible, such as
 * 4347 for 4374. Only the trader sees that, which is why every logged
 * signal carries the ✍ and every refusal a private note.
 */

import type { TradeDraft } from "@/lib/telegram/trade-intent";

/** A level further than this from the entry, as a fraction, is a typo until a person says otherwise. */
const MAX_LEVEL_DISTANCE = 0.08;
/** The stop may be this many times further, or closer, than the first target; beyond it a digit slipped. */
const MAX_STOP_TO_TP1_RATIO = 10;
/** How far an entry may sit from the room's recent entries in the same instrument. */
const MAX_DRIFT: Record<string, number> = { crypto: 0.25, default: 0.15 };

export interface SanityReference {
  /** Entry prices of this room's recent trades in the same instrument, if any. */
  readonly recentEntries: readonly number[];
}

function pct(a: number, b: number): string {
  return `${(Math.abs(a - b) / b * 100).toFixed(1)}%`;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Everything about the signal's proportions that a person should look at. Empty means plausible. */
export function signalSanity(d: TradeDraft, ref: SanityReference): readonly string[] {
  const issues: string[] = [];
  const entry = d.entry_price;
  const tps = [d.tp1, d.tp2, d.tp3, d.tp4, d.tp5, d.tp6, d.tp7]
    .map((p, i) => ({ p, i: i + 1 }))
    .filter((x): x is { p: number; i: number } => x.p !== null);

  for (const { p, i } of tps) {
    if (Math.abs(p - entry) / entry > MAX_LEVEL_DISTANCE) issues.push(`TP${i} ${p} is ${pct(p, entry)} from the entry; a mistyped digit?`);
  }
  if (d.stop_loss !== null && Math.abs(d.stop_loss - entry) / entry > MAX_LEVEL_DISTANCE) {
    issues.push(`the stop ${d.stop_loss} is ${pct(d.stop_loss, entry)} from the entry; a mistyped digit?`);
  }

  if (d.stop_loss !== null && tps.length > 0) {
    const stopDist = Math.abs(d.stop_loss - entry);
    const tp1Dist = Math.abs(tps[0].p - entry);
    if (stopDist > 0 && tp1Dist > 0) {
      const ratio = stopDist / tp1Dist;
      if (ratio > MAX_STOP_TO_TP1_RATIO) issues.push(`the stop is ${ratio.toFixed(0)}× further from the entry than TP1`);
      if (ratio < 1 / MAX_STOP_TO_TP1_RATIO) issues.push(`the stop is ${(1 / ratio).toFixed(0)}× closer to the entry than TP1`);
    }
  }

  // Targets walk away from the entry in the trade's direction, in order.
  const sign = d.direction === "buy" ? 1 : -1;
  for (let k = 1; k < tps.length; k += 1) {
    const prev = tps[k - 1];
    const cur = tps[k];
    if ((cur.p - prev.p) * sign <= 0) issues.push(`targets are out of order: TP${cur.i} ${cur.p} is not beyond TP${prev.i} ${prev.p}`);
  }

  if (ref.recentEntries.length > 0) {
    const m = median(ref.recentEntries);
    const drift = Math.abs(entry - m) / m;
    if (drift > (MAX_DRIFT[d.asset_type] ?? MAX_DRIFT.default)) {
      issues.push(`entry ${entry} is ${pct(entry, m)} from this room's recent ${d.instrument} entries (around ${m})`);
    }
  }

  return issues;
}
