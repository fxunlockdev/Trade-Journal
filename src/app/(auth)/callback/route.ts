import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

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
