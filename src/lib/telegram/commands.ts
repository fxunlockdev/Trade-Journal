/**
 * Parsing what someone typed or tapped in Telegram.
 *
 * Pure and dependency-free, so the grammar is testable without a bot, a group,
 * or a network. Everything here treats its input as HOSTILE: a webhook payload
 * is an unauthenticated POST body until proven otherwise, and callback data is
 * a string the client chose. Nothing in this module grants access; it only says
 * what was asked for. Whether the asker may have it is decided elsewhere,
 * against the database.
 */

export type Cadence = "daily" | "weekly" | "monthly";

export const CADENCES: readonly Cadence[] = ["daily", "weekly", "monthly"];

export function isCadence(value: string): value is Cadence {
  return (CADENCES as readonly string[]).includes(value);
}

/**
 * The command in a message, or null.
 *
 * Telegram appends `@botname` when several bots are in a group, so `/daily` and
 * `/daily@TradingJournalImagesBot` are the same command. Anything after the
 * command word is ignored: these take no arguments, and quietly ignoring a
 * stray word beats refusing a command someone typed with a trailing space.
 */
export function parseCommand(text: string | undefined): Cadence | null {
  if (!text) return null;
  const first = text.trim().split(/\s+/)[0] ?? "";
  if (!first.startsWith("/")) return null;
  const word = first.slice(1).split("@")[0].toLowerCase();
  return isCadence(word) ? word : null;
}

/** Telegram's hard cap on callback_data. Exceed it and the button is rejected. */
export const CALLBACK_DATA_MAX = 64;

export interface PublishRequest {
  readonly cadence: Cadence;
  readonly deskId: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The payload behind a desk button.
 *
 * "pub:<cadence>:<uuid>" is 46 characters, comfortably inside the 64-byte cap.
 */
export function encodePublish(cadence: Cadence, deskId: string): string {
  return `pub:${cadence}:${deskId}`;
}

/**
 * Read a button payload back.
 *
 * Returns null for anything malformed. The desk id is shape-checked here purely
 * to keep a junk string out of a database query; it is NOT an authorisation
 * check, and a well-formed id belonging to another tenant still gets this far.
 * The caller must confirm the desk belongs to the owner of the CHAT the tap
 * came from, because this string is chosen by the client.
 */
export function decodePublish(data: string | undefined): PublishRequest | null {
  if (!data) return null;
  const parts = data.split(":");
  if (parts.length !== 3) return null;
  const [prefix, cadence, deskId] = parts;
  if (prefix !== "pub") return null;
  if (!isCadence(cadence)) return null;
  if (!UUID_RE.test(deskId)) return null;
  return { cadence, deskId };
}

/** Chat member statuses Telegram considers able to administer a group. */
const ADMIN_STATUSES = new Set(["creator", "administrator"]);

export function isAdminStatus(status: string | undefined): boolean {
  return status !== undefined && ADMIN_STATUSES.has(status);
}

export const CADENCE_PROMPT: Record<Cadence, string> = {
  daily: "Which desk's results from yesterday?",
  weekly: "Which desk's results for last week?",
  monthly: "Which desk's results for last month?",
};


/* ────────────────────────── trade buttons ────────────────────────── */

export interface TradeChoice {
  /** The pending draft this tap refers to. */
  readonly pendingId: string;
  /** Index into the journal list offered WITH that draft, or null to cancel. */
  readonly journalIndex: number | null;
}

/** 8 url-safe characters, no colon, so it survives the delimiter below. */
const PENDING_ID_RE = /^[A-Za-z0-9_-]{8}$/;

/**
 * "trd:<pending>:<n>" or "trd:<pending>:x" to cancel.
 *
 * An INDEX rather than a journal id. The journals offered are stored with the
 * pending draft, so the button only needs to say which one; that keeps this
 * at 14 characters against Telegram's 64-byte cap, where a uuid would not fit
 * beside the pending id. The index is client-chosen like everything else in
 * callback data, so the receiver bound-checks it and re-verifies membership.
 */
export function encodeTrade(pendingId: string, journalIndex: number | null): string {
  return `trd:${pendingId}:${journalIndex === null ? "x" : journalIndex}`;
}

export function decodeTrade(data: string | undefined): TradeChoice | null {
  if (!data) return null;
  const parts = data.split(":");
  if (parts.length !== 3) return null;
  const [prefix, pendingId, idx] = parts;
  if (prefix !== "trd") return null;
  if (!PENDING_ID_RE.test(pendingId)) return null;
  if (idx === "x") return { pendingId, journalIndex: null };
  if (!/^\d{1,2}$/.test(idx)) return null;
  return { pendingId, journalIndex: Number(idx) };
}
