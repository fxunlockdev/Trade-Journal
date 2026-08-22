import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Supabase client for the proxy (Next 16's middleware).
 *
 * Two things here look like ceremony and are not. Both caused silent sign-outs.
 *
 * 1. The response lives in a box instead of being returned directly.
 *    setAll() fires when Supabase rotates the access token, and it has to build
 *    a NEW NextResponse to carry the new cookies. Returning `response` directly
 *    meant the caller destructured the PRE-refresh object and returned that;
 *    the refreshed cookies were written to an orphan and dropped. Since Supabase
 *    rotates refresh tokens, the browser kept a token the server had already
 *    replaced, and the session died a request or two later.
 *
 * 2. withAuthCookies() exists because a redirect or rewrite is a different
 *    response object, and creating one discards whatever setAll() just wrote.
 *    Any branch that does not return getResponse() has to carry the cookies
 *    across by hand, or it signs the user out on the way to wherever it is
 *    sending them.
 */
export function createMiddlewareClient(request: NextRequest) {
  const box = { response: NextResponse.next({ request }) };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          box.response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            box.response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  return {
    supabase,

    /** The live response, including any cookies written since construction. */
    getResponse(): NextResponse {
      return box.response;
    },

    /**
     * Copy the current auth cookies onto a redirect or rewrite, so following it
     * does not cost the user their freshly refreshed session.
     */
    withAuthCookies(target: NextResponse): NextResponse {
      for (const cookie of box.response.cookies.getAll()) {
        target.cookies.set(cookie);
      }
      return target;
    },
  };
}
