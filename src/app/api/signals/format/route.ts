import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formatSignalWithAI } from "@/lib/signals/formatter";
import { isTrader } from "@/lib/constants/roles";
import type { Signal } from "@/types/database";

/**
 * Ad-hoc signal payload schema (when no signal_id is provided, the client is
 * asking us to format a draft in memory). Strict to prevent field injection.
 */
const draftSignalSchema = z
  .object({
    instrument: z.string().min(1).max(32),
    direction: z.enum(["buy", "sell"]),
    entry_price: z.number().finite(),
    stop_loss: z.number().finite(),
    tp1: z.number().finite().nullable().optional(),
    tp2: z.number().finite().nullable().optional(),
    tp3: z.number().finite().nullable().optional(),
    tp4: z.number().finite().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

const bodySchema = z.union([
  z.object({ signal_id: z.string().uuid() }).strict(),
  draftSignalSchema,
]);

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

    // Only traders/admins can format signals.
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = (profile?.role as string | undefined) ?? "user";
    const isAdmin = role === "admin";
    if (!isAdmin && !isTrader(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const raw: unknown = await request.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const payload = parsed.data;
    let signal: Signal;
    let signalId: string | null = null;

    if ("signal_id" in payload) {
      signalId = payload.signal_id;
      // Ownership-scoped fetch: admin bypass, otherwise must own the row.
      const query = supabase.from("signals").select("*").eq("id", signalId);
      if (!isAdmin) query.eq("trader_id", user.id);
      const { data, error } = await query.single();

      if (error || !data) {
        return NextResponse.json(
          { error: "Signal not found" },
          { status: 404 },
        );
      }
      signal = data as Signal;
    } else {
      // Draft formatting — build a synthetic signal object (not persisted).
      signal = {
        ...payload,
        tp1: payload.tp1 ?? null,
        tp2: payload.tp2 ?? null,
        tp3: payload.tp3 ?? null,
        tp4: payload.tp4 ?? null,
        notes: payload.notes ?? null,
      } as unknown as Signal;
    }

    const message = await formatSignalWithAI(signal);

    if (signalId) {
      const updateQuery = supabase
        .from("signals")
        .update({ formatted_message: message })
        .eq("id", signalId);
      if (!isAdmin) updateQuery.eq("trader_id", user.id);
      const { error: updateError } = await updateQuery;

      if (updateError) {
        console.error(
          "[TRDR] signal format update failed:",
          updateError.message,
        );
        return NextResponse.json(
          { error: "Failed to save formatted message" },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ data: { message } });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
