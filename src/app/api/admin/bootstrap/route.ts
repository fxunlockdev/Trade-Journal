import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    // Require explicit BOOTSTRAP_SECRET env var — no fallback.
    // Without this guard, anyone who knows the hardcoded default could
    // promote themselves to admin on a misconfigured deployment.
    const expectedSecret = process.env.BOOTSTRAP_SECRET;
    if (!expectedSecret || expectedSecret.length < 16) {
      console.error(
        "[TRDR] BOOTSTRAP_SECRET is not set or too short (<16 chars). Bootstrap endpoint disabled.",
      );
      return NextResponse.json(
        { error: "Bootstrap endpoint is not configured" },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { secret?: string };
    if (body.secret !== expectedSecret) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 403 });
    }

    // Set the authenticated user as admin
    const { error } = await supabase
      .from("users")
      .update({ role: "admin" })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `User ${user.email} is now admin`,
    });
  } catch (_err) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
