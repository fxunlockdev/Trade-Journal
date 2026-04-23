import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { JournalRole } from "@/types/database";

/**
 * Member management for a single (journal, user) pair.
 *
 * PATCH  — change role (owner only; cannot change own role; cannot promote
 *          to owner — ownership transfer is a separate future feature)
 * DELETE — kick (owner only) or leave (self). The
 *          `prevent_removing_last_owner` trigger blocks demoting/removing
 *          the final owner.
 */

type RouteContext = {
  params: Promise<{ id: string; userId: string }>;
};

const patchSchema = z.object({
  role: z.enum(["member", "viewer"]),
});

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id, userId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Owner-only gate
    const { data: myMembership } = await supabase
      .from("journal_members")
      .select("role")
      .eq("journal_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!myMembership || myMembership.role !== "owner") {
      return NextResponse.json(
        { error: "Only journal owners can change member roles." },
        { status: 403 },
      );
    }

    if (userId === user.id) {
      return NextResponse.json(
        { error: "You can't change your own role." },
        { status: 400 },
      );
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

    // Admin client — owner gate + self-check enforced above.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("journal_members")
      .update({ role: parsed.data.role })
      .eq("journal_id", id)
      .eq("user_id", userId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[members/PATCH]", error.message);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
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
    const { id, userId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: myMembership } = await supabase
      .from("journal_members")
      .select("role")
      .eq("journal_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!myMembership) {
      return NextResponse.json(
        { error: "You are not a member of this journal." },
        { status: 403 },
      );
    }

    const isSelf = userId === user.id;
    const isOwnerRemoval = !isSelf && myMembership.role !== "owner";

    // Either owner kicking someone else, OR self-leave (non-owner).
    if (isOwnerRemoval) {
      return NextResponse.json(
        { error: "Only owners can remove other members." },
        { status: 403 },
      );
    }

    // Admin client — owner/self gate enforced above. The
    // prevent_removing_last_owner trigger still runs and blocks the final
    // owner deletion.
    const admin = createAdminClient();
    const { error, count } = await admin
      .from("journal_members")
      .delete({ count: "exact" })
      .eq("journal_id", id)
      .eq("user_id", userId);

    if (error) {
      // Trigger error "Cannot remove the last owner..." bubbles up here
      console.error("[members/DELETE]", error.message);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!count) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
