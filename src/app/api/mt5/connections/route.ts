import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createMt5ConnectionSchema } from "@/lib/validators/mt5";
import { generateConnectorToken } from "@/lib/mt5/token";
import { canEditTrades, getActiveJournal } from "@/lib/journals/active-journal";

/**
 * MT5 connections — cookie-authenticated management endpoints used by the
 * Settings UI. The EA-facing ingest lives at /api/mt5/trades (bearer auth).
 *
 * POST returns the plaintext token exactly once; only the sha256 hash is
 * stored, so it can never be shown again (same model as GitHub PATs).
 */

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
    const parsed = createMt5ConnectionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    // Same authorization gate as POST /api/trades: the caller must be able
    // to create trades in the target journal (owner or member, not viewer).
    const { journal, role } = await getActiveJournal(
      supabase,
      user.id,
      parsed.data.journal_id,
    );
    if (journal.id !== parsed.data.journal_id || !canEditTrades(role)) {
      return NextResponse.json(
        { error: "You can't connect MT5 to this journal." },
        { status: 403 },
      );
    }

    const { token, tokenHash, tokenPrefix } = generateConnectorToken();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("mt5_connections")
      .insert({
        user_id: user.id,
        journal_id: journal.id,
        label: parsed.data.label ?? null,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
      })
      .select("id, journal_id, label, token_prefix, created_at")
      .single();

    if (error) {
      console.error("[mt5/connections POST] insert failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Plaintext token rides along exactly once.
    return NextResponse.json(
      { data: { ...data, journal_name: journal.name, token } },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

    // Admin read (SSR JWT drops intermittently on Vercel) — scoped to the
    // caller's rows, secrets excluded. Join journals for display names.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("mt5_connections")
      .select(
        "id, journal_id, label, token_prefix, account_login, broker, last_sync_at, revoked_at, created_at, journals(name, color)",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
