import { type NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";
import { isTrader } from "@/lib/constants/roles";

const PUBLIC_ROUTES = new Set(["/login", "/callback"]);
const API_MT5_PREFIX = "/api/mt5";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Skip auth for MT5 API routes (uses its own secret-based auth)
  if (pathname.startsWith(API_MT5_PREFIX)) {
    return response;
  }

  const isPublicRoute = PUBLIC_ROUTES.has(pathname);

  // Redirect authenticated users away from /login
  if (user && pathname === "/login") {
    const dashboardUrl = new URL("/dashboard", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  // Protect all (app) routes - require authentication
  if (!user && !isPublicRoute && !pathname.startsWith("/api/")) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Role-based protection for /signals routes
  if (user && pathname.startsWith("/signals")) {
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role ?? "user";

    if (!isTrader(role)) {
      const dashboardUrl = new URL("/dashboard", request.url);
      return NextResponse.redirect(dashboardUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
