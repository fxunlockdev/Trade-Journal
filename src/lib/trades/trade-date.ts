/**
 * The date a trade happened, read out of a free-form message.
 *
 * Exists because the first person to use this is catching up on the past: the
 * TTC journals were 165 trades of hand-typing and weeks behind. Defaulting
 * every ingested trade to "now" would file all of that on today, which is the
 * exact wrong-day bug that started the reporting feature.
 *
 * Supported: yesterday, today, "28 aug", "28 august", "aug 28", "28/08",
 * "28-08", "28.08", each with an optional year.
 *
 * The instant returned is MIDDAY UTC. A trade at 12:00Z on the 28th is the
 * 28th in every zone from UTC-11 to UTC+11, so it lands on the intended day
 * whatever timezone the desk uses, without this module needing to know it.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_NAMES = Object.keys(MONTHS).join("|");

/** "28 aug", "28 august 2026", "28aug" */
const DAY_MONTH_RE = new RegExp(
  String.raw`\b(\d{1,2})\s*(${MONTH_NAMES})\b(?:\s*,?\s*(\d{4}))?`,
  "i",
);
/** "aug 28", "august 28, 2026" */
const MONTH_DAY_RE = new RegExp(
  String.raw`\b(${MONTH_NAMES})\s*(\d{1,2})\b(?:\s*,?\s*(\d{4}))?`,
  "i",
);
/** "28/08", "28-08-2026", "28.08". Day first: this is a European desk. */
const NUMERIC_RE = /\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/;

export interface ParsedTradeDate {
  /** ISO instant at 12:00Z on the day. */
  readonly iso: string;
  /** What was matched, for the confirmation message. */
  readonly label: string;
}

function midday(y: number, m: number, d: number): string | null {
  const t = Date.UTC(y, m - 1, d, 12, 0, 0);
  const date = new Date(t);
  // Reject roll-over: Date.UTC(2026, 1, 31) silently becomes 3 March.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString();
}

function inferYear(month: number, day: number, now: Date): number {
  // A month later than the current one, with no year given, is last year's:
  // nobody backfills a trade from the future.
  const y = now.getUTCFullYear();
  const candidate = Date.UTC(y, month - 1, day, 12);
  return candidate > now.getTime() + 24 * 3600 * 1000 ? y - 1 : y;
}

function fullYear(raw: string | undefined, month: number, day: number, now: Date): number {
  if (!raw) return inferYear(month, day, now);
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
}

/**
 * Find a date in the text, or null when none is present.
 *
 * Null means "use now", and that decision is the caller's: this module never
 * guesses a date that was not written.
 */
export function parseTradeDate(text: string, now: Date): ParsedTradeDate | null {
  const t = text.trim();
  if (!t) return null;

  if (/\byesterday\b/i.test(t)) {
    const d = new Date(now.getTime() - 24 * 3600 * 1000);
    const iso = midday(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    return iso ? { iso, label: "yesterday" } : null;
  }
  if (/\btoday\b/i.test(t)) {
    const iso = midday(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
    return iso ? { iso, label: "today" } : null;
  }

  const dm = DAY_MONTH_RE.exec(t);
  if (dm) {
    const day = Number(dm[1]);
    const month = MONTHS[dm[2].toLowerCase()];
    const iso = midday(fullYear(dm[3], month, day, now), month, day);
    return iso ? { iso, label: dm[0].trim() } : null;
  }

  const md = MONTH_DAY_RE.exec(t);
  if (md) {
    const month = MONTHS[md[1].toLowerCase()];
    const day = Number(md[2]);
    const iso = midday(fullYear(md[3], month, day, now), month, day);
    return iso ? { iso, label: md[0].trim() } : null;
  }

  const num = NUMERIC_RE.exec(t);
  if (num) {
    const day = Number(num[1]);
    const month = Number(num[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const iso = midday(fullYear(num[3], month, day, now), month, day);
    return iso ? { iso, label: num[0] } : null;
  }

  return null;
}
