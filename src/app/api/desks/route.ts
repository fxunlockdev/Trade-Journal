import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDeskSchema } from "@/lib/validators/desk";
import { assertJournalsAccessible } from "@/lib/reports/desk-access";

/**
 * Desks: named, branded sets of journals that posters publish for.
 *
 * Unlike `trades` — deliberate deny-all RLS, server-only — `report_desks` has
 * real policies scoped to `owner_user_id = auth.uid()`, so these routes use the
 * RLS client and let the database enforce ownership. The one thing RLS cannot
 * check is that the journals a desk NAMES are journals the caller may see:
 * `journal_ids` is an array and arrays carry no foreign key. That check is
 * `assertJournalsAccessible`, and skipping it would let anyone brand and
 * publish a poster over someone else's book.
 */

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

    const { data, error } = await supabase
      .from("report_desks")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

    const body: unknown = await request.json();
    const parsed = createDeskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const denied = await assertJournalsAccessible(
      supabase,
      user.id,
      parsed.data.journal_ids,
    );
    if (denied) return denied;

    const { data, error } = await supabase
      .from("report_desks")
      .insert({ ...parsed.data, owner_user_id: user.id })
      .select()
      .single();

    if (error) {
      // The unique index is on (owner, lower(name)), so a clash is a duplicate
      // desk name — worth saying plainly rather than surfacing a Postgres code.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "You already have a desk with that name." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
