/**
 * The date a trade happened, read out of a free-form message.
 *
 * Exists because the first person to use this is catching up on the past: the
 * TTC journals were 165 trades of hand-typing and weeks behind. Defaulting
 * every ingested trade to "now" would file all of that on today, which is the
 * exact wrong-day bug that started the reporting feature.
 *
 * Supported: yesterday, today, "28 aug", "28 august 2026", "aug 28",
 * "the 28th", "28/08", "on 28.08", "28-08-2026".
 *
 * A WRITTEN day lands at MIDDAY UTC: 12:00Z on the 28th is the 28th in every
 * zone from UTC-11 to UTC+11, so it holds for a Dubai or London desk without
 * this module knowing which. "today" and "yesterday" are different: they are
 * the moment the message was typed (or 24 hours before it), because an
 * instant is right in every zone and a UTC calendar day is not -- at 01:00 in
 * Dubai it is still yesterday in UTC.
 *
 * NEVER GUESSES. The first version read "1.09", "1.5 lots" and "risk 1.2%" as
 * dates, and stopped scanning at the first number that was not one, so a real
 * date typed after a price was dropped. Now a numeric date needs a "/" or a
 * year or the word "on" in front of it, a price token is never split, and the
 * scan continues past anything that is not a date.
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
/** "the 28th", "on the 2nd": a day in the current month, or the one before. */
const ORDINAL_RE = /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i;
/**
 * "28/08", "28-08-2026", "28.08.26". Day first: this is a European desk.
 * Never part of a longer number (the lookarounds), never followed by a unit,
 * and the year must use the same separator.
 */
const NUMERIC_RE =
  /(?<![\d.,])(\d{1,2})([/\-.])(\d{1,2})(?:\2(\d{2,4}))?(?![\d.,])(?!\s*(?:pips?|pts?|points?|%|lots?)\b)/g;

/** How far ahead a date can be before it is last year's rather than a typo. */
const TYPO_HORIZON_DAYS = 45;
const DAY_MS = 24 * 3600 * 1000;

export type TradeDateResult =
  | {
      readonly kind: "date";
      /** ISO instant: 12:00Z on a written day, or the moment typed for today/yesterday. */
      readonly iso: string;
      /** What was matched, for the confirmation message. */
      readonly label: string;
    }
  | {
      /** A date a few days AHEAD of now: a slip of the finger, not a trade. */
      readonly kind: "future";
      readonly label: string;
    };

function midday(y: number, m: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // Reject roll-over: Date.UTC(2026, 1, 31) silently becomes 3 March.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/**
 * Resolve a day with an optional year against "now".
 *
 * No year: this year, unless that is more than TYPO_HORIZON_DAYS ahead, in
 * which case last year's (nobody backfills December in September). A little
 * ahead is a typo and refused, because "05/09" typed on the 3rd is far more
 * likely a slip than a trade from last year.
 */
function resolve(
  yearRaw: string | undefined,
  month: number,
  day: number,
  label: string,
  now: Date,
): TradeDateResult | null {
  if (yearRaw) {
    const y = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    const date = midday(y, month, day);
    if (!date) return null;
    if (date.getTime() > now.getTime() + DAY_MS) return { kind: "future", label };
    return { kind: "date", iso: date.toISOString(), label };
  }
  const thisYear = midday(now.getUTCFullYear(), month, day);
  if (!thisYear) return null;
  const daysAhead = (thisYear.getTime() - now.getTime()) / DAY_MS;
  if (daysAhead > 1 && daysAhead <= TYPO_HORIZON_DAYS) return { kind: "future", label };
  const date = daysAhead > 1 ? midday(now.getUTCFullYear() - 1, month, day) : thisYear;
  if (!date) return null;
  return { kind: "date", iso: date.toISOString(), label };
}

/**
 * Find a date in the text, or null when none is present.
 *
 * Null means "use now", and that decision is the caller's: this module never
 * guesses a date that was not written.
 */
export function parseTradeDate(text: string, now: Date): TradeDateResult | null {
  const t = text.trim();
  if (!t) return null;

  if (/\byesterday\b/i.test(t)) {
    return { kind: "date", iso: new Date(now.getTime() - DAY_MS).toISOString(), label: "yesterday" };
  }
  if (/\btoday\b/i.test(t)) {
    return { kind: "date", iso: now.toISOString(), label: "today" };
  }

  const dm = DAY_MONTH_RE.exec(t);
  if (dm) {
    return resolve(dm[3], MONTHS[dm[2].toLowerCase()], Number(dm[1]), dm[0].trim(), now);
  }

  const md = MONTH_DAY_RE.exec(t);
  if (md) {
    return resolve(md[3], MONTHS[md[1].toLowerCase()], Number(md[2]), md[0].trim(), now);
  }

  const ord = ORDINAL_RE.exec(t);
  if (ord) {
    const day = Number(ord[1]);
    // The most recent such day: this month if it has passed, else last month.
    let y = now.getUTCFullYear();
    let m = now.getUTCMonth() + 1;
    if (day > now.getUTCDate()) {
      m -= 1;
      if (m === 0) { m = 12; y -= 1; }
    }
    const date = midday(y, m, day);
    return date ? { kind: "date", iso: date.toISOString(), label: ord[0].trim() } : null;
  }

  NUMERIC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMERIC_RE.exec(t)) !== null) {
    const [whole, dayRaw, sep, monthRaw, yearRaw] = m;
    // "28.08" and "28-08" are also how prices and ranges look, so those need
    // a year or the word "on" to count. "28/08" is only ever a date.
    const introduced = /\bon\s+$/i.test(t.slice(0, m.index));
    if (sep !== "/" && !yearRaw && !introduced) continue;
    const day = Number(dayRaw);
    const month = Number(monthRaw);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const r = resolve(yearRaw, month, day, whole, now);
    if (r) return r;
  }

  return null;
}
