import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mt5WebhookSchema } from "@/lib/validators/mt5";
import { computeTradeFields } from "@/lib/trades/computations";
import type { CreateTrade } from "@/types/database";

function detectAssetType(
  symbol: string,
): "forex" | "crypto" | "metal" {
  const upper = symbol.toUpperCase();
  if (upper.startsWith("XAU") || upper.startsWith("XAG")) return "metal";
  if (upper.endsWith("USDT") || upper.endsWith("BTC")) return "crypto";
  return "forex";
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    const webhookSecret = process.env.MT5_WEBHOOK_SECRET;

    if (!webhookSecret || token !== webhookSecret) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body: unknown = await request.json();
    const parsed = mt5WebhookSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "Validation failed",
        },
        { status: 400 },
      );
    }

    if (parsed.data.secret !== webhookSecret) {
      return NextResponse.json(
        { success: false, error: "Invalid secret" },
        { status: 401 },
      );
    }

    const userIdHeader = request.headers.get("x-user-id");
    const apiKeyHeader = request.headers.get("x-api-key");
    const userId = userIdHeader ?? apiKeyHeader;

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: "x-user-id or x-api-key header is required to identify the user",
        },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    const { data: userExists } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .single();

    if (!userExists) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 },
      );
    }

    const tradesToInsert = parsed.data.trades.map((mt5Trade) => {
      const baseTrade: CreateTrade = {
        user_id: userId,
        instrument: mt5Trade.instrument.toUpperCase(),
        asset_type: detectAssetType(mt5Trade.instrument),
        direction: mt5Trade.type,
        entry_price: mt5Trade.open_price,
        exit_price: mt5Trade.close_price,
        quantity: mt5Trade.volume,
        lot_size: mt5Trade.volume,
        stop_loss: null,
        take_profit: null,
        fees: Math.abs(mt5Trade.commission) + Math.abs(mt5Trade.swap),
        notes: null,
        tags: ["mt5-webhook"],
        entry_time: mt5Trade.open_time,
        exit_time: mt5Trade.close_time,
        source: "mt5_webhook",
      };

      return computeTradeFields(baseTrade);
    });

    const { error: insertError } = await supabase
      .from("trades")
      .insert(tradesToInsert);

    if (insertError) {
      return NextResponse.json(
        { success: false, error: insertError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: { imported: tradesToInsert.length },
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
