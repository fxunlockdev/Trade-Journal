import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { closeRenderer, renderPoster } from "@/lib/reports/render";
import { POSTER_TEMPLATES } from "@/lib/posters/templates";

/**
 * Render one report's posters, server-side.
 *
 * Node runtime and a raised duration because this starts a real Chromium and
 * draws three 1080x1080 images. `maxDuration` is set explicitly rather than
 * left to the platform default, which would kill a cold start mid-render.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const started = Date.now();
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // RLS scopes report_snapshots to its owner, so a snapshot belonging to
    // someone else simply is not here. No separate ownership check needed, and
    // no 403 that would confirm the id exists.
    const { data: snapshot } = await supabase
      .from("report_snapshots")
      .select("id, status, trade_count")
      .eq("id", id)
      .maybeSingle();

    if (!snapshot) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    if (snapshot.trade_count === 0) {
      return NextResponse.json(
        { error: "That period had no closed trades, so there is nothing to draw." },
        { status: 409 },
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!appUrl) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_APP_URL is not configured." },
        { status: 503 },
      );
    }

    const admin = createAdminClient();
    await admin
      .from("report_snapshots")
      .update({ status: "rendering", error: null })
      .eq("id", id);

    const results: { style: string; bytes: number; error?: string }[] = [];
    try {
      // Sequential, sharing one browser. Three tabs at once on a 1GB lambda is
      // how a render turns into an out-of-memory kill with no error.
      for (const template of POSTER_TEMPLATES) {
        try {
          const png = await renderPoster({
            snapshotId: id,
            style: template.id,
            appUrl,
          });
          results.push({ style: template.id, bytes: png.length });
        } catch (err: unknown) {
          // One broken style must not cost the other two. Recorded and carried
          // on with, per the partial-success rule.
          results.push({
            style: template.id,
            bytes: 0,
            error: err instanceof Error ? err.message : "render failed",
          });
        }
      }
    } finally {
      // A warm lambda would otherwise keep a Chromium alive between requests.
      await closeRenderer();
    }

    const failed = results.filter((r) => r.error);
    await admin
      .from("report_snapshots")
      .update({
        status: failed.length === results.length ? "failed" : "rendered",
        error: failed.length > 0 ? failed.map((f) => `${f.style}: ${f.error}`).join("; ") : null,
      })
      .eq("id", id);

    return NextResponse.json({
      data: {
        results,
        rendered: results.length - failed.length,
        failed: failed.length,
        ms: Date.now() - started,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
