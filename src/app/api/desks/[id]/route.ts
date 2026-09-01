import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateDeskSchema } from "@/lib/validators/desk";
import { assertJournalsAccessible } from "@/lib/reports/desk-access";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A path segment reaches `.eq("id", …)` unvalidated otherwise, and PostgREST
 * answers a non-uuid with 22P02 — which the catch-all turns into a 500 quoting
 * `invalid input syntax for type uuid`. A bad id is a missing desk, not a
 * server fault.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Single-desk endpoints. Ownership is enforced by RLS
 * (`owner_user_id = auth.uid()`), so a desk belonging to someone else simply
 * does not exist to this client — no row comes back and the update affects
 * nothing. The explicit journal check below is the part RLS cannot do.
 */

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Desk not found" }, { status: 404 });
    }
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await request.json();
    const parsed = updateDeskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    // Only act on keys actually sent. `.partial()` still leaves every absent
    // key as undefined, and spreading those into an update would be a no-op
    // today but is exactly how a future `.default()` on this schema would
    // silently overwrite a field nobody touched.
    const sent = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(sent).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    if (parsed.data.journal_ids) {
      const denied = await assertJournalsAccessible(
        supabase,
        user.id,
        parsed.data.journal_ids,
      );
      if (denied) return denied;
    }

    const { data, error } = await supabase
      .from("report_desks")
      .update(sent)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "You already have a desk with that name." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Desk not found" }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Desk not found" }, { status: 404 });
    }
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // `.select()` so a delete that matched nothing is reported as a 404 rather
    // than a cheerful 200 — RLS makes someone else's desk look absent, and the
    // caller should be told the difference.
    const { data, error } = await supabase
      .from("report_desks")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Desk not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
