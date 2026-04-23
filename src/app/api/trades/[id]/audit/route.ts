import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/trades/[id]/audit — activity feed for a single trade.
 *
 * Returns every trade_audit_log row for the trade, oldest-first, with actor
 * display info attached so the UI can render "Alice edited exit_price".
 *
 * Auth: RLS on trade_audit_log restricts to members of the trade's journal.
 * We also resolve actor display info via the admin client to cheaply batch
 * the user_id → name/email lookup without N auth.users round-trips.
 */

type RouteContext = { params: Promise<{ id: string }> };

interface AuditRow {
  readonly id: string;
  readonly trade_id: string | null;
  readonly journal_id: string | null;
  readonly actor_user_id: string | null;
  readonly action: "created" | "updated" | "deleted";
  readonly changed_fields: readonly string[];
  readonly before_data: Record<string, unknown> | null;
  readonly after_data: Record<string, unknown> | null;
  readonly created_at: string;
}

interface ActorInfo {
  readonly id: string;
  readonly email: string | null;
  readonly full_name: string | null;
  readonly avatar_url: string | null;
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

    // RLS (audit_select) only returns rows the user can see
    const { data: rows, error } = await supabase
      .from("trade_audit_log")
      .select("*")
      .eq("trade_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[audit GET]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const auditRows = (rows ?? []) as AuditRow[];

    // Batch-lookup actor info via admin client (auth.users + public.users).
    // Null actors (e.g. migration backfill) just get skipped in the map.
    const actorIds = Array.from(
      new Set(
        auditRows
          .map((r) => r.actor_user_id)
          .filter((v): v is string => typeof v === "string"),
      ),
    );

    const actors: Record<string, ActorInfo> = {};
    if (actorIds.length > 0) {
      const admin = createAdminClient();
      const [authResult, profileResult] = await Promise.all([
        admin.auth.admin.listUsers({ perPage: 200 }),
        admin.from("users").select("id, full_name, avatar_url").in("id", actorIds),
      ]);
      const profiles = (profileResult.data ?? []) as Array<{
        id: string;
        full_name: string | null;
        avatar_url: string | null;
      }>;
      const profileMap = new Map(profiles.map((p) => [p.id, p]));
      for (const u of authResult.data?.users ?? []) {
        if (!actorIds.includes(u.id)) continue;
        const p = profileMap.get(u.id);
        actors[u.id] = {
          id: u.id,
          email: u.email ?? null,
          full_name: p?.full_name ?? null,
          avatar_url: p?.avatar_url ?? null,
        };
      }
    }

    return NextResponse.json({ data: auditRows, actors });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
