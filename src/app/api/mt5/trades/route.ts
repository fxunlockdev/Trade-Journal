import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mt5BatchSchema } from "@/lib/validators/mt5";
import { mt5AuthErrorMessage, resolveMt5Connection } from "@/lib/mt5/auth";
import { buildAccountKey } from "@/lib/mt5/ingest";
import { processEvents } from "@/lib/mt5/ingest-db";

/**
 * EA-facing batch ingest. Bearer-token auth (no cookies) — the token maps to
 * a user + target journal via mt5_connections.
 *
 * Idempotency: every event is keyed on (journal_id, mt5_account, mt5_ticket)
 * with a unique index behind it, and close events carry CUMULATIVE snapshots
 * (the EA aggregates partial closes), so any event can be replayed at any
 * time and simply converge to the same row. That property is what lets the
 * EA use "re-send everything" as its retry strategy, and lets the 30-day
 * history backfill reuse this exact endpoint. The processing itself lives in
 * src/lib/mt5/ingest-db.ts, shared with the Myfxbook bridge + report import.
 *
 * 50 events × up to 3 Supabase round-trips can exceed Vercel's default 10s.
 */
export const maxDuration = 60;

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

    const result = await processEvents(
      admin,
      {
        journalId: connection.journal_id,
        userId: connection.user_id,
        accountKey,
        source: "mt5_webhook",
      },
      batch.events,
    );

    // Heartbeat + first-contact pinning (account/broker locked from now on).
    await admin
      .from("mt5_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        account_login: connection.account_login ?? accountKey,
        broker: connection.broker ?? batch.broker ?? null,
      })
      .eq("id", connection.id);

    return NextResponse.json({ data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
