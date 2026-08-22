import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { safeInternalPath } from "@/lib/safe-next";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Shared, hardened open-redirect guard (also strips control characters that
  // URL parsing would later normalise into a protocol-relative URL). Defaults
  // to FXU Home: you sign in to the PLATFORM and pick an app from there, rather
  // than being dropped inside one. A ?next set by middleware still wins.
  const next = safeInternalPath(searchParams.get("next"), "/");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=no_code", origin));
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );

  const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[TRDR Auth] exchangeCodeForSession failed:", error.message);
    console.error("[TRDR Auth] Code received:", code.substring(0, 8) + "...");
    console.error(
      "[TRDR Auth] Cookies present:",
      cookieStore
        .getAll()
        .map((c) => c.name)
        .join(", "),
    );
    return NextResponse.redirect(
      new URL(`/login?error=auth&detail=${encodeURIComponent(error.message)}`, origin),
    );
  }

  // The trader/IB answer chosen on the sign-up form rides along in
  // user_metadata, the only carrier that survives a confirmation link opened
  // hours later in a different browser. Applied here rather than on the client
  // so it lands even if the user never reaches the home page.
  //
  // record_signup_intent is write-once and validates the value itself, so a
  // forged metadata field escalates nothing: "ib" records a REQUEST an admin
  // still has to approve. A failure is deliberately swallowed, because
  // IntentPrompt will simply ask, and nobody should be locked out of signing in
  // over a preference that did not save.
  const intent = exchanged?.user?.user_metadata?.signup_intent;
  if (intent === "trader" || intent === "ib") {
    const { error: intentError } = await supabase.rpc("record_signup_intent", {
      p_intent: intent,
    });
    if (intentError) {
      console.warn("[FXU Auth] could not record signup intent:", intentError.message);
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
