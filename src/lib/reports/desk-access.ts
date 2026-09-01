import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every journal a desk names must be one the caller is a member of.
 *
 * `report_desks.journal_ids` is a uuid[], and Postgres arrays cannot carry a
 * foreign key, so RLS on the desks table proves ownership of the DESK but says
 * nothing about the journals inside it. Without this check a user could create
 * a desk listing someone else's journal id, then publish a branded poster of
 * that book's results.
 *
 * Returns a ready-to-send response on refusal, null when everything checks out.
 * 403 rather than 404: the caller supplied these ids, so their existence is not
 * a secret being leaked — only access is being refused.
 */
export async function assertJournalsAccessible(
  supabase: SupabaseClient,
  userId: string,
  journalIds: readonly string[],
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from("journal_members")
    .select("journal_id")
    .eq("user_id", userId)
    .in("journal_id", [...journalIds]);

  if (error) {
    return NextResponse.json(
      { error: "Couldn't verify journal access." },
      { status: 500 },
    );
  }

  const allowed = new Set((data ?? []).map((r) => r.journal_id as string));
  const missing = journalIds.filter((id) => !allowed.has(id));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error:
          missing.length === journalIds.length
            ? "You don't have access to those journals."
            : `You don't have access to ${missing.length} of the selected journals.`,
      },
      { status: 403 },
    );
  }
  return null;
}
