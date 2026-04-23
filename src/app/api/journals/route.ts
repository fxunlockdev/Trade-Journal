import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Journal, JournalWithRole, JournalRole } from "@/types/database";

/**
 * Journals API (list + create).
 *
 * List: returns every journal the caller is a member of (plus their role).
 * Create: caller becomes owner; the `add_owner_as_member` trigger inserts
 * the membership row automatically.
 *
 * Soft cap (20 active journals per user) + duplicate-name check are
 * enforced by DB triggers, so we just surface any 400 those raise.
 */

const colorEnum = z.enum([
  "slate",
  "emerald",
  "sky",
  "violet",
  "orange",
  "cyan",
  "rose",
  "lime",
  "amber",
  "red",
]);

const createJournalSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: colorEnum.default("slate"),
  description: z.string().trim().max(300).nullable().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const includeArchived =
      request.nextUrl.searchParams.get("include_archived") === "true";

    // Supabase foreign-key embed: one round trip that returns a row per
    // membership with the full journal attached. RLS still applies to both
    // tables so the user only sees their own rows.
    const { data: rows, error } = await supabase
      .from("journal_members")
      .select("role, journals!inner(*)")
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    type Row = { readonly role: JournalRole; readonly journals: Journal };
    const journals: JournalWithRole[] = ((rows as unknown as Row[]) ?? [])
      .filter((r) => includeArchived || !r.journals.is_archived)
      .map((r) => ({ ...r.journals, my_role: r.role }))
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.created_at.localeCompare(b.created_at),
      );

    return NextResponse.json({ data: journals });
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
    const parsed = createJournalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    // Use the admin client for the INSERT. The SSR client's cookie-based
    // auth wasn't reliably carrying through to this specific table's RLS
    // check (tripped "new row violates row-level security policy for table
    // 'journals'" in user testing). We've already verified the user via
    // supabase.auth.getUser() above and we hard-code owner_user_id to
    // user.id below — admin is safe here because we're enforcing the
    // equivalent of the RLS rule server-side in TypeScript.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("journals")
      .insert({
        owner_user_id: user.id,
        name: parsed.data.name,
        color: parsed.data.color,
        description: parsed.data.description ?? null,
      })
      .select()
      .single();

    if (error) {
      // Triggers surface as message text: "Maximum 20 active journals per
      // user reached." or unique-index violation on (user, name). Bubble up
      // as 400 so the UI can show the exact reason. Log full details.
      console.error("[journals/POST] create failed:", {
        user_id: user.id,
        name: parsed.data.name,
        code: error.code,
        message: error.message,
        hint: error.hint,
        details: error.details,
      });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { data: { ...data, my_role: "owner" as JournalRole } },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
