import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Validate the `next` redirect target to prevent open-redirect phishing.
 * Only same-origin, single-slash-prefixed paths are allowed.
 * Rejects: "//evil.com", "http://evil.com", "https://...", "javascript:..."
 */
function safeNextPath(raw: string | null): string {
  if (!raw) return "/dashboard";
  // Must start with "/" and must NOT start with "//" or "/\"
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) {
    return raw;
  }
  return "/dashboard";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

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

  const { error } = await supabase.auth.exchangeCodeForSession(code);

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

  return NextResponse.redirect(new URL(next, origin));
}
