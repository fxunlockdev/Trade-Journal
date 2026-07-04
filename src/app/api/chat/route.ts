import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenAIClient, OPENAI_MODEL, modelTuning } from "@/lib/openai/client";
import { createTradeSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";
import {
  TRADE_CHAT_SYSTEM_PROMPT,
  buildTurnContext,
} from "@/lib/chat/system-prompt";
import { parseTradeAction, getTradeParseErrors } from "@/lib/chat/parse-action";
import type { Trade, ChatMessage } from "@/types/database";

interface ChatRequestBody {
  readonly message: string;
}

function isValidChatRequest(body: unknown): body is ChatRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return typeof obj.message === "string" && obj.message.trim().length > 0;
}

type AdminDB = ReturnType<typeof createAdminClient>;

// History is only needed for short-range context (follow-ups like "add SL
// 76500" or "actually that was a sell"). 12 messages covers that; each is
// capped so a pasted multi-signal wall doesn't get re-billed on every
// subsequent turn.
const HISTORY_LIMIT = 12;
const HISTORY_MESSAGE_MAX_CHARS = 2000;

function capHistoryContent(content: string): string {
  if (content.length <= HISTORY_MESSAGE_MAX_CHARS) return content;
  return `${content.slice(0, HISTORY_MESSAGE_MAX_CHARS)}\n[...truncated]`;
}

async function loadChatHistory(
  adminDB: AdminDB,
  userId: string,
): Promise<ReadonlyArray<{ role: "user" | "assistant"; content: string }>> {
  const { data, error } = await adminDB
    .from("chat_messages")
    .select("role, content")
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    console.error("[chat] loadChatHistory error:", error.message);
    return [];
  }
  if (!data) return [];

  return [...data]
    .reverse()
    .map((msg: { role: string; content: string }) => ({
      role: msg.role as "user" | "assistant",
      content: capHistoryContent(msg.content),
    }));
}

async function saveChatMessage(
  adminDB: AdminDB,
  userId: string,
  role: ChatMessage["role"],
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await adminDB.from("chat_messages").insert({
    user_id: userId,
    role,
    content,
    metadata,
  });
  if (error) {
    console.error("[chat] saveChatMessage error:", error.message);
  }
}

interface TradeCreateResult {
  trade: Trade | null;
  error: string | null;
}

async function createTradeFromAction(
  adminDB: AdminDB,
  userId: string,
  actionData: Record<string, unknown>,
): Promise<TradeCreateResult> {
  const tags =
    typeof actionData.tags === "string"
      ? actionData.tags
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean)
      : [];

  const parsed = createTradeSchema.safeParse({
    ...actionData,
    tags,
    user_id: userId,
    source: "manual",
    exit_price: actionData.exit_price ?? null,
    stop_loss: actionData.stop_loss ?? null,
    take_profit: actionData.take_profit ?? null,
    lot_size: actionData.lot_size ?? null,
    exit_time: actionData.exit_time ?? null,
    notes: actionData.notes ?? null,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    console.error("[chat] trade schema validation failed:", fieldErrors);
    return { trade: null, error: `Validation failed: ${fieldErrors}` };
  }

  // Normalize all nullable fields to `null` (never `undefined`) and keep the
  // legacy `take_profit` column in sync with `tp1` so downstream readers
  // (insights analyzer, MT5 webhook consumers) don't drift. Mirrors the
  // normalization in `/api/trades` POST so AI-logged and UI-logged trades
  // are indistinguishable on the row level.
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

  const { data, error } = await adminDB
    .from("trades")
    .insert(computed)
    .select()
    .single();

  if (error) {
    console.error("[chat] trade insert error:", error.message, error.details, error.hint);
    return { trade: null, error: `DB error: ${error.message}` };
  }

  return { trade: data as Trade, error: null };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Auth check via SSR client (respects user session)
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await request.json();

    if (!isValidChatRequest(body)) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    // All DB operations use admin client to bypass RLS
    const adminDB = createAdminClient();
    const client = getOpenAIClient();
    const currentDatetime = new Date().toISOString();

    // Load memory (previous messages)
    const previousMessages = await loadChatHistory(adminDB, user.id);

    // Build conversation input for the Responses API. The datetime rides as
    // a per-turn system message so `instructions` stays byte-identical and
    // prompt-cacheable across every request.
    const inputMessages = [
      { role: "system" as const, content: buildTurnContext(currentDatetime) },
      ...previousMessages.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user" as const, content: body.message },
    ];

    // Save user message to memory BEFORE AI call
    await saveChatMessage(adminDB, user.id, "user", body.message);

    // Trade extraction is pattern-matching, not deep reasoning: low effort
    // (reasoning models) / low temperature (standard models) keeps logging
    // fast, cheap, and deterministic. max_output_tokens covers reasoning
    // tokens + the JSON block + confirmation line.
    let aiContent = "";
    try {
      const response = await client.responses.create(
        {
          model: OPENAI_MODEL,
          instructions: TRADE_CHAT_SYSTEM_PROMPT,
          input: inputMessages,
          ...modelTuning({ effort: "low", temperature: 0.2 }),
          max_output_tokens: 3000,
        },
        { timeout: 30_000 },
      );
      aiContent = response.output_text ?? "";
    } catch (openaiErr: unknown) {
      const msg = openaiErr instanceof Error ? openaiErr.message : "OpenAI error";
      console.error("[chat] OpenAI call failed:", msg);
      // Persist an assistant placeholder so the user's message isn't orphaned
      // in the transcript on reload. Without this, a failed call leaves a
      // dangling user bubble with no reply.
      await saveChatMessage(
        adminDB,
        user.id,
        "assistant",
        "I couldn't reach the AI right now. Please try again.",
        { error: msg, transient: true },
      );
      return NextResponse.json({ error: `AI error: ${msg}` }, { status: 500 });
    }

    if (!aiContent) {
      await saveChatMessage(
        adminDB,
        user.id,
        "assistant",
        "I received an empty response from the AI. Please try again.",
        { error: "empty_response", transient: true },
      );
      return NextResponse.json({ error: "Empty response from AI" }, { status: 500 });
    }

    // Try to detect and execute a trade action
    const tradeAction = parseTradeAction(aiContent);
    let createdTrade: Trade | null = null;
    let tradeError: string | null = null;

    if (tradeAction) {
      const result = await createTradeFromAction(
        adminDB,
        user.id,
        tradeAction.data as unknown as Record<string, unknown>,
      );
      createdTrade = result.trade;
      tradeError = result.error;

      await saveChatMessage(adminDB, user.id, "assistant", aiContent, {
        trade_id: createdTrade?.id ?? null,
        trade_error: tradeError,
        action: "create_trade",
      });
    } else {
      // Check if AI tried to create a trade but JSON was malformed
      const parseErrors = getTradeParseErrors(aiContent);
      if (parseErrors) {
        console.error("[chat] AI produced invalid trade JSON:", parseErrors);
        tradeError = `Trade JSON malformed: ${parseErrors}`;
      }

      await saveChatMessage(adminDB, user.id, "assistant", aiContent);
    }

    return NextResponse.json({
      message: aiContent,
      trade: createdTrade ?? undefined,
      tradeError: tradeError ?? undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[chat] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
