import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyfxbookConnection } from "@/types/database";
import { decryptSecret } from "@/lib/crypto/secretbox";
import {
  MyfxbookApiError,
  myfxbookGetHistory,
  myfxbookGetOpenTrades,
  myfxbookLogin,
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

async function ensureSession(
  connection: MyfxbookConnection,
): Promise<{ session: string; fresh: boolean }> {
  if (connection.session_token) {
    return { session: connection.session_token, fresh: false };
  }
  const email = decryptSecret(connection.email_encrypted);
  const password = decryptSecret(connection.password_encrypted);
  const session = await myfxbookLogin(email, password);
  return { session, fresh: true };
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
    let { session, fresh } = await ensureSession(connection);
    let events: readonly Mt5Event[];

    try {
      events = await fetchEvents(connection, session);
    } catch (err: unknown) {
      // IP-bound sessions die whenever the serverless egress IP rotates —
      // re-login once with the stored credentials and retry.
      if (
        err instanceof MyfxbookApiError &&
        err.kind === "invalid_session" &&
        !fresh
      ) {
        const email = decryptSecret(connection.email_encrypted);
        const password = decryptSecret(connection.password_encrypted);
        session = await myfxbookLogin(email, password);
        fresh = true;
        events = await fetchEvents(connection, session);
      } else {
        throw err;
      }
    }

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
        session_token: session,
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
