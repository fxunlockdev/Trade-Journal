import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateTradeSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";
import { canEditTrades } from "@/lib/journals/active-journal";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Single-trade endpoints. All reads + writes go through the admin client
 * because the Supabase SSR client's JWT context drops intermittently on
 * Vercel, making RLS-gated reads return empty sets even for the trade's
 * owner (root cause of the "Trade not found" delete bug).
 *
 * Safety model:
 *   1. supabase.auth.getUser() on SSR client to authenticate the caller.
 *   2. Admin client reads the trade by id (no RLS).
 *   3. Admin client reads the caller's journal_members row to check role.
 *   4. Only then does the admin mutation run.
 * Without step 3 there'd be no authorization; with it, the admin client
 * is just a reliable transport for already-verified access.
 */

async function getAuthedUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const user = await getAuthedUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: trade, error } = await admin
      .from("trades")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!trade) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    // Authorization gate — caller must be a member of the trade's journal.
    const { data: membership } = await admin
      .from("journal_members")
      .select("role")
      .eq("journal_id", trade.journal_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      // 404 not 403 — don't reveal existence to non-members.
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    return NextResponse.json({ data: trade });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const user = await getAuthedUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await request.json();
    const parsed = updateTradeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    // Fetch via admin — SSR client was returning null even for the trade's
    // own owner on Vercel, surfacing as a spurious "Trade not found" 404.
    const { data: existing, error: fetchError } = await admin
      .from("trades")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    // Authorization: must be owner or member of trade's journal
    const { data: membership } = await admin
      .from("journal_members")
      .select("role")
      .eq("journal_id", existing.journal_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }
    if (!canEditTrades(membership.role)) {
      return NextResponse.json(
        { error: "You don't have permission to edit trades in this journal." },
        { status: 403 },
      );
    }

    // Zod's `.partial()` still re-applies every field's `.default()`, so
    // `parsed.data` carries source:"manual", fees:0, tags:[], num_positions:1,
    // … for keys the client never sent. Persisting those verbatim would flip a
    // broker (csv / mt5_webhook) trade's provenance — disarming the P&L guard
    // below on the NEXT edit — and wipe its fees/tags on a note-only edit. So
    // act ONLY on the fields actually present in the request body.
    const bodyKeys =
      body !== null && typeof body === "object"
        ? new Set(Object.keys(body as Record<string, unknown>))
        : new Set<string>();
    const sentData = Object.fromEntries(
      Object.entries(parsed.data).filter(([k]) => bodyKeys.has(k)),
    );

    const merged = { ...existing, ...sentData };
    const computed = computeTradeFields(merged);

    const updatePatch: Record<string, unknown> = { ...sentData };
    if ("tp1" in sentData) {
      updatePatch.take_profit = sentData.tp1 ?? sentData.take_profit ?? null;
    }

    // Clearing the per-trade risk override has to REACH the database. The
    // validator maps a blank/null input to `undefined`, and `undefined` is
    // dropped by JSON serialization — so without this the column would keep its
    // old value and the trade would stay pinned to a stale risk % forever.
    // Sending `null` is what puts it back on the journal default.
    if (bodyKeys.has("risk_percent")) {
      updatePatch.risk_percent = parsed.data.risk_percent ?? null;
    }

    // `source` is provenance — how the trade entered the system (manual / csv
    // import / mt5_webhook). It is immutable after creation: an edit must never
    // rewrite it, or a raw PATCH `{"source":"manual"}` could strip a broker
    // trade's provenance and disarm the P&L guard below on the next edit.
    delete updatePatch.source;

    // Broker-sourced trades — the MT5 webhook AND report imports ("csv") —
    // carry the broker's REAL money PnL (profit + commission + swap), which
    // price×quantity math cannot reproduce (lot-denominated volumes,
    // quote-currency conversion), plus a stamped TP/SL-hit result and risk
    // fields written with a trailed-SL guard. Never recompute those from an
    // app-side edit: a note-only edit must not silently corrupt the P&L, and a
    // stamped tp1_result must not flip computeTradeFields into re-deriving P&L
    // from the TP price.
    const isBrokerSourced =
      existing.source === "mt5_webhook" || existing.source === "csv";

    const { data, error } = await admin
      .from("trades")
      .update({
        ...updatePatch,
        pnl_absolute: isBrokerSourced
          ? existing.pnl_absolute
          : computed.pnl_absolute,
        pnl_percentage: isBrokerSourced
          ? existing.pnl_percentage
          : computed.pnl_percentage,
        risk_reward_ratio: isBrokerSourced
          ? existing.risk_reward_ratio
          : computed.risk_reward_ratio,
        r_multiple: isBrokerSourced ? existing.r_multiple : computed.r_multiple,
        // exit_price travels WITH the recomputed P&L, never separately. Writing
        // one without the other (the old "only on pricing edits" rule) let a
        // note-only edit leave a row whose stored exit says one thing and whose
        // stored money says another. For a manual trade both are derived from
        // the same fields, so persisting them together is what keeps the row
        // internally consistent.
        ...(isBrokerSourced ? {} : { exit_price: computed.exit_price }),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[trades/PATCH] update failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const user = await getAuthedUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Admin fetch — SSR client returning null was the entire "Trade not
    // found" bug. With admin, the row is there; authorization handled in TS.
    const { data: existing } = await admin
      .from("trades")
      .select("id, journal_id")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    const { data: membership } = await admin
      .from("journal_members")
      .select("role")
      .eq("journal_id", existing.journal_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      // 404 not 403 — don't reveal existence of trades to non-members.
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }
    if (!canEditTrades(membership.role)) {
      return NextResponse.json(
        { error: "You don't have permission to delete trades in this journal." },
        { status: 403 },
      );
    }

    const { error } = await admin
      .from("trades")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[trades/DELETE] delete failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
