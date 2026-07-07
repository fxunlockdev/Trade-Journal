/**
 * Thin Myfxbook REST client (https://www.myfxbook.com/api, v1.38).
 *
 * Realities this client encodes (verified against their docs Oct 2025):
 * - All methods are GET with query params; errors come back as HTTP 200 with
 *   `{error: true, message}` — always check the JSON, never the status code.
 * - Sessions are IP-BOUND with a ~1 month TTL. On serverless (rotating egress
 *   IPs) a cached session can die at any moment → callers re-login on
 *   "invalid session" using the stored encrypted credentials.
 * - Community-reported throttling: keep ≥1.2s between requests and back off
 *   on "Too many request"; repeated logins can trip "Max login attempts".
 * - get-history returns ONLY the last ~50 transactions (no pagination) — deep
 *   backfill is the report import's job, not the bridge's.
 */

const BASE_URL = "https://www.myfxbook.com/api";
/** Community-derived safe spacing between consecutive API calls. */
const REQUEST_SPACING_MS = 1300;

export interface MyfxbookAccount {
  /** Myfxbook entity id — used as `?id=` in data calls. */
  readonly id: number;
  /** Broker account (login) number. */
  readonly accountId: number;
  readonly name: string;
  readonly broker?: string;
  readonly currency?: string;
  readonly demo?: boolean;
  readonly lastUpdateDate?: string;
  readonly server?: { readonly name?: string };
}

export interface MyfxbookSizing {
  readonly type: string; // "lots" | "units" (OANDA)
  readonly value: string;
}

export interface MyfxbookHistoryRow {
  readonly openTime: string; // "MM/dd/yyyy HH:mm" — BROKER timezone
  readonly closeTime: string;
  readonly symbol: string;
  readonly action: string; // "Buy" | "Sell" | "Buy Limit" | … | "Deposit"…
  readonly sizing: MyfxbookSizing;
  readonly openPrice: number;
  readonly closePrice: number;
  readonly tp: number; // 0 = unset
  readonly sl: number; // 0 = unset
  readonly pips: number;
  readonly profit: number;
  readonly interest: number; // swap
  readonly commission: number;
  readonly comment?: string;
}

export interface MyfxbookOpenTradeRow {
  readonly openTime: string;
  readonly symbol: string;
  readonly action: string; // "Buy" | "Sell"
  readonly sizing: MyfxbookSizing;
  readonly openPrice: number;
  readonly tp: number;
  readonly sl: number;
  readonly pips: number;
  readonly profit: number;
  readonly swap?: number;
  readonly magic?: number;
  readonly comment?: string;
}

export class MyfxbookApiError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "invalid_credentials"
      | "invalid_session"
      | "rate_limited"
      | "login_locked"
      | "api_error",
  ) {
    super(message);
    this.name = "MyfxbookApiError";
  }
}

function classifyError(message: string): MyfxbookApiError {
  const m = message.toLowerCase();
  if (m.includes("wrong email") || m.includes("password")) {
    return new MyfxbookApiError(message, "invalid_credentials");
  }
  if (m.includes("invalid session")) {
    return new MyfxbookApiError(message, "invalid_session");
  }
  if (m.includes("too many request")) {
    return new MyfxbookApiError(message, "rate_limited");
  }
  if (m.includes("max login attempts")) {
    return new MyfxbookApiError(message, "login_locked");
  }
  return new MyfxbookApiError(message || "Myfxbook API error", "api_error");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;

async function apiGet<T>(
  method: string,
  params: Record<string, string>,
): Promise<T> {
  // Global spacing within this lambda instance — Myfxbook throttles bursts.
  const wait = lastRequestAt + REQUEST_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE_URL}/${method}.json?${qs}`, {
    // Myfxbook has no auth header — session rides in the query string.
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new MyfxbookApiError(`Myfxbook HTTP ${res.status}`, "api_error");
  }
  const json = (await res.json()) as { error?: boolean; message?: string } & T;
  if (json.error) throw classifyError(json.message ?? "");
  return json;
}

export async function myfxbookLogin(
  email: string,
  password: string,
): Promise<string> {
  const data = await apiGet<{ session?: string }>("login", {
    email,
    password,
  });
  if (!data.session) {
    throw new MyfxbookApiError("Login returned no session", "api_error");
  }
  return data.session;
}

export async function myfxbookLogout(session: string): Promise<void> {
  try {
    await apiGet("logout", { session });
  } catch {
    // Best-effort — an expired session is already logged out.
  }
}

export async function myfxbookGetAccounts(
  session: string,
): Promise<readonly MyfxbookAccount[]> {
  const data = await apiGet<{ accounts?: readonly MyfxbookAccount[] }>(
    "get-my-accounts",
    { session },
  );
  return data.accounts ?? [];
}

export async function myfxbookGetHistory(
  session: string,
  accountId: string,
): Promise<readonly MyfxbookHistoryRow[]> {
  const data = await apiGet<{ history?: readonly MyfxbookHistoryRow[] }>(
    "get-history",
    { session, id: accountId },
  );
  return data.history ?? [];
}

export async function myfxbookGetOpenTrades(
  session: string,
  accountId: string,
): Promise<readonly MyfxbookOpenTradeRow[]> {
  const data = await apiGet<{ openTrades?: readonly MyfxbookOpenTradeRow[] }>(
    "get-open-trades",
    { session, id: accountId },
  );
  return data.openTrades ?? [];
}
