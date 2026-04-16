import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateSignalStatusSchema } from "@/lib/validators/signal";
import { isTrader, isAdmin } from "@/lib/constants/roles";
import type { Signal, SignalEvent, SignalStatus } from "@/types/database";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { data: signal, error: signalError } = await supabase
      .from("signals")
      .select("*")
      .eq("id", id)
      .single();

    if (signalError || !signal) {
      return NextResponse.json(
        { success: false, error: "Signal not found" },
        { status: 404 },
      );
    }

    const { data: events, error: eventsError } = await supabase
      .from("signal_events")
      .select("*")
      .eq("signal_id", id)
      .order("created_at", { ascending: true });

    if (eventsError) {
      return NextResponse.json(
        { success: false, error: eventsError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...(signal as Signal),
        events: (events ?? []) as SignalEvent[],
      },
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

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !isTrader(profile.role)) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { data: existingSignal, error: fetchError } = await supabase
      .from("signals")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !existingSignal) {
      return NextResponse.json(
        { success: false, error: "Signal not found" },
        { status: 404 },
      );
    }

    const body: unknown = await request.json();
    const { newStatus, metadata } = body as {
      newStatus: SignalStatus;
      metadata?: Record<string, unknown>;
    };

    const parsed = updateSignalStatusSchema.safeParse({
      currentStatus: existingSignal.status,
      newStatus,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "Invalid status transition",
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
        { success: false, error: updateError.message },
        { status: 500 },
      );
    }

    await supabase.from("signal_events").insert({
      signal_id: id,
      event_type: newStatus,
      metadata: { changed_by: user.id, ...metadata },
    });

    return NextResponse.json({
      success: true,
      data: updated as Signal,
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

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !isTrader(profile.role)) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { data: signal, error: fetchError } = await supabase
      .from("signals")
      .select("trader_id")
      .eq("id", id)
      .single();

    if (fetchError || !signal) {
      return NextResponse.json(
        { success: false, error: "Signal not found" },
        { status: 404 },
      );
    }

    if (signal.trader_id !== user.id && !isAdmin(profile.role)) {
      return NextResponse.json(
        { success: false, error: "You can only delete your own signals" },
        { status: 403 },
      );
    }

    await supabase.from("signal_events").delete().eq("signal_id", id);

    const { error: deleteError } = await supabase
      .from("signals")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(
        { success: false, error: deleteError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, data: null });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
