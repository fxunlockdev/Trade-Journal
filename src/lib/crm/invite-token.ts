import "server-only";
import { randomBytes, createHash } from "node:crypto";

/**
 * CRM invite tokens.
 *
 * A raw token is 32 bytes of CSPRNG entropy, base64url-encoded. Only its
 * SHA-256 hash is ever stored (crm_invites.token_hash); the raw token lives
 * solely in the emailed /join/<token> URL and the one-time copy affordance.
 * Lookup is by hash, so comparison is inherently constant-time.
 */

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Invite lifetime — 72 hours. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
