import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncMyfxbookConnection } from "@/lib/myfxbook/sync";
import type { MyfxbookConnection } from "@/types/database";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Manual "Sync now" for one connection (owner only). Also the target of the
 * journal page's sync-on-visit trigger. Myfxbook round-trips are spaced
 * ≥1.2s, so a pass can take ~10s.
 */
export const maxDuration = 60;

export async function POST(
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
    const { data: connection } = await admin
      .from("myfxbook_connections")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!connection || connection.user_id !== user.id) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (connection.revoked_at) {
      return NextResponse.json({ error: "Connection is revoked" }, { status: 409 });
    }

    const outcome = await syncMyfxbookConnection(
      admin,
      connection as MyfxbookConnection,
    );

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: 502 });
    }
    return NextResponse.json({ data: outcome.result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
