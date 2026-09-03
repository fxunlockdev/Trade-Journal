/**
 * The Telegram-user-to-app-account bridge, and the two lookups a trade needs
 * once the account is known.
 *
 * All service-role: these tables revoke writes from `authenticated`, because a
 * client that could insert here could claim to be anybody.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { canEditTrades } from "@/lib/journals/active-journal";
import type { JournalRole } from "@/types/database";

export type Admin = ReturnType<typeof createAdminClient>;

/**
 * Redeem a link code for a Telegram user. One transaction on the database
 * side (see `link_telegram_account`): the code is checked, the account row is
 * replaced in both directions, the code is claimed. "invalid" covers wrong,
 * used and expired alike, so probing learns nothing.
 */
export async function linkAccountWithCode(
  admin: Admin,
  code: string,
  telegramUserId: number,
): Promise<"linked" | "invalid" | "error"> {
  const { data, error } = await admin.rpc("link_telegram_account", {
    p_code: code,
    p_telegram_user_id: telegramUserId,
  });
  if (error) return "error";
  return data ? "linked" : "invalid";
}

/**
 * The app account behind a Telegram user, or null if never linked.
 *
 * Also records that they were seen. Awaited: a supabase-js query only runs
 * when it is awaited, so the previous fire-and-forget never wrote anything.
 */
export async function linkedUser(admin: Admin, telegramUserId: number): Promise<string | null> {
  const { data } = await admin
    .from("telegram_accounts")
    .select("user_id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (!data) return null;
  await admin
    .from("telegram_accounts")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("telegram_user_id", telegramUserId);
  return data.user_id as string;
}

export interface JournalChoice {
  readonly id: string;
  readonly name: string;
}

/**
 * Journals this account may write trades into, in a stable order.
 *
 * The ORDER is load-bearing: the picker's buttons carry an index into this
 * list, stored with the draft, so the same account must get the same list.
 */
export async function editableJournals(admin: Admin, userId: string): Promise<JournalChoice[]> {
  const { data } = await admin
    .from("journal_members")
    .select("role, journals!inner(id, name, is_archived, sort_order, created_at)")
    .eq("user_id", userId)
    .eq("journals.is_archived", false);
  type Row = {
    role: JournalRole;
    journals: { id: string; name: string; sort_order: number; created_at: string };
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => canEditTrades(r.role))
    .map((r) => r.journals)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .map((j) => ({ id: j.id, name: j.name }));
}

/**
 * The size THIS PERSON last used for this instrument in this journal, or
 * null. The rule for a message that names no size: continue their own
 * convention rather than invent one. Filtered by user as well as journal,
 * because journals are shared and a colleague's five-lot habit is not a
 * convention of theirs. An error is null too; the caller's fallback and the
 * confirmation message cover it.
 */
export async function lastSize(
  admin: Admin,
  userId: string,
  journalId: string,
  instrument: string,
): Promise<{ quantity: number; lots: number | null } | null> {
  const { data, error } = await admin
    .from("trades")
    .select("quantity, lot_size")
    .eq("user_id", userId)
    .eq("journal_id", journalId)
    .eq("instrument", instrument)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const q = data?.quantity;
  if (typeof q !== "number" || q <= 0) return null;
  const lots = data?.lot_size;
  return { quantity: q, lots: typeof lots === "number" && lots > 0 ? lots : null };
}
