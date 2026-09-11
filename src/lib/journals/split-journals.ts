/**
 * The journals a person belongs to, split the way the app shows them: the
 * working set in the switcher, and the archived ones behind it.
 *
 * Archiving hides a journal from every list, and the only way back was its
 * settings page, which opens only for the journal you are in, which an
 * archived journal can never be. So the archived list is kept, in the same
 * order, for a section of the switcher where it can be found and restored.
 */

import type { Journal, JournalRole, JournalWithRole } from "@/types/database";

export interface MembershipRow {
  readonly role: JournalRole;
  readonly journals: Journal | null;
}

export interface SplitJournals {
  readonly journals: readonly JournalWithRole[];
  readonly archived: readonly JournalWithRole[];
}

function byOrder(a: JournalWithRole, b: JournalWithRole): number {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

export function splitJournals(rows: readonly MembershipRow[]): SplitJournals {
  const all = rows
    .filter((r): r is MembershipRow & { journals: Journal } => r.journals !== null)
    .map((r) => ({ ...r.journals, my_role: r.role }))
    .sort(byOrder);
  return {
    journals: all.filter((j) => !j.is_archived),
    archived: all.filter((j) => j.is_archived),
  };
}
