import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { mt5BatchSchema, type Mt5Event } from "@/lib/validators/mt5";
import { mt5AuthErrorMessage, resolveMt5Connection } from "@/lib/mt5/auth";
import {
  buildAccountKey,
  buildCloseFields,
  buildOpenUpdatePatch,
  buildSlTpPatch,
  buildTradeRow,
} from "@/lib/mt5/ingest";
import type { Mt5Connection } from "@/types/database";

/**
 * EA-facing batch ingest. Bearer-token auth (no cookies) — the token maps to
 * a user + target journal via mt5_connections.
 *
 * Idempotency: every event is keyed on (journal_id, mt5_account, mt5_ticket)
 * with a unique index behind it, and close events carry CUMULATIVE snapshots
 * (the EA aggregates partial closes), so any event can be replayed at any
 * time and simply converge to the same row. That property is what lets the
 * EA use "re-send everything" as its retry strategy, and lets the 30-day
 * history backfill reuse this exact endpoint.
 *
 * 50 events × up to 3 Supabase round-trips can exceed Vercel's default 10s.
 */
export const maxDuration = 60;

interface EventError {
  readonly ticket: number;
  readonly message: string;
}

/** Postgres unique-violation — the insert lost a race; retry as update. */
const UNIQUE_VIOLATION = "23505";

async function findExisting(
  admin: SupabaseClient,
  journalId: string,
  accountKey: string,
  ticket: number,
): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from("trades")
    .select("id")
    .eq("journal_id", journalId)
    .eq("mt5_account", accountKey)
    .eq("mt5_ticket", ticket)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function insertRow(
  admin: SupabaseClient,
  row: Record<string, unknown>,
): Promise<{ id: string } | "duplicate"> {
  const { data, error } = await admin
    .from("trades")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return "duplicate";
    throw new Error(error.message);
  }
  return data;
}

async function updateRow(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from("trades").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Process one event. Returns "processed" or "skipped" (zombie-guarded).
 * Throws on database errors — caught per-event by the caller.
 */
async function processEvent(
  admin: SupabaseClient,
  connection: Mt5Connection,
  accountKey: string,
  event: Mt5Event,
  deletedTickets: ReadonlySet<number>,
): Promise<"processed" | "skipped"> {
  const journalId = connection.journal_id;
  let existing = await findExisting(admin, journalId, accountKey, event.ticket);

  if (!existing) {
    // Zombie guard: don't resurrect trades the user deleted in the app.
    if (deletedTickets.has(event.ticket)) return "skipped";

    const row = buildTradeRow(event, accountKey, connection.user_id, journalId);
    const inserted = await insertRow(admin, row);
    if (inserted === "duplicate") {
      // Lost a race with a concurrent batch — fall through to update.
      existing = await findExisting(admin, journalId, accountKey, event.ticket);
      if (!existing) throw new Error("Insert conflicted but row not found");
    } else {
      existing = inserted;
    }
  } else if (event.type === "open") {
    // Netting accounts re-average entry on volume changes; mirror MT5.
    await updateRow(admin, existing.id, buildOpenUpdatePatch(event));
  }

  if (event.type === "update") {
    await updateRow(admin, existing.id, buildSlTpPatch(event));
  }

  if (event.type === "close") {
    // Non-final snapshots (partial closes) only refresh SL/TP — analytics
    // define "closed" as pnl_absolute !== null, so exit fields wait for the
    // final snapshot. Cumulative totals make the final write authoritative.
    const patch = event.is_final
      ? { ...buildSlTpPatch(event), ...buildCloseFields(event) }
      : buildSlTpPatch(event);
    await updateRow(admin, existing.id, patch);
  }

  return "processed";
}

/**
 * One query per batch: tickets of app-deleted MT5 trades in this journal.
 * The audit trigger stores the full row in before_data, so the ticket
 * survives the delete and lets backfill skip resurrected zombies.
 */
async function fetchDeletedTickets(
  admin: SupabaseClient,
  journalId: string,
  tickets: readonly number[],
): Promise<ReadonlySet<number>> {
  if (tickets.length === 0) return new Set();
  const { data, error } = await admin
    .from("trade_audit_log")
    .select("before_data")
    .eq("journal_id", journalId)
    .eq("action", "deleted")
    .in(
      "before_data->>mt5_ticket",
      tickets.map((t) => String(t)),
    );
  if (error) {
    // Zombie guard is best-effort — a failed lookup must not block ingest.
    console.error("[mt5/trades] zombie-guard query failed:", error.message);
    return new Set();
  }
  const set = new Set<number>();
  for (const row of data ?? []) {
    const raw = (row.before_data as Record<string, unknown> | null)?.mt5_ticket;
    const ticket = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(ticket)) set.add(ticket);
  }
  return set;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = createAdminClient();
    const auth = await resolveMt5Connection(
      admin,
      request.headers.get("authorization"),
    );
    if (!auth.ok) {
      return NextResponse.json(
        { error: mt5AuthErrorMessage(auth.reason), reason: auth.reason },
        { status: auth.status },
      );
    }
    const { connection } = auth;

    const body: unknown = await request.json();
    const parsed = mt5BatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const batch = parsed.data;

    // Account pinning — a token serves exactly one MT5 account.
    const accountKey = buildAccountKey(batch.account, batch.server);
    if (connection.account_login && connection.account_login !== accountKey) {
      return NextResponse.json(
        {
          error: `This token is pinned to account ${connection.account_login}. Generate a separate token for ${accountKey}.`,
          reason: "account_mismatch",
        },
        { status: 409 },
      );
    }

    const deletedTickets = await fetchDeletedTickets(
      admin,
      connection.journal_id,
      batch.events.map((e) => e.ticket),
    );

    let processed = 0;
    let skipped = 0;
    const errors: EventError[] = [];

    // Sequential on purpose: same-ticket events in one batch (open → close)
    // must apply in order; batches are small (≤50).
    for (const event of batch.events) {
      try {
        const outcome = await processEvent(
          admin,
          connection,
          accountKey,
          event,
          deletedTickets,
        );
        if (outcome === "processed") processed += 1;
        else skipped += 1;
      } catch (err: unknown) {
        errors.push({
          ticket: event.ticket,
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // Heartbeat + first-contact pinning (account/broker locked from now on).
    await admin
      .from("mt5_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        account_login: connection.account_login ?? accountKey,
        broker: connection.broker ?? batch.broker ?? null,
      })
      .eq("id", connection.id);

    return NextResponse.json({
      data: { processed, skipped, errors },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
