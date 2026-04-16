import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSignalSchema } from "@/lib/validators/signal";
import { computeSignalFields } from "@/lib/signals/computations";
import { isTrader } from "@/lib/constants/roles";
import type { Signal, SignalStatus } from "@/types/database";

interface SignalFilters {
  readonly status?: SignalStatus;
  readonly trader_id?: string;
  readonly instrument?: string;
  readonly page?: number;
  readonly limit?: number;
}

function parseFilters(searchParams: URLSearchParams): SignalFilters {
  return {
    status: (searchParams.get("status") as SignalStatus) ?? undefined,
    trader_id: searchParams.get("trader_id") ?? undefined,
    instrument: searchParams.get("instrument") ?? undefined,
    page: Number(searchParams.get("page") ?? "1"),
    limit: Math.min(Number(searchParams.get("limit") ?? "25"), 100),
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const filters = parseFilters(request.nextUrl.searchParams);
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 25;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("signals")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters.status) {
      query = query.eq("status", filters.status);
    }

    if (filters.trader_id) {
      query = query.eq("trader_id", filters.trader_id);
    }

    if (filters.instrument) {
      query = query.eq("instrument", filters.instrument);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: data as Signal[],
      meta: {
        total: count ?? 0,
        page,
        limit,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: "Profile not found" },
        { status: 404 },
      );
    }

    if (!isTrader(profile.role)) {
      return NextResponse.json(
        { success: false, error: "Only traders and admins can create signals" },
        { status: 403 },
      );
    }

    const body: unknown = await request.json();
    const parsed = createSignalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "Validation failed" },
        { status: 400 },
      );
    }

    const computed = computeSignalFields({
      ...parsed.data,
      direction: parsed.data.direction,
      entry_price: parsed.data.entry_price,
      stop_loss: parsed.data.stop_loss,
      instrument: parsed.data.instrument,
      tp1: parsed.data.tp1 ?? null,
    });

    const signalPayload = {
      trader_id: parsed.data.trader_id,
      instrument: computed.instrument,
      direction: computed.direction,
      entry_price: computed.entry_price,
      stop_loss: computed.stop_loss,
      tp1: computed.tp1,
      tp2: parsed.data.tp2 ?? null,
      tp3: parsed.data.tp3 ?? null,
      tp4: parsed.data.tp4 ?? null,
      notes: parsed.data.notes ?? null,
      status: parsed.data.status ?? "CREATED",
      risk_amount: parsed.data.risk_amount ?? null,
      pips_to_sl: computed.pips_to_sl,
      pips_to_tp1: computed.pips_to_tp1,
    };

    const { data: signal, error: insertError } = await supabase
      .from("signals")
      .insert(signalPayload)
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: insertError.message },
        { status: 500 },
      );
    }

    await supabase.from("signal_events").insert({
      signal_id: signal.id,
      event_type: "CREATED",
      metadata: { created_by: user.id },
    });

    return NextResponse.json(
      { success: true, data: signal as Signal },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
