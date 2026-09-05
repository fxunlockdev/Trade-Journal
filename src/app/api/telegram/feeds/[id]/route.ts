import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function ownedFeed(userId: string, id: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("telegram_feeds").select("id, user_id").eq("id", id).maybeSingle();
  return data && data.user_id === userId ? admin : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const admin = await ownedFeed(user.id, id);
    if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.defaultLots === "number" && body.defaultLots > 0 && body.defaultLots <= 1000) patch.default_lots = body.defaultLots;
    // The journal is fixed for a feed's life: its trades and their replies
    // are found by it. Disconnect and connect again to point elsewhere.
    if (typeof body.journalId === "string") {
      return NextResponse.json({ error: "Disconnect the room and connect it to the other journal." }, { status: 400 });
    }
    const { error: updateError } = await admin.from("telegram_feeds").update(patch).eq("id", id);
    if (updateError) return NextResponse.json({ error: "Couldn't update the room." }, { status: 503 });
    return NextResponse.json({ data: { id } });
  } catch (err: unknown) {
    console.error("[telegram/feeds] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const admin = await ownedFeed(user.id, id);
    if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // The trades stay: they are the journal's now. Only the listening stops.
    const { error: deleteError } = await admin.from("telegram_feeds").delete().eq("id", id);
    if (deleteError) return NextResponse.json({ error: "Couldn't disconnect the room." }, { status: 503 });
    return NextResponse.json({ data: { id } });
  } catch (err: unknown) {
    console.error("[telegram/feeds] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
