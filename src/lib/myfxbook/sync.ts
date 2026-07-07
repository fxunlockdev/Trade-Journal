import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyfxbookConnection } from "@/types/database";
import { decryptSecret } from "@/lib/crypto/secretbox";
import {
  MyfxbookApiError,
  myfxbookGetHistory,
  myfxbookGetOpenTrades,
  myfxbookLogin,
  packSession,
  unpackSession,
  withSessionRetry,
} from "@/lib/myfxbook/client";
import { mapHistoryRow, mapOpenTrade } from "@/lib/myfxbook/map";
import { processEvents, type IngestResult } from "@/lib/mt5/ingest-db";
import type { Mt5Event } from "@/lib/validators/mt5";

/**
 * One full sync pass for a Myfxbook connection:
 *   session (cached → re-login on IP-bound invalidation) → open trades +
 *   last-50 history → map to Mt5Events → shared idempotent ingest.
 *
 * Errors are recorded on the connection (last_error) instead of thrown, so a
 * broken connection never poisons a batch; auth-level failures surface in the
 * Settings UI with an actionable message.
 */

export interface SyncOutcome {
  readonly ok: boolean;
  readonly result?: IngestResult;
  readonly error?: string;
}

async function fetchEvents(
  connection: MyfxbookConnection,
  session: string,
): Promise<readonly Mt5Event[]> {
  const accountId = connection.myfxbook_account_id;
  const offset = connection.broker_utc_offset_minutes ?? 0;

  const openRows = await myfxbookGetOpenTrades(session, accountId);
  const historyRows = await myfxbookGetHistory(session, accountId);

  const events: Mt5Event[] = [];
  for (const row of openRows) {
    const event = mapOpenTrade(row, accountId, offset);
    if (event) events.push(event);
  }
  for (const row of historyRows) {
    const event = mapHistoryRow(row, accountId, offset);
    if (event) events.push(event);
  }
  return events;
}

export async function syncMyfxbookConnection(
  admin: SupabaseClient,
  connection: MyfxbookConnection,
): Promise<SyncOutcome> {
  try {
    const email = decryptSecret(connection.email_encrypted);
    const password = decryptSecret(connection.password_encrypted);
    const relogin = () => myfxbookLogin(email, password);

    // Start from the cached session+cookies (unpackSession hydrates the
    // Cloudflare affinity cookies the session is bound to); re-login on
    // demand. withSessionRetry rolls past "Invalid session" rejections.
    const startSession =
      unpackSession(connection.session_token) ?? (await relogin());
    const { session, value: events } = await withSessionRetry(
      startSession,
      relogin,
      (s) => fetchEvents(connection, s),
    );

    const result = await processEvents(
      admin,
      {
        journalId: connection.journal_id,
        userId: connection.user_id,
        accountKey: `myfxbook:${connection.myfxbook_account_id}`,
        source: "mt5_webhook",
      },
      events,
    );

    await admin
      .from("myfxbook_connections")
      .update({
        // Session + its affinity cookies persist together.
        session_token: packSession(session),
        last_sync_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", connection.id);

    return { ok: true, result };
  } catch (err: unknown) {
    const message =
      err instanceof MyfxbookApiError
        ? err.kind === "invalid_credentials"
          ? "Myfxbook rejected the stored credentials — reconnect with your current password."
          : err.kind === "login_locked"
            ? "Myfxbook temporarily locked API logins for this account — it clears on its own; try again later."
            : err.kind === "rate_limited"
              ? "Myfxbook's daily API request limit was hit (~100/day on their free tier) — sync resumes automatically once it resets."
              : err.message
        : err instanceof Error
          ? err.message
          : "Sync failed";

    // Invalidate a dead session so the next pass performs a clean login.
    const clearSession =
      err instanceof MyfxbookApiError &&
      (err.kind === "invalid_session" || err.kind === "invalid_credentials");

    await admin
      .from("myfxbook_connections")
      .update({
        last_error: message,
        ...(clearSession ? { session_token: null } : {}),
      })
      .eq("id", connection.id);

    return { ok: false, error: message };
  }
}

/** A connection is due when never-synced or stale beyond `staleMinutes`. */
export function isSyncDue(
  connection: Pick<MyfxbookConnection, "last_sync_at" | "revoked_at">,
  staleMinutes: number,
): boolean {
  if (connection.revoked_at) return false;
  if (!connection.last_sync_at) return true;
  const ageMs = Date.now() - new Date(connection.last_sync_at).getTime();
  return ageMs > staleMinutes * 60_000;
}
