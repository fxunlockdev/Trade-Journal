import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChatMessage } from "@/types/database";

export async function GET(): Promise<NextResponse> {
  try {
    // Auth check via SSR client
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use admin client to bypass RLS for reads (still filtered by user_id)
    const adminDB = createAdminClient();
    const { data, error } = await adminDB
      .from("chat_messages")
      .select("id, user_id, role, content, metadata, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[chat/history] fetch error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Reverse to chronological order
    const reversed = [...(data ?? [])].reverse();

    return NextResponse.json({
      data: reversed as ChatMessage[],
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
