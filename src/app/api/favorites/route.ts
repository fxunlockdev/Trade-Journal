import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Per-user favorite instruments API.
 *
 * Backing table: `public.user_favorite_instruments` (created by the RLS
 * migration in session notes). RLS auto-scopes rows to `auth.uid()`, so we
 * just use the SSR client — no admin client required for these endpoints.
 *
 * Shape:
 *   GET    → { favorites: string[] }          (oldest-first; UI keeps order)
 *   POST   { instrument } → upsert            → { favorites: string[] }
 *   DELETE ?instrument=XAUUSD                 → { favorites: string[] }
 */

const instrumentSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9._-]+$/i, "Invalid instrument format");

interface FavoritesResponse {
  readonly favorites: readonly string[];
}

async function listFavorites(userId: string): Promise<readonly string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_favorite_instruments")
    .select("instrument, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[favorites] list error:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: { instrument: string }) => row.instrument);
}

export async function GET(): Promise<NextResponse<FavoritesResponse | { error: string }>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const favorites = await listFavorites(user.id);
    return NextResponse.json({ favorites });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<FavoritesResponse | { error: string }>> {
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
    const parsed = z
      .object({ instrument: instrumentSchema })
      .safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed: instrument required" },
        { status: 400 },
      );
    }

    const instrument = parsed.data.instrument.toUpperCase();

    // Upsert — idempotent. Duplicates silently become no-ops thanks to the
    // unique (user_id, instrument) constraint + onConflict ignore behavior.
    const { error: upsertError } = await supabase
      .from("user_favorite_instruments")
      .upsert(
        { user_id: user.id, instrument },
        { onConflict: "user_id,instrument", ignoreDuplicates: true },
      );

    if (upsertError) {
      console.error("[favorites] upsert error:", upsertError.message);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    const favorites = await listFavorites(user.id);
    return NextResponse.json({ favorites });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
): Promise<NextResponse<FavoritesResponse | { error: string }>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const instrumentRaw = request.nextUrl.searchParams.get("instrument");
    const parsed = instrumentSchema.safeParse(instrumentRaw);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed: ?instrument=… required" },
        { status: 400 },
      );
    }

    const instrument = parsed.data.toUpperCase();
    const { error: deleteError } = await supabase
      .from("user_favorite_instruments")
      .delete()
      .eq("user_id", user.id)
      .eq("instrument", instrument);

    if (deleteError) {
      console.error("[favorites] delete error:", deleteError.message);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    const favorites = await listFavorites(user.id);
    return NextResponse.json({ favorites });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
