import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { formatSignalWithAI } from "@/lib/signals/formatter";
import type { Signal } from "@/types/database";

export async function POST(request: NextRequest) {
  try {
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

    const body: unknown = await request.json();
    const signal = body as Signal;

    if (!signal.instrument || !signal.direction || !signal.entry_price) {
      return NextResponse.json(
        { success: false, error: "Invalid signal data" },
        { status: 400 },
      );
    }

    const message = await formatSignalWithAI(signal);

    return NextResponse.json({
      success: true,
      data: { message },
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
