import type { Journal, Trade } from "@/types/database";

/**
 * Which trades a poster covers.
 *
 * Kept separate from `poster-data.ts` on purpose: that module is deliberately
 * journal-agnostic — a pure function over an array of trades — which is exactly
 * why combining journals needs no changes there. This module decides WHICH
 * trades get handed to it, and nothing else.
 *
 * Narrowing mirrors the Portfolio view (portfolio-client.tsx): journals first,
 * then instruments within that selection, with an empty set meaning "all" in
 * both cases.
 */

/** An empty selection means "everything", matching Portfolio's filter chips. */
function matchesSelection(value: string, selected: ReadonlySet<string>): boolean {
  return selected.size === 0 || selected.has(value);
}

/** Trades belonging to the selected journals, then the selected instruments. */
export function scopeTrades(
  trades: readonly Trade[],
  journalIds: ReadonlySet<string>,
  instruments: ReadonlySet<string>,
): readonly Trade[] {
  return trades.filter(
    (t) =>
      matchesSelection(t.journal_id, journalIds) &&
      matchesSelection(t.instrument, instruments),
  );
}

/** Trades in the selected journals, ignoring any instrument filter. */
export function scopeByJournal(
  trades: readonly Trade[],
  journalIds: ReadonlySet<string>,
): readonly Trade[] {
  return trades.filter((t) => matchesSelection(t.journal_id, journalIds));
}

/**
 * Instruments to offer as filters.
 *
 * Derived from the JOURNAL-scoped set, not from everything: picking Yohan and
 * Chris should narrow the asset list to what those two actually traded, rather
 * than offering pairs that would return nothing.
 */
export function instrumentOptions(
  trades: readonly Trade[],
): readonly { readonly value: string; readonly label: string }[] {
  const set = new Set<string>();
  for (const t of trades) set.add(t.instrument);
  return [...set].sort().map((i) => ({ value: i, label: i }));
}

/**
 * Where a group-name override is remembered.
 *
 * Sorted so ticking Yohan-then-Chris and Chris-then-Yohan share one entry. For
 * a single journal this produces exactly the key the single-journal feature
 * already used, so names saved before this change survive it.
 */
export function groupStorageKey(journalIds: readonly string[]): string | null {
  return posterScopeKey("group", journalIds);
}

/**
 * The one place a poster preference's storage key is built.
 *
 * Everything a user sets on a poster is scoped to the journal COMBINATION it
 * was set for, and every such key has to agree on what "the same combination"
 * means. Two hand-written implementations of the sort-and-join would only have
 * to disagree once — a workspace id added to one, a different separator — for a
 * logo to outlive the name it replaced, or to attach to the wrong team.
 */
export function posterScopeKey(
  kind: string,
  journalIds: readonly string[],
): string | null {
  // No journals means no combination to remember; a bare "trdr_poster_group:"
  // would be a keyless global entry shared by every such state.
  if (journalIds.length === 0) return null;
  return `trdr_poster_${kind}:${[...journalIds].sort().join("+")}`;
}

export interface JournalCount {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

/**
 * Per-journal trade counts for the on-screen receipt, so a combined poster can
 * be sanity-checked against each journal before it is published. Ordered by the
 * journal list, and journals contributing nothing are omitted.
 */
export function perJournalCounts(
  trades: readonly Trade[],
  journals: readonly Pick<Journal, "id" | "name">[],
): readonly JournalCount[] {
  const counts = new Map<string, number>();
  for (const t of trades) {
    counts.set(t.journal_id, (counts.get(t.journal_id) ?? 0) + 1);
  }
  return journals
    .map((j) => ({ id: j.id, name: j.name, count: counts.get(j.id) ?? 0 }))
    .filter((j) => j.count > 0);
}

/**
 * The line a combined poster adds to its own disclaimer.
 *
 * A poster carrying two traders' results has to say so on the artefact —
 * the on-screen breakdown isn't published, and a reader would otherwise take
 * the figures for one person's record.
 */
export function combinedDisclaimerNote(journalCount: number): string | null {
  if (journalCount < 2) return null;
  return `Combined results across ${journalCount} journals.`;
}

/** How many distinct journals the scoped trades actually came from. */
export function contributingJournalCount(trades: readonly Trade[]): number {
  const set = new Set<string>();
  for (const t of trades) set.add(t.journal_id);
  return set.size;
}

/** The cap the group-name input and the poster header are designed around. */
export const GROUP_NAME_MAX = 40;

/**
 * The group name a poster starts with.
 *
 * One journal uses its own name, as before. A combination joins them — "YOHAN +
 * CHRIS" is accurate and needs no typing, where a placeholder dash would ship a
 * poster that looks broken. Beyond three it becomes a count, because the field
 * is a headline, not a list.
 */
export function defaultGroupName(
  journals: readonly { readonly name: string }[],
): string {
  if (journals.length === 0) return "";
  if (journals.length === 1) return journals[0].name;
  // Journal names are allowed up to 60 characters each, so a join of three can
  // reach ~186 — far past the 40 the group field and the poster header were
  // designed around. Fall through to the count when it won't fit.
  const joined = journals.map((j) => j.name).join(" + ");
  if (journals.length <= 3 && joined.length <= GROUP_NAME_MAX) return joined;
  return `${journals.length} journals`;
}

/**
 * How far back the poster generator reads trades.
 *
 * The longest selectable period is "last month", so this is generous cover for
 * that plus timezone slop. A bound matters more than it looks: with several
 * journals in one query, PostgREST's max-rows ceiling (1000 by default on
 * hosted Supabase) becomes reachable, and a silently truncated read would
 * understate the pip total on something the user is about to publish.
 *
 * `now` is injectable so the boundary is testable, and the call lives here
 * rather than in the page body — reading the clock during render is impure.
 */
export function lookbackCutoffIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
