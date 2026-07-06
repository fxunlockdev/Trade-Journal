import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mt5Connection } from "@/types/database";
import { extractBearerToken, hashConnectorToken } from "@/lib/mt5/token";

/**
 * Resolve the MT5 connection for a bearer token. Central so /api/mt5/ping and
 * /api/mt5/trades authenticate identically. Distinguishes "revoked" from
 * "unknown" so the EA can log an actionable message.
 */
export type Mt5AuthResult =
  | { readonly ok: true; readonly connection: Mt5Connection }
  | {
      readonly ok: false;
      readonly status: 401;
      readonly reason: "missing_token" | "unknown_token" | "token_revoked";
    };

export async function resolveMt5Connection(
  admin: SupabaseClient,
  authorizationHeader: string | null,
): Promise<Mt5AuthResult> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return { ok: false, status: 401, reason: "missing_token" };
  }

  const { data } = await admin
    .from("mt5_connections")
    .select("*")
    .eq("token_hash", hashConnectorToken(token))
    .maybeSingle();

  if (!data) {
    return { ok: false, status: 401, reason: "unknown_token" };
  }

  const connection = data as Mt5Connection;
  if (connection.revoked_at) {
    return { ok: false, status: 401, reason: "token_revoked" };
  }

  return { ok: true, connection };
}

/** Human message per auth failure — surfaced in the EA's Experts log. */
export function mt5AuthErrorMessage(
  reason: "missing_token" | "unknown_token" | "token_revoked",
): string {
  switch (reason) {
    case "token_revoked":
      return "This MT5 token was revoked. Generate a new one in Settings → MT5 Sync.";
    case "unknown_token":
      return "Unknown MT5 token. Check the ApiToken input on the EA.";
    case "missing_token":
    default:
      return "Missing bearer token.";
  }
}
