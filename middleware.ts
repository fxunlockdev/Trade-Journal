import { type NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  // Refresh the session cookie on every request so access tokens don't expire.
  // Do NOT remove this — it's how Supabase SSR keeps sessions alive.
  await supabase.auth.getUser();

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
