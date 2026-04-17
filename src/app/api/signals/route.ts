import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSignalSchema } from "@/lib/validators/signal";
import { computeSignalFields } from "@/lib/signals/computations";
import { isTrader } from "@/lib/constants/roles";

/**
 * Fetch the caller's role. Returns null if the user has no profile row.
 */
async function getCallerRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();
  return (data?.role as string | undefined) ?? null;
}

interface SignalListParams {
  readonly status?: string;
  readonly instrument?: string;
  readonly page: number;
  readonly limit: number;
}

function parseSearchParams(searchParams: URLSearchParams): SignalListParams {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));

  return {
    status: searchParams.get("status") ?? undefined,
    instrument: searchParams.get("instrument") ?? undefined,
    page,
    limit,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = parseSearchParams(request.nextUrl.searchParams);
    const offset = (params.page - 1) * params.limit;

    // Scoping: admins see everything, traders see their own signals,
    // regular users see nothing (forbidden).
    const role = await getCallerRole(supabase, user.id);
    const isAdmin = role === "admin";
    const canSeeOwn = isTrader(role ?? "");

    if (!isAdmin && !canSeeOwn) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 },
      );
    }

    let query = supabase
      .from("signals")
      .select("*", { count: "exact" });

    if (!isAdmin) {
      query = query.eq("trader_id", user.id);
    }

    if (params.status) {
      query = query.eq("status", params.status);
    }

    if (params.instrument) {
      query = query.ilike("instrument", `%${params.instrument}%`);
    }

    query = query
      .order("created_at", { ascending: false })
      .range(offset, offset + params.limit - 1);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data: data ?? [],
      meta: {
        total: count ?? 0,
        page: params.page,
        limit: params.limit,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userRecord, error: userError } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (userError || !userRecord) {
      return NextResponse.json(
        { error: "User profile not found" },
        { status: 403 },
      );
    }

    if (!isTrader(userRecord.role)) {
      return NextResponse.json(
        { error: "Only traders and admins can create signals" },
        { status: 403 },
      );
    }

    const body: unknown = await request.json();
    const parsed = createSignalSchema.safeParse({
      ...(typeof body === "object" && body !== null ? body : {}),
      trader_id: user.id,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const computed = computeSignalFields({
      entry_price: parsed.data.entry_price,
      stop_loss: parsed.data.stop_loss,
      tp1: parsed.data.tp1 ?? null,
      instrument: parsed.data.instrument,
    });

    const signalData = {
      ...parsed.data,
      tp1: parsed.data.tp1 ?? null,
      tp2: parsed.data.tp2 ?? null,
      tp3: parsed.data.tp3 ?? null,
      tp4: parsed.data.tp4 ?? null,
      notes: parsed.data.notes ?? null,
      risk_amount: parsed.data.risk_amount ?? null,
      pips_to_sl: computed.pips_to_sl,
      pips_to_tp1: computed.pips_to_tp1,
    };

    const { data: signal, error: insertError } = await supabase
      .from("signals")
      .insert(signalData)
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 },
      );
    }

    const { error: eventError } = await supabase
      .from("signal_events")
      .insert({
        signal_id: signal.id,
        event_type: "CREATED",
        metadata: {},
      });

    if (eventError) {
      console.error("[TRDR] signal_events insert failed:", eventError.message);
    }

    return NextResponse.json({ data: signal }, { status: 201 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
