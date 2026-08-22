import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

/**
 * Guards the two ways the proxy used to lose a session.
 *
 * Neither failed loudly. Sign-in worked, then a request or two later the user
 * was signed out again, because Supabase rotates refresh tokens: once the
 * server issues a new one and the browser never receives it, the copy the
 * browser still holds is dead.
 */

// Captures the cookie adapter the client hands to Supabase, so the test can
// fire setAll() the way a real token refresh would.
const captured: { setAll?: (c: Array<{ name: string; value: string; options?: object }>) => void } = {};

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: typeof captured.setAll } }) => {
    captured.setAll = opts.cookies.setAll;
    return {};
  },
}));

const { createMiddlewareClient } = await import("@/lib/supabase/middleware");
const { NextRequest } = await import("next/server");

function client() {
  return createMiddlewareClient(new NextRequest("https://fx-apps.test/"));
}

/** What Supabase writes when it rotates the access token. */
function simulateTokenRefresh() {
  captured.setAll?.([
    { name: "sb-test-auth-token", value: "rotated-value", options: { path: "/" } },
  ]);
}

describe("createMiddlewareClient", () => {
  beforeEach(() => {
    captured.setAll = undefined;
  });

  it("exposes cookies written AFTER construction", () => {
    const { getResponse } = client();

    simulateTokenRefresh();

    // The old shape returned `response` by value, so the caller held the
    // pre-refresh object and this cookie was written to an orphan.
    expect(getResponse().cookies.get("sb-test-auth-token")?.value).toBe("rotated-value");
  });

  it("carries refreshed cookies onto a redirect", () => {
    const { withAuthCookies } = client();

    simulateTokenRefresh();
    const redirect = withAuthCookies(
      NextResponse.redirect(new URL("https://fx-apps.test/")),
    );

    // Every redirect and rewrite in the proxy is a fresh response object, which
    // starts with no cookies at all.
    expect(redirect.cookies.get("sb-test-auth-token")?.value).toBe("rotated-value");
  });

  it("carries refreshed cookies onto a rewrite", () => {
    const { withAuthCookies } = client();

    simulateTokenRefresh();
    const rewrite = withAuthCookies(
      NextResponse.rewrite(new URL("https://fx-apps.test/locked")),
    );

    expect(rewrite.cookies.get("sb-test-auth-token")?.value).toBe("rotated-value");
  });

  it("leaves a response alone when nothing was refreshed", () => {
    const { withAuthCookies } = client();

    const redirect = withAuthCookies(
      NextResponse.redirect(new URL("https://fx-apps.test/login")),
    );

    expect(redirect.cookies.getAll()).toHaveLength(0);
  });
});
