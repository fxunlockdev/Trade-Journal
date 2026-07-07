import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Revoke a Myfxbook connection (soft delete). Also blanks the stored
 * credentials + session — a revoked row keeps its sync history but can never
 * authenticate again, even if the DB leaks later.
 */
export async function DELETE(
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

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("myfxbook_connections")
      .select("id, user_id, revoked_at")
      .eq("id", id)
      .maybeSingle();

    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (existing.revoked_at) {
      return NextResponse.json({ error: "Already revoked" }, { status: 409 });
    }

    const { error } = await admin
      .from("myfxbook_connections")
      .update({
        revoked_at: new Date().toISOString(),
        email_encrypted: "",
        password_encrypted: "",
        session_token: null,
      })
      .eq("id", id);

    if (error) {
      console.error("[myfxbook DELETE] revoke failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
