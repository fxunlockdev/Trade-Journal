import { type NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";

/**
 * Route gating for the FXU Home platform.
 *
 * This is UX, NOT authorization. It reads the `platform_role` claim that the
 * database mirrors into app_metadata, so it can gate a route without a DB
 * round-trip on every request. A claim can be stale (a token issued before a
 * demotion keeps the old role until it refreshes), so every /crm and /admin
 * server entry point independently re-checks entitlement against the database
 * via `requireProduct()` — and RLS is the final backstop.
 *
 * Behaviour by surface:
 *   /crm/**   without the `crm` product  -> locked screen (explains how to get access)
 *   /admin/** without the `admin` product -> 404 (never advertise the surface)
 */

type PlatformRole = "affiliate" | "ib" | "admin";

/** Mirrors public.role_products. Kept in sync by the W1 migration seed. */
const ROLE_PRODUCTS: Readonly<Record<PlatformRole, readonly string[]>> = {
  affiliate: ["journal"],
  ib: ["journal", "crm"],
  admin: ["journal", "crm", "admin"],
};

function claimGrants(role: string | undefined, product: string): boolean {
  if (role !== "affiliate" && role !== "ib" && role !== "admin") return false;
  return ROLE_PRODUCTS[role].includes(product);
}

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  // Refresh the session cookie on every request so access tokens don't expire.
  // Do NOT remove this — it's how Supabase SSR keeps sessions alive.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Already signed in? The sign-in page has nothing to offer — send them to
  // FXU Home, where the nav greets them and the app chooser lives. (Honours an
  // explicit ?next so an invite/deep link still reaches its destination.)
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    url.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const isCrm = pathname === "/crm" || pathname.startsWith("/crm/");
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  if (!isCrm && !isAdmin) return response;

  // Signed out: send to login with a relative-only return path.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const role = (user.app_metadata as { platform_role?: string } | null)
    ?.platform_role;

  // A token minted before the claim existed (or before a promotion) simply has
  // no platform_role. Blocking on that would 404 a genuine admin until their
  // token refreshed — a false negative, and a confusing one. So an ABSENT claim
  // is inconclusive, not a denial: fall through and let the page decide against
  // the database (getEntitlements -> notFound()/redirect). Nothing is loosened,
  // because the claim was never the authority — the server check and RLS are.
  const claimKnown = role === "affiliate" || role === "ib" || role === "admin";

  // Admin is invisible to everyone else: 404, not 403.
  if (isAdmin && claimKnown && !claimGrants(role, "admin")) {
    return NextResponse.rewrite(new URL("/404", request.url));
  }

  // CRM is a product they could legitimately be granted: explain, don't 404.
  if (isCrm && claimKnown && !claimGrants(role, "crm")) {
    const url = request.nextUrl.clone();
    url.pathname = "/locked";
    url.search = "?product=crm";
    return NextResponse.rewrite(url);
  }

  return response;
}

export const config = {
  // Match everything except:
  //  - static files (_next/static, _next/image)
  //  - favicon and common assets
  //  - public files in /public (.svg, .png, .jpg, etc.)
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
