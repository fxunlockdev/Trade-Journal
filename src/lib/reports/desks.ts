import { defaultGroupName, journalSetKey } from "@/lib/posters/scope";
import type { ReportDesk } from "@/types/database";

/**
 * A desk: the unit a poster is published for.
 *
 * A desk is a named, branded set of journals. It exists because a poster's
 * identity used to live in the browser — group name and logo keyed by journal
 * combination in localStorage — which is fine while a human with that browser
 * open is the only thing generating posters, and useless the moment anything
 * else does. A scheduled job has no browser; the same trader on a phone is a
 * different one.
 *
 * The row type lives in types/database.ts with the rest of the schema; the
 * matching rules live here.
 *
 * The naming problem is sharpest for combinations. "Gold Intraday" is two
 * journals, and derived from their names it reads
 * "TTC GOLD | CHRIS + TTC GOLD | YOHAN" — accurate, and unusable as marketing.
 */


/**
 * The desk a journal selection belongs to, or null.
 *
 * Matched on the SET, not the order or the array identity: a desk saved by
 * ticking Chris then Yohan must still be found by someone who ticks Yohan then
 * Chris. `journalSetKey` is the single definition of that, shared with the
 * localStorage keys so the two can never disagree about what "the same
 * combination" means.
 *
 * Only active desks match. An archived desk should stop branding posters
 * without having to be deleted, which would lose its name.
 */
export type { ReportDesk };

export function findDeskForJournals(
  desks: readonly ReportDesk[],
  journalIds: readonly string[],
): ReportDesk | null {
  const key = journalSetKey(journalIds);
  if (key === null) return null;
  return (
    desks.find(
      (d) => d.is_active && journalSetKey(d.journal_ids) === key,
    ) ?? null
  );
}

export interface PosterIdentity {
  /** The name to print. */
  readonly name: string;
  /**
   * Logo path, or null to print the name.
   *
   * NOTHING WRITES THIS YET. `report_desks.logo_path` has no producer until the
   * logo move lands, so this is null for every desk the app can currently
   * create, and the poster still takes its logo from localStorage. Consuming
   * it before there is an upload path would silently drop a user's logo.
   */
  readonly logoPath: string | null;
  /** True when this came from a saved desk rather than being derived. */
  readonly fromDesk: boolean;
}

/**
 * What a poster should call itself for a given selection.
 *
 * A saved desk wins. Otherwise the name is derived from the journals exactly as
 * before, so an ad-hoc selection on the posters page still produces something
 * sensible without forcing anyone to create a desk first.
 */
export function posterIdentity(
  desks: readonly ReportDesk[],
  journalIds: readonly string[],
  journals: readonly { readonly id: string; readonly name: string }[],
): PosterIdentity {
  const desk = findDeskForJournals(desks, journalIds);
  if (desk) {
    return { name: desk.name, logoPath: desk.logo_path, fromDesk: true };
  }
  const selected = journals.filter((j) => journalIds.includes(j.id));
  return {
    name: defaultGroupName(selected),
    logoPath: null,
    fromDesk: false,
  };
}

/**
 * The journals a desk covers, in the caller's journal order.
 *
 * Ids that no longer resolve are dropped rather than throwing: a journal can be
 * deleted while a desk still lists it, and a desk that loses one of two
 * journals should keep publishing the remaining one rather than failing.
 * Callers that care about the difference compare lengths.
 */
export function deskJournals<T extends { readonly id: string }>(
  desk: ReportDesk,
  journals: readonly T[],
): readonly T[] {
  const wanted = new Set(desk.journal_ids);
  return journals.filter((j) => wanted.has(j.id));
}

/** Desks in display order: explicit sort_order, then name. */
export function orderDesks(
  desks: readonly ReportDesk[],
): readonly ReportDesk[] {
  return [...desks].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
}
