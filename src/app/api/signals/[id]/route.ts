import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateSignalStatusSchema } from "@/lib/validators/signal";
import { isValidTransition } from "@/lib/constants/signal-status";
import type { SignalStatus } from "@/types/database";

type RouteContext = { params: Promise<{ id: string }> };

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

    const { data: existing, error: fetchError } = await supabase
      .from("signals")
      .select("status")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Signal not found" },
        { status: 404 },
      );
    }

    const currentStatus = existing.status as SignalStatus;
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

    await supabase.from("signal_events").insert({
      signal_id: id,
      event_type: newStatus,
      metadata: { previous_status: currentStatus },
    });

    return NextResponse.json({ data: updated });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
