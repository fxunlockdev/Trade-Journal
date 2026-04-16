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

    // Check secret from body
    const body = (await request.json()) as { secret?: string };
    const expectedSecret =
      process.env.BOOTSTRAP_SECRET ?? "fx-unlock-bootstrap-2024";

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
