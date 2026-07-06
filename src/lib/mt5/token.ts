import { createHash, randomBytes } from "crypto";

/**
 * MT5 connector token helpers.
 *
 * Tokens are long-lived credentials typed into the user's MT5 terminal, so
 * unlike short-lived journal-invite tokens they are NEVER stored in
 * plaintext: the DB keeps only a sha256 hash plus a short display prefix.
 * Server-only module (crypto) — do not import from client components.
 */

const TOKEN_PREFIX = "fxu_";
/** 24 random bytes → 48 hex chars. */
const TOKEN_RANDOM_BYTES = 24;
/** Characters of the plaintext token kept for display ("fxu_ab12cd34"). */
const DISPLAY_PREFIX_LENGTH = 12;

export interface GeneratedToken {
  /** Full plaintext token — show once, never persist. */
  readonly token: string;
  /** sha256 hex of the token — the only stored credential. */
  readonly tokenHash: string;
  /** Display-only prefix so the user can tell connections apart. */
  readonly tokenPrefix: string;
}

export function generateConnectorToken(): GeneratedToken {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_RANDOM_BYTES).toString("hex")}`;
  return {
    token,
    tokenHash: hashConnectorToken(token),
    tokenPrefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export function hashConnectorToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Extract a bearer token from an Authorization header. Returns null when the
 * header is missing/malformed or the token doesn't look like ours — callers
 * turn that into a 401 without hitting the database.
 */
export function extractBearerToken(
  authorizationHeader: string | null,
): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20) return null;
  return token;
}
