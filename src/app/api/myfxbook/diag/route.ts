import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { myfxbookDiagnostics } from "@/lib/myfxbook/client";

/**
 * Myfxbook connectivity diagnostics — visit /api/myfxbook/diag while logged
 * in. Runs INSIDE the deployed server, so it answers the questions a laptop
 * can't: does this deployment see MYFXBOOK_PROXY_URL, what exit IP does it
 * present, and can it reach Myfxbook through that path.
 *
 * Exposes no secrets (proxy host only, never credentials).
 */
export const maxDuration = 30;

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const diag = await myfxbookDiagnostics();
    return NextResponse.json({ data: diag });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
