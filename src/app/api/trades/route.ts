import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createTradeSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";

interface TradeListParams {
  readonly from?: string;
  readonly to?: string;
  readonly instrument?: string;
  readonly pnl_filter?: "profit" | "loss" | "all";
  readonly tags?: string;
  readonly page: number;
  readonly limit: number;
  readonly sort_by: string;
  readonly sort_dir: "asc" | "desc";
}

function parseSearchParams(searchParams: URLSearchParams): TradeListParams {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const sort_by = searchParams.get("sort_by") ?? "entry_time";
  const rawDir = searchParams.get("sort_dir");
  const sort_dir = rawDir === "asc" ? "asc" : "desc";

  return {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    instrument: searchParams.get("instrument") ?? undefined,
    pnl_filter: (searchParams.get("pnl_filter") as TradeListParams["pnl_filter"]) ?? "all",
    tags: searchParams.get("tags") ?? undefined,
    page,
    limit,
    sort_by,
    sort_dir,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const params = parseSearchParams(request.nextUrl.searchParams);
    const offset = (params.page - 1) * params.limit;

    let query = supabase
      .from("trades")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);

    if (params.from) {
      query = query.gte("entry_time", params.from);
    }

    if (params.to) {
      query = query.lte("entry_time", params.to);
    }

    if (params.instrument) {
      query = query.ilike("instrument", `%${params.instrument}%`);
    }

    if (params.pnl_filter === "profit") {
      query = query.gt("pnl_absolute", 0);
    } else if (params.pnl_filter === "loss") {
      query = query.lt("pnl_absolute", 0);
    }

    if (params.tags) {
      const tagList = params.tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        query = query.overlaps("tags", tagList);
      }
    }

    query = query
      .order(params.sort_by, { ascending: params.sort_dir === "asc" })
      .range(offset, offset + params.limit - 1);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      );
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
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body: unknown = await request.json();
    const parsed = createTradeSchema.safeParse({
      ...(typeof body === "object" && body !== null ? body : {}),
      user_id: user.id,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    // Normalize all nullable fields to `null` (never `undefined`) so Supabase
    // receives a clean row. Also keep `take_profit` (legacy single-TP) in sync
    // with `tp1` so older reports / MT5 webhook readers keep working.
    const tp1 = parsed.data.tp1 ?? null;
    const legacyTp = tp1 ?? parsed.data.take_profit ?? null;

    const tradeData = {
      ...parsed.data,
      exit_price: parsed.data.exit_price ?? null,
      entry_price_high: parsed.data.entry_price_high ?? null,
      stop_loss: parsed.data.stop_loss ?? null,
      sl_pips: parsed.data.sl_pips ?? null,
      take_profit: legacyTp,
      tp1,
      tp2: parsed.data.tp2 ?? null,
      tp3: parsed.data.tp3 ?? null,
      tp4: parsed.data.tp4 ?? null,
      tp1_pips: parsed.data.tp1_pips ?? null,
      tp2_pips: parsed.data.tp2_pips ?? null,
      tp3_pips: parsed.data.tp3_pips ?? null,
      tp4_pips: parsed.data.tp4_pips ?? null,
      tp1_result: parsed.data.tp1_result ?? null,
      tp2_result: parsed.data.tp2_result ?? null,
      tp3_result: parsed.data.tp3_result ?? null,
      tp4_result: parsed.data.tp4_result ?? null,
      tp4_trailing: parsed.data.tp4_trailing ?? false,
      order_type: parsed.data.order_type ?? "market",
      num_positions: parsed.data.num_positions ?? 1,
      split_risk: parsed.data.split_risk ?? false,
      lot_size: parsed.data.lot_size ?? null,
      notes: parsed.data.notes ?? null,
      exit_time: parsed.data.exit_time ?? null,
    };
    const computed = computeTradeFields(tradeData);

    const { data, error } = await supabase
      .from("trades")
      .insert(computed)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
