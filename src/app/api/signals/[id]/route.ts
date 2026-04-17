import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateSignalStatusSchema } from "@/lib/validators/signal";
import { isValidTransition } from "@/lib/constants/signal-status";
import type { SignalStatus } from "@/types/database";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Ownership helper: a signal can be accessed by its trader_id owner
 * or by any admin. Returns `{ allowed: true, isAdmin }` when permitted.
 */
async function checkSignalAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  signalId: string,
): Promise<
  | { allowed: false; status: 404 | 403 }
  | { allowed: true; isAdmin: boolean; signal: { trader_id: string; status: SignalStatus } }
> {
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();
  const isAdmin = profile?.role === "admin";

  const { data: signal, error } = await supabase
    .from("signals")
    .select("trader_id, status")
    .eq("id", signalId)
    .single();

  if (error || !signal) {
    return { allowed: false, status: 404 };
  }

  if (!isAdmin && signal.trader_id !== userId) {
    // Disguise existence: return 404 instead of 403 to avoid ID enumeration.
    return { allowed: false, status: 404 };
  }

  return {
    allowed: true,
    isAdmin,
    signal: {
      trader_id: signal.trader_id as string,
      status: signal.status as SignalStatus,
    },
  };
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await checkSignalAccess(supabase, user.id, id);
    if (!access.allowed) {
      return NextResponse.json(
        { error: "Signal not found" },
        { status: access.status },
      );
    }

    // Now fetch the full signal row — ownership already verified.
    const { data: signal, error: signalError } = await supabase
      .from("signals")
      .select("*")
      .eq("id", id)
      .single();

    if (signalError) {
      return NextResponse.json(
        { error: signalError.message },
        { status: signalError.code === "PGRST116" ? 404 : 500 },
      );
    }

    const { data: events, error: eventsError } = await supabase
      .from("signal_events")
      .select("*")
      .eq("signal_id", id)
      .order("created_at", { ascending: true });

    if (eventsError) {
      return NextResponse.json(
        { error: eventsError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: {
        signal,
        events: events ?? [],
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
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
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await request.json();
    const parsed = updateSignalStatusSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const access = await checkSignalAccess(supabase, user.id, id);
    if (!access.allowed) {
      return NextResponse.json(
        { error: "Signal not found" },
        { status: access.status },
      );
    }

    const currentStatus = access.signal.status;
    const newStatus = parsed.data.status;

    if (!isValidTransition(currentStatus, newStatus)) {
      return NextResponse.json(
        {
          error: `Invalid status transition from ${currentStatus} to ${newStatus}`,
        },
        { status: 400 },
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("signals")
      .update({ status: newStatus })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 },
      );
    }

    const { error: eventError } = await supabase.from("signal_events").insert({
      signal_id: id,
      event_type: newStatus,
      metadata: { previous_status: currentStatus },
    });

    if (eventError) {
      console.error("[TRDR] signal_events insert failed:", eventError.message);
    }

    return NextResponse.json({ data: updated });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
