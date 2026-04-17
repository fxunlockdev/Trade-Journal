import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeTradingStats } from "@/lib/insights/analyzer";
import {
  buildInsightsSystemPrompt,
  buildInsightsUserPrompt,
} from "@/lib/insights/prompt";
import type { TradeInsightsResult } from "@/lib/insights/prompt";
import type { Trade } from "@/types/database";

function parseInsightsJson(raw: string): TradeInsightsResult | null {
  try {
    return JSON.parse(raw) as TradeInsightsResult;
  } catch {
    // Fallback: extract first JSON object from text
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1)) as TradeInsightsResult;
    } catch {
      return null;
    }
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminDB = createAdminClient();
    const { data: row, error: fetchError } = await adminDB
      .from("trade_insights")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      return NextResponse.json(
        { error: "Failed to fetch insights" },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: row ?? null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminDB = createAdminClient();

    const { data: tradesData, error: tradesError } = await adminDB
      .from("trades")
      .select("*")
      .eq("user_id", user.id)
      .order("entry_time", { ascending: true });

    if (tradesError) {
      return NextResponse.json(
        { error: "Failed to fetch trades" },
        { status: 500 }
      );
    }

    const trades = (tradesData ?? []) as Trade[];

    if (trades.length < 3) {
      return NextResponse.json(
        { error: "Need at least 3 trades to generate insights" },
        { status: 400 }
      );
    }

    const stats = computeTradingStats(trades);

    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openaiClient.responses.create({
      model: "gpt-5.4",
      instructions: buildInsightsSystemPrompt(),
      input: buildInsightsUserPrompt(stats),
      temperature: 0.3,
      max_output_tokens: 1500,
    });

    const rawText = response.output_text ?? "";

    const parsedInsights = parseInsightsJson(rawText);

    if (!parsedInsights) {
      return NextResponse.json(
        { error: "Failed to parse AI response as JSON" },
        { status: 500 }
      );
    }

    const generatedAt = new Date().toISOString();

    const { error: upsertError } = await adminDB
      .from("trade_insights")
      .upsert(
        {
          user_id: user.id,
          insights: parsedInsights,
          stats_snapshot: stats,
          trades_analyzed: trades.length,
          generated_at: generatedAt,
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      return NextResponse.json(
        { error: "Failed to save insights" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: {
        insights: parsedInsights,
        stats_snapshot: stats,
        trades_analyzed: trades.length,
        generated_at: generatedAt,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
