import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived credential for the render page.
 *
 * The renderer drives a headless browser, which loads `/render/poster/...` with
 * no cookies and no session — so the page cannot be protected the way the rest
 * of the app is. A signed token in the URL is the credential instead.
 *
 * Stateless HMAC rather than a row in a table: a render token is used once,
 * seconds after it is minted, by a process we started. Persisting one would add
 * a write, a read and a cleanup job to buy nothing.
 *
 * Signed with CRON_SECRET, which already exists as a server-only shared secret
 * and never reaches a browser. If it is unset the renderer refuses to mint or
 * verify anything rather than falling back to an unsigned URL.
 */

const TTL_SECONDS = 300;

export interface RenderClaims {
  readonly snapshotId: string;
  /** Which poster design to draw. */
  readonly style: string;
  /** Unix seconds. */
  readonly exp: number;
}

function secret(): string | null {
  const s = process.env.CRON_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** base64url of the claims, plus its signature. */
export function createRenderToken(
  snapshotId: string,
  style: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string | null {
  const key = secret();
  if (!key) return null;
  const claims: RenderClaims = {
    snapshotId,
    style,
    exp: nowSeconds + TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

/**
 * Verify and decode, or null.
 *
 * Null for every failure mode — bad shape, wrong signature, expired, no secret
 * configured — because the caller's response is the same in all of them and
 * distinguishing them in an error message tells an attacker which part they got
 * right.
 */
export function verifyRenderToken(
  token: string,
  // Defaulted rather than read inside the caller: reading the clock during a
  // render is impure (react-hooks/purity), and injecting it is what makes the
  // expiry testable. Same shape as lookbackCutoffIso in lib/posters/scope.ts.
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RenderClaims | null {
  const key = secret();
  if (!key) return null;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  const expected = sign(payload, key);
  // Constant-time, and length-guarded because timingSafeEqual throws on a
  // length mismatch rather than returning false.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claims: RenderClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof claims?.snapshotId !== "string" ||
    typeof claims?.style !== "string" ||
    typeof claims?.exp !== "number"
  ) {
    return null;
  }
  // Expiry is checked AFTER the signature, so an expired token still costs an
  // attacker a valid signature to learn anything.
  if (claims.exp <= nowSeconds) return null;

  return claims;
}
