import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTradeSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";
import { canEditTrades, getActiveJournal } from "@/lib/journals/active-journal";

// Hard-coded allowlist — prevents arbitrary column injection via sort_by.
const SORT_ALLOWLIST = new Set([
  "entry_time", "exit_time", "instrument", "direction",
  "pnl_absolute", "pnl_percentage", "entry_price", "exit_price",
  "risk_reward_ratio", "r_multiple", "quantity",
] as const);

interface TradeListParams {
  readonly from?: string;
  readonly to?: string;
  readonly instrument?: string;
  readonly pnl_filter?: "profit" | "loss" | "all";
  readonly tags?: string;
  readonly journal?: string;
  readonly page: number;
  readonly limit: number;
  readonly sort_by: string;
  readonly sort_dir: "asc" | "desc";
}

function parseSearchParams(searchParams: URLSearchParams): TradeListParams {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));

  // Validate sort column against the allowlist; fall back to entry_time so
  // callers cannot inject arbitrary PostgREST expressions via the URL.
  const rawSort = searchParams.get("sort_by") ?? "entry_time";
  const sort_by = SORT_ALLOWLIST.has(rawSort as Parameters<typeof SORT_ALLOWLIST.has>[0])
    ? rawSort
    : "entry_time";

  const rawDir = searchParams.get("sort_dir");
  const sort_dir = rawDir === "asc" ? "asc" : "desc";

  // Extend `to` to end-of-day so trades logged at 14:30 on the selected day
  // are not dropped. Without this, Postgres coerces "2024-04-23" to midnight
  // and excludes everything after 00:00 on that date.
  const rawTo = searchParams.get("to");
  const to = rawTo ? `${rawTo}T23:59:59.999Z` : undefined;

  return {
    from: searchParams.get("from") ?? undefined,
    to,
    instrument: searchParams.get("instrument") ?? undefined,
    pnl_filter: (searchParams.get("pnl_filter") as TradeListParams["pnl_filter"]) ?? "all",
    tags: searchParams.get("tags") ?? undefined,
    journal: searchParams.get("journal") ?? undefined,
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

    // Resolve active journal. `?journal=<id>` overrides the cookie so bookmarked
    // URLs keep working. If neither resolves to a journal the user is a member
    // of, we fall back to their Personal journal.
    const { journal: activeJournal } = await getActiveJournal(
      supabase,
      user.id,
      params.journal,
    );

    const offset = (params.page - 1) * params.limit;

    // NOTE: we filter by `journal_id` (not `user_id`) so shared workspaces
    // show trades from every member. RLS still enforces membership as a
    // safety net if someone bypasses this filter.
    let query = supabase
      .from("trades")
      .select("*", { count: "exact" })
      .eq("journal_id", activeJournal.id);

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
        journal_id: activeJournal.id,
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
    const bodyObj = typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

    // The client form may include `journal_id` (once the form dropdown ships);
    // in the meantime, fall back to the cookie-resolved active journal.
    const requestedJournalId =
      typeof bodyObj.journal_id === "string" ? bodyObj.journal_id : undefined;

    const { journal: activeJournal, role } = await getActiveJournal(
      supabase,
      user.id,
      requestedJournalId,
    );

    if (!canEditTrades(role)) {
      return NextResponse.json(
        { error: "Viewers cannot create trades in this journal." },
        { status: 403 },
      );
    }

    const parsed = createTradeSchema.safeParse({
      ...bodyObj,
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
      journal_id: activeJournal.id,
      exit_price: parsed.data.exit_price ?? null,
      entry_price_high: parsed.data.entry_price_high ?? null,
      stop_loss: parsed.data.stop_loss ?? null,
      sl_pips: parsed.data.sl_pips ?? null,
      take_profit: legacyTp,
      tp1,
      tp2: parsed.data.tp2 ?? null,
      tp3: parsed.data.tp3 ?? null,
      tp4: parsed.data.tp4 ?? null,
      tp5: parsed.data.tp5 ?? null,
      tp6: parsed.data.tp6 ?? null,
      tp7: parsed.data.tp7 ?? null,
      tp1_pips: parsed.data.tp1_pips ?? null,
      tp2_pips: parsed.data.tp2_pips ?? null,
      tp3_pips: parsed.data.tp3_pips ?? null,
      tp4_pips: parsed.data.tp4_pips ?? null,
      tp5_pips: parsed.data.tp5_pips ?? null,
      tp6_pips: parsed.data.tp6_pips ?? null,
      tp7_pips: parsed.data.tp7_pips ?? null,
      tp1_result: parsed.data.tp1_result ?? null,
      tp2_result: parsed.data.tp2_result ?? null,
      tp3_result: parsed.data.tp3_result ?? null,
      tp4_result: parsed.data.tp4_result ?? null,
      tp5_result: parsed.data.tp5_result ?? null,
      tp6_result: parsed.data.tp6_result ?? null,
      tp7_result: parsed.data.tp7_result ?? null,
      tp4_trailing: parsed.data.tp4_trailing ?? false,
      order_type: parsed.data.order_type ?? "market",
      num_positions: parsed.data.num_positions ?? 1,
      split_risk: parsed.data.split_risk ?? false,
      lot_size: parsed.data.lot_size ?? null,
      notes: parsed.data.notes ?? null,
      exit_time: parsed.data.exit_time ?? null,
    };
    const computed = computeTradeFields(tradeData);

    // Bulletproof: re-apply user_id + journal_id AFTER computeTradeFields so
    // they cannot be overwritten by any stray key in the spread chain. These
    // two fields are what RLS checks against — if either is wrong, the INSERT
    // fails with "new row violates row-level security policy".
    const insertPayload = {
      ...computed,
      user_id: user.id,
      journal_id: activeJournal.id,
      // Broker provenance ("csv" / "mt5_webhook") is written ONLY by the import
      // and sync ingest, never by this public create endpoint. Force manual so a
      // client can't mint a fake broker-sourced trade that would then bypass the
      // P&L recompute guard on later edits.
      source: "manual" as const,
    };

    // Admin client — we've verified user auth + journal membership + role
    // above. SSR client's auth wasn't reliably carrying to trades INSERT
    // (triggered repeated RLS false-positives). Since we're hard-setting
    // user_id + journal_id from server-trusted values, this is safe.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("trades")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      // RLS violations often come back as "42501" or code starting "42".
      // Run an explicit membership diagnostic so the error message actually
      // tells the user what's wrong instead of the opaque Supabase default.
      const isRlsViolation =
        typeof error.code === "string" &&
        (error.code === "42501" || error.message.toLowerCase().includes("row-level security"));

      if (isRlsViolation) {
        const { data: diag } = await supabase
          .from("journal_members")
          .select("role")
          .eq("journal_id", activeJournal.id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!diag) {
          console.error("[trades/POST] RLS blocked: user not a member of resolved journal", {
            user_id: user.id,
            journal_id: activeJournal.id,
          });
          return NextResponse.json(
            {
              error:
                "Cannot log trade: your session isn't a member of the target journal. " +
                "Try refreshing the page or switching journals.",
            },
            { status: 403 },
          );
        }
        if (!["owner", "member"].includes(diag.role)) {
          return NextResponse.json(
            { error: `Your role in this journal (${diag.role}) cannot create trades.` },
            { status: 403 },
          );
        }
      }

      console.error("[trades/POST] insert failed", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        user_id: user.id,
        journal_id: activeJournal.id,
      });

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
