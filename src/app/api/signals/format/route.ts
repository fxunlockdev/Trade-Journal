import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { formatSignalWithAI } from "@/lib/signals/formatter";
import type { Signal } from "@/types/database";

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

    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const payload = body as Record<string, unknown>;
    let signal: Signal;

    if (typeof payload.signal_id === "string") {
      const { data, error } = await supabase
        .from("signals")
        .select("*")
        .eq("id", payload.signal_id)
        .single();

      if (error || !data) {
        return NextResponse.json(
          { error: "Signal not found" },
          { status: 404 },
        );
      }

      signal = data as Signal;
    } else {
      signal = payload as unknown as Signal;
    }

    const message = await formatSignalWithAI(signal);

    if (typeof payload.signal_id === "string") {
      await supabase
        .from("signals")
        .update({ formatted_message: message })
        .eq("id", payload.signal_id);
    }

    return NextResponse.json({ data: { message } });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
