import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { allowRequest, clientIp, maybePrune, LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/rebate/lead
 *
 * Lead capture for the Rebate Calculator. The browser used to call the database
 * function directly, which left no place to rate-limit an anonymous, unauthenticated
 * write. Going through a route means the server sees the real client IP and can
 * cap submissions before touching the database.
 *
 * Validation still lives in capture_rebate_lead() — this is defence in depth,
 * not a replacement for it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();

    const ip = clientIp(request);
    if (!(await allowRequest(supabase, LIMITS.rebateLead, ip))) {
      return NextResponse.json(
        { error: "Too many submissions. Try again a little later." },
        { status: 429 },
      );
    }
    void maybePrune(supabase);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown, max: number) =>
      typeof v === "string" ? v.trim().slice(0, max) : "";

    const name = str(body.name, 120);
    const email = str(body.email, 200);
    const phone = str(body.phone, 40);
    const assetClass = str(body.assetClass, 20);
    const monthlyLots = Number(body.monthlyLots);
    const estimate = Number(body.estimatedRebate);

    if (!name || !email || !phone) {
      return NextResponse.json({ error: "Name, email and phone are required." }, { status: 400 });
    }
    if (!Number.isFinite(monthlyLots) || monthlyLots < 0) {
      return NextResponse.json({ error: "Invalid volume." }, { status: 400 });
    }

    const { error } = await supabase.rpc("capture_rebate_lead", {
      p_name: name,
      p_email: email,
      p_phone: phone,
      p_asset_class: assetClass,
      p_monthly_lots: monthlyLots,
      p_estimated_rebate: Number.isFinite(estimate) ? Math.round(estimate) : null,
      p_meta: { source: "rebate-calculator" },
    });

    if (error) {
      // The database function raises human-readable validation messages.
      return NextResponse.json(
        { error: error.message.replace(/^.*?:\s*/, "") },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save your details." }, { status: 500 });
  }
}
