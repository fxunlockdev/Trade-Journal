import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageJournal } from "@/lib/journals/active-journal";
import type { JournalRole } from "@/types/database";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: z
      .enum([
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
      ])
      .optional(),
    description: z.string().trim().max(300).nullable().optional(),
    is_archived: z.boolean().optional(),
    // Account sizing. Blank input arrives as "" from the form, so treat blank
    // as "clear it" (null) rather than letting z.coerce turn it into 0 — the
    // same trap that made optional trade fields reject empty input.
    initial_capital: z
      .preprocess(
        (v) =>
          v === "" || (typeof v === "string" && v.trim() === "") ? null : v,
        z.coerce.number().positive().nullable(),
      )
      .optional(),
    account_currency: z.enum(["USD", "EUR", "GBP"]).optional(),
    default_risk_percent: z.coerce.number().positive().max(100).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

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

    const { data: journal, error } = await supabase
      .from("journals")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!journal) {
      return NextResponse.json({ error: "Journal not found" }, { status: 404 });
    }

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

    return NextResponse.json({
      data: { ...journal, my_role: membership.role as JournalRole },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
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

    const body: unknown = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    // Only owners may update
    const { data: membership } = await supabase
      .from("journal_members")
      .select("role")
      .eq("journal_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership || !canManageJournal(membership.role as JournalRole)) {
      return NextResponse.json(
        { error: "Only journal owners can update this journal." },
        { status: 403 },
      );
    }

    // Admin client for the UPDATE — we've already verified owner role above.
    // The SSR client's auth context isn't reliable for mutations on journals.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("journals")
      .update(parsed.data)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[journals/PATCH] update failed:", {
        id,
        user_id: user.id,
        code: error.code,
        message: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      data: { ...data, my_role: membership.role as JournalRole },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
