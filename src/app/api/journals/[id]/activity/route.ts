import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/journals/[id]/activity — journal-wide activity feed.
 *
 * Recent trade_audit_log entries across all trades in the journal, newest
 * first. Used by the settings Activity tab to show "who did what" in the
 * shared workspace.
 *
 * Filters out rows with NULL `actor_user_id` — those come from the
 * migration backfill and would just show "Unknown edited …" noise.
 */

type RouteContext = { params: Promise<{ id: string }> };

interface AuditRow {
  readonly id: string;
  readonly trade_id: string | null;
  readonly journal_id: string | null;
  readonly actor_user_id: string;
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

const DEFAULT_LIMIT = 100;

export async function GET(
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

    // Caller must be a member (RLS will also enforce, but fail fast with 403)
    const { data: membership } = await supabase
      .from("journal_members")
      .select("role")
      .eq("journal_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { error: "You are not a member of this journal." },
        { status: 403 },
      );
    }

    const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200
      ? Math.floor(limitRaw)
      : DEFAULT_LIMIT;

    const { data: rows, error } = await supabase
      .from("trade_audit_log")
      .select("*")
      .eq("journal_id", id)
      .not("actor_user_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[journal/activity]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const auditRows = (rows ?? []) as AuditRow[];

    const actorIds = Array.from(
      new Set(auditRows.map((r) => r.actor_user_id)),
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
