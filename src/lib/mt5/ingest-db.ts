import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mt5Event } from "@/lib/validators/mt5";
import {
  buildCloseFields,
  buildOpenUpdatePatch,
  buildSlTpPatch,
  buildTradeRow,
} from "@/lib/mt5/ingest";

/**
 * Transport-agnostic trade-event processor. The EA webhook, the Myfxbook
 * bridge and the manual report import all map their inputs into `Mt5Event`s
 * and run them through here, sharing one idempotent upsert keyed on
 * (journal_id, mt5_account, mt5_ticket) — backed by the unique index
 * `trades_mt5_dedupe`, with a 23505 race fallback.
 */

export interface IngestTarget {
  readonly journalId: string;
  readonly userId: string;
  /** Dedupe namespace, e.g. "Server:login", "myfxbook:123", "statement:555". */
  readonly accountKey: string;
  /** Trade source persisted on inserted rows. */
  readonly source: "mt5_webhook" | "csv";
}

export interface IngestResult {
  readonly processed: number;
  readonly skipped: number;
  readonly errors: readonly { ticket: number; message: string }[];
}

/** Postgres unique-violation — the insert lost a race; retry as update. */
const UNIQUE_VIOLATION = "23505";

async function findExisting(
  admin: SupabaseClient,
  target: IngestTarget,
  ticket: number,
): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from("trades")
    .select("id")
    .eq("journal_id", target.journalId)
    .eq("mt5_account", target.accountKey)
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
 * One query per batch: tickets of app-deleted trades in this journal +
 * account namespace. The audit trigger keeps the full row in before_data,
 * so re-syncs/re-imports can skip resurrecting user-deleted trades.
 * Best-effort — a failed lookup must never block ingest.
 */
export async function fetchDeletedTickets(
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
    console.error("[ingest] zombie-guard query failed:", error.message);
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

/**
 * Process one event. Returns "processed" or "skipped" (zombie-guarded).
 * Throws on database errors — caught per-event by processEvents.
 */
async function processEvent(
  admin: SupabaseClient,
  target: IngestTarget,
  event: Mt5Event,
  deletedTickets: ReadonlySet<number>,
): Promise<"processed" | "skipped"> {
  let existing = await findExisting(admin, target, event.ticket);

  if (!existing) {
    // Zombie guard: don't resurrect trades the user deleted in the app.
    if (deletedTickets.has(event.ticket)) return "skipped";

    const row = {
      ...buildTradeRow(event, target.accountKey, target.userId, target.journalId),
      source: target.source,
    };
    const inserted = await insertRow(admin, row);
    if (inserted === "duplicate") {
      // Lost a race with a concurrent batch — fall through to update.
      existing = await findExisting(admin, target, event.ticket);
      if (!existing) throw new Error("Insert conflicted but row not found");
    } else {
      existing = inserted;
    }
  } else if (event.type === "open") {
    // Netting accounts re-average entry on volume changes; mirror the source.
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
 * Sequential on purpose: same-ticket events in one batch (open → close)
 * must apply in order; batches are small. Per-event try/catch so one bad
 * row never poisons the batch.
 */
export async function processEvents(
  admin: SupabaseClient,
  target: IngestTarget,
  events: readonly Mt5Event[],
): Promise<IngestResult> {
  const deletedTickets = await fetchDeletedTickets(
    admin,
    target.journalId,
    events.map((e) => e.ticket),
  );

  let processed = 0;
  let skipped = 0;
  const errors: { ticket: number; message: string }[] = [];

  for (const event of events) {
    try {
      const outcome = await processEvent(admin, target, event, deletedTickets);
      if (outcome === "processed") processed += 1;
      else skipped += 1;
    } catch (err: unknown) {
      errors.push({
        ticket: event.ticket,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return { processed, skipped, errors };
}
