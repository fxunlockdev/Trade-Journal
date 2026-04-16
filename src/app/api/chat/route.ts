import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { createTradeSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { parseTradeAction } from "@/lib/chat/parse-action";
import type { Trade, ChatMessage } from "@/types/database";

interface ChatRequestBody {
  readonly message: string;
}

function isValidChatRequest(body: unknown): body is ChatRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return typeof obj.message === "string" && obj.message.trim().length > 0;
}

async function loadChatHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ReadonlyArray<{ role: "user" | "assistant"; content: string }>> {
  const { data } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!data) return [];

  return data
    .reverse()
    .filter(
      (msg: { role: string; content: string }) =>
        msg.role === "user" || msg.role === "assistant",
    )
    .map((msg: { role: string; content: string }) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));
}

async function saveChatMessage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  role: ChatMessage["role"],
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await supabase.from("chat_messages").insert({
    user_id: userId,
    role,
    content,
    metadata,
  });
}

async function createTradeFromAction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  actionData: Record<string, unknown>,
): Promise<Trade | null> {
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
    return null;
  }

  const tradeData = {
    ...parsed.data,
    exit_price: parsed.data.exit_price ?? null,
    stop_loss: parsed.data.stop_loss ?? null,
    take_profit: parsed.data.take_profit ?? null,
  };

  const computed = computeTradeFields(tradeData);

  const { data, error } = await supabase
    .from("trades")
    .insert(computed)
    .select()
    .single();

  if (error) {
    return null;
  }

  return data as Trade;
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

    const body: unknown = await request.json();

    if (!isValidChatRequest(body)) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 },
      );
    }

    const client = new OpenAI({ apiKey });
    const currentDatetime = new Date().toISOString();

    // Load previous chat history for context
    const previousMessages = await loadChatHistory(supabase, user.id);

    // Build conversation input for Responses API
    const inputMessages = [
      ...previousMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: "user" as const, content: body.message },
    ];

    // Save user message before calling AI
    await saveChatMessage(supabase, user.id, "user", body.message);

    // Call OpenAI Responses API with gpt-5.4
    const response = await client.responses.create({
      model: "gpt-5.4",
      instructions: buildSystemPrompt(currentDatetime),
      input: inputMessages,
      temperature: 0.3,
      max_output_tokens: 2048,
    });

    const aiContent = response.output_text ?? "";

    // Check if AI response contains a trade action
    const tradeAction = parseTradeAction(aiContent);
    let createdTrade: Trade | null = null;

    if (tradeAction) {
      createdTrade = await createTradeFromAction(
        supabase,
        user.id,
        tradeAction.data as unknown as Record<string, unknown>,
      );

      await saveChatMessage(supabase, user.id, "assistant", aiContent, {
        trade_id: createdTrade?.id ?? null,
        action: "create_trade",
      });
    } else {
      await saveChatMessage(supabase, user.id, "assistant", aiContent);
    }

    return NextResponse.json({
      message: aiContent,
      trade: createdTrade ?? undefined,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
