import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateTradeSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";
import { canEditTrades } from "@/lib/journals/active-journal";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Single-trade endpoints. After the 2026-04-23 multi-journal migration, the
 * old `.eq("user_id", user.id)` guard is gone — access is governed by
 * journal-membership RLS. RLS already filters to rows the caller can see;
 * for write ops we additionally verify the caller has `owner` or `member`
 * role in the trade's journal (viewers cannot mutate).
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // RLS (`trades_select`) restricts to trades in journals the caller
    // belongs to. No explicit journal filter needed here — a non-member
    // sees PGRST116 (no row) → 404.
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "PGRST116" ? 404 : 500 },
      );
    }

    return NextResponse.json({ data });
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
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
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

    // Fetch existing trade (RLS restricts to journals the caller is in)
    const { data: existing, error: fetchError } = await supabase
      .from("trades")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Trade not found" },
        { status: 404 },
      );
    }

    // Verify caller has edit rights in this trade's journal. RLS would block
    // the UPDATE anyway, but we return a cleaner 403 instead of a generic
    // Supabase "row violates policy" error.
    const { data: membership } = await supabase
      .from("journal_members")
      .select("role")
      .eq("journal_id", existing.journal_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership || !canEditTrades(membership.role)) {
      return NextResponse.json(
        { error: "You don't have permission to edit trades in this journal." },
        { status: 403 },
      );
    }

    const merged = { ...existing, ...parsed.data };
    const computed = computeTradeFields(merged);

    // Keep legacy `take_profit` synchronized with `tp1` on edits so reports
    // + MT5 webhook readers that still query `take_profit` don't drift.
    const updatePatch: Record<string, unknown> = { ...parsed.data };
    if ("tp1" in parsed.data) {
      updatePatch.take_profit = parsed.data.tp1 ?? parsed.data.take_profit ?? null;
    }

    const { data, error } = await supabase
      .from("trades")
      .update({
        ...updatePatch,
        pnl_absolute: computed.pnl_absolute,
        pnl_percentage: computed.pnl_percentage,
        risk_reward_ratio: computed.risk_reward_ratio,
        r_multiple: computed.r_multiple,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
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
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch to check permissions + produce a clean 403/404 before RLS kicks in
    const { data: existing } = await supabase
      .from("trades")
      .select("id, journal_id")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    const { data: membership } = await supabase
      .from("journal_members")
      .select("role")
      .eq("journal_id", existing.journal_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership || !canEditTrades(membership.role)) {
      return NextResponse.json(
        { error: "You don't have permission to delete trades in this journal." },
        { status: 403 },
      );
    }

    const { error } = await supabase
      .from("trades")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
