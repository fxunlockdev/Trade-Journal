import type { Mt5Event } from "@/lib/validators/mt5";

/**
 * MT5 / MT4 trade-report parser — the manual-import path.
 *
 * Format facts (verified against genuine report files):
 * - MT5: Toolbox → History → right-click → Report → HTML/XLSX. Banner rows
 *   ("Positions", "Orders", "Deals", …) separate sections. We import ONLY
 *   closed positions — deposits/withdrawals live in Deals, so cash flows are
 *   naturally excluded. Verbatim (English) headers:
 *   Time | Position | Symbol | Type | Volume | Price | S / L | T / P |
 *   Time | Price | Commission | Swap | Profit(colspan=2)
 *   HTML quirk: data rows include `<td class="hidden" colspan="8">` drill-down
 *   cells between Type and Volume — they MUST be skipped, or indexing breaks.
 * - MT4: Account History → "Save as Report"; a "Closed Transactions:" section;
 *   Ticket | Open Time | Type | Size | Item | Price | S/L | T/P | Close Time |
 *   Price | Commission | Taxes | Swap | Profit; `balance` rows are interleaved.
 * - Times are `yyyy.MM.dd HH:mm[:ss]` in BROKER time (report has no TZ info)
 *   → caller passes a UTC offset chosen by the user at upload.
 *
 * LANGUAGE INDEPENDENCE (learned the hard way from a French PU Prime export):
 * MT5 localises every header and section title — "Symbole", "Ordres",
 * "Transactions", "Compte:" — but it NEVER localises the Type values, which
 * stay "buy"/"sell" in every UI language. So rows are identified by SHAPE plus
 * those two words rather than by translated headers, and sections end at the
 * next banner row whatever it says. Translated banner lists below are only a
 * hint that sharpens the scan; parsing succeeds without them.
 *
 * Pure module: rows in → events out. No DOM libs — reports are
 * machine-generated, so regex row/cell extraction is reliable.
 */

export interface ParsedReport {
  readonly platform: "mt5" | "mt4";
  /** Broker account login parsed from the header (null if not found). */
  readonly accountLogin: string | null;
  /**
   * The account's DEPOSIT CURRENCY, parsed from the same header suffix.
   *
   * Every P&L figure in the statement is denominated in this — the broker's own
   * number, never converted. Without it an imported row's currency has to be
   * guessed from the journal's settings, which is wrong the moment someone
   * imports a EUR account into a USD journal.
   */
  readonly accountCurrency: string | null;
  readonly events: readonly Mt5Event[];
  /** Rows recognized but not importable (e.g. balance ops, malformed). */
  readonly skippedRows: number;
  readonly warnings: readonly string[];
}

export class ReportParseError extends Error {
  constructor(
    message: string,
    readonly reason: "not_a_report" | "not_english" | "no_trades",
  ) {
    super(message);
    this.name = "ReportParseError";
  }
}

/* ---------------------------------- html ---------------------------------- */

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .trim();
}

/**
 * A logical table row of cell strings. Produced from HTML `<tr>`s, from
 * positioned PDF text (pdf-report.ts), or from column-positioned spreadsheet
 * cells (xlsx-report.ts) — the row parser below is format-agnostic.
 */
export interface Row {
  readonly cells: readonly string[];
  readonly cellCount: number;
}

/** Extract visible cell texts per <tr>, skipping MT5's hidden drill-down tds. */
function extractRows(html: string): readonly Row[] {
  const rows: Row[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(trMatch[1])) !== null) {
      const attrs = cellMatch[2] ?? "";
      if (/class\s*=\s*["'][^"']*hidden[^"']*["']/i.test(attrs)) continue;
      cells.push(stripTags(cellMatch[3] ?? ""));
    }
    if (cells.length > 0) rows.push({ cells, cellCount: cells.length });
  }
  return rows;
}

/* --------------------------------- values --------------------------------- */

/** "50 000.00" / "1.0845" / "" → number|null (spaces are thousands seps). */
function parseNum(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[\s ]/g, "").replace(/,/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const REPORT_TIME_RE = /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}(:\d{2})?$/;

function isReportTime(raw: string | undefined): boolean {
  return raw != null && REPORT_TIME_RE.test(raw.trim());
}

function isPositiveNum(raw: string | undefined): boolean {
  const n = parseNum(raw);
  return n !== null && n > 0;
}

/** "yyyy.MM.dd HH:mm[:ss]" broker time → unix seconds UTC. */
function parseReportTime(
  raw: string | undefined,
  utcOffsetMinutes: number,
): number | null {
  if (!raw) return null;
  const m = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    raw.trim(),
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const utcMs =
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s ?? 0),
    ) -
    utcOffsetMinutes * 60_000;
  return Math.floor(utcMs / 1000);
}

/** Account labels across MT5 UI languages, for the login fallback below. */
const ACCOUNT_LABEL =
  "account|compte|cuenta|konto|conta|conto|rekening|tili|konte|rachunek|hesap|účet|ucet|fiók|fiok|cont|сметка|счет|счёт|рахунок|账户|帳戶|口座|계좌|บัญชี|tài khoản|akun";

interface AccountHeader {
  readonly login: string | null;
  readonly currency: string | null;
}

function findAccountHeader(text: string): AccountHeader {
  // MT5 prints "<login> (USD, Broker-Server, real, Hedge)" in EVERY language —
  // the parenthesised, comma-separated suffix makes this unambiguous, and the
  // currency is its FIRST element. The old regex matched exactly this and threw
  // the currency away inside a lookahead.
  const paren = /(\d{4,})\s*\(\s*([A-Za-z]{3})\s*,/.exec(text);
  if (paren) return { login: paren[1], currency: paren[2].toUpperCase() };

  // Same suffix, but the first element isn't a 3-letter code (some brokers put
  // the server first). The login is still recoverable; the currency is not.
  const parenNoCcy = /(\d{4,})\s*\((?=[^)]*,)/.exec(text);
  if (parenNoCcy) return { login: parenNoCcy[1], currency: null };

  const labelled = new RegExp(
    `(?:${ACCOUNT_LABEL})[^0-9]{0,40}(\\d{4,})`,
    "i",
  ).exec(text);
  return { login: labelled ? labelled[1] : null, currency: null };
}

/* -------------------------------- sections -------------------------------- */

/** "Positions" across MT5's UI languages. A hint only — see module header. */
const POSITIONS_BANNERS: ReadonlySet<string> = new Set([
  "positions",
  "posiciones",
  "positionen",
  "posizioni",
  "posições",
  "posicoes",
  "posities",
  "positioner",
  "pozycje",
  "pozisyonlar",
  "pozice",
  "pozíciók",
  "pozíciok",
  "poziții",
  "pozitii",
  "позиции",
  "позиції",
  "позиции",
  "持仓",
  "持倉",
  "倉位",
  "ポジション",
  "포지션",
  "المراكز",
  "مراكز",
  "สถานะ",
  "vị thế",
  "posisi",
]);

/** The single non-empty cell of a banner row, lowercased — else null. */
function bannerText(row: Row): string | null {
  const filled = row.cells.map((c) => c.trim()).filter((c) => c !== "");
  if (filled.length !== 1) return null;
  const text = filled[0];
  // Banners are short labels, never numbers.
  if (text.length > 48 || parseNum(text) !== null) return null;
  return text.toLowerCase();
}

function isBannerRow(row: Row): boolean {
  return bannerText(row) !== null;
}

function findPositionsBanner(rows: readonly Row[]): number {
  return rows.findIndex((r) => {
    const t = bannerText(r);
    return t !== null && POSITIONS_BANNERS.has(t);
  });
}

/** Index of the next banner at/after `from` — a section's language-agnostic end. */
function nextBannerIndex(rows: readonly Row[], from: number): number {
  for (let i = from; i < rows.length; i += 1) {
    if (isBannerRow(rows[i])) return i;
  }
  return rows.length;
}

/* ------------------------------ row shape tests ---------------------------- */

/**
 * A CLOSED MT5 position row.
 *   0 openTime · 1 ticket · 2 symbol · 3 type · 4 volume · 5 openPrice ·
 *   6 S/L · 7 T/P · 8 closeTime · 9 closePrice · 10 commission · 11 swap ·
 *   12 profit
 * Also the discriminator against neighbouring sections, which share the
 * buy/sell Type value:
 *   - Deals rows put "in"/"out" in column 4 → volume won't parse.
 *   - Orders rows put "0.1 / 0.1" in volume and "filled"/"market" where a
 *     close price belongs.
 *   - Open positions have no close time.
 */
function isMt5PositionRow(c: readonly string[]): boolean {
  const type = (c[3] ?? "").trim().toLowerCase();
  if (type !== "buy" && type !== "sell") return false;
  return (
    isReportTime(c[0]) &&
    isReportTime(c[8]) &&
    parseNum(c[1]) !== null &&
    isPositiveNum(c[4]) &&
    isPositiveNum(c[5]) &&
    isPositiveNum(c[9])
  );
}

/**
 * A CLOSED MT4 transaction row.
 *   0 ticket · 1 openTime · 2 type · 3 size · 4 item · 5 openPrice · 6 S/L ·
 *   7 T/P · 8 closeTime · 9 closePrice · 10 commission · 11 taxes · 12 swap ·
 *   13 profit
 * `balance` rows fail the type test, so cash flows never reach the journal.
 */
function isMt4ClosedRow(c: readonly string[]): boolean {
  const type = (c[2] ?? "").trim().toLowerCase();
  if (type !== "buy" && type !== "sell") return false;
  return (
    parseNum(c[0]) !== null &&
    isReportTime(c[1]) &&
    isReportTime(c[8]) &&
    isPositiveNum(c[3]) &&
    isPositiveNum(c[5]) &&
    isPositiveNum(c[9])
  );
}

/** Last parseable number in a row — profit sits in a colspan=2 cell in HTML. */
function trailingProfit(c: readonly string[], from: number): number | null {
  for (let i = c.length - 1; i >= from; i -= 1) {
    const n = parseNum(c[i]);
    if (n !== null) return n;
  }
  return null;
}

/* ----------------------------------- MT5 ----------------------------------- */

function parseMt5Positions(
  rows: readonly Row[],
  utcOffsetMinutes: number,
  warnings: string[],
): { events: Mt5Event[]; skipped: number } {
  const events: Mt5Event[] = [];
  let skipped = 0;

  // Prefer the banner-delimited section when we recognise the title; otherwise
  // scan the whole document — the shape test is strict enough on its own.
  const bannerIdx = findPositionsBanner(rows);
  const start = bannerIdx >= 0 ? bannerIdx + 1 : 0;
  const end =
    bannerIdx >= 0 ? nextBannerIndex(rows, bannerIdx + 2) : rows.length;

  for (let i = start; i < end; i += 1) {
    const c = rows[i].cells;
    const type = (c[3] ?? "").trim().toLowerCase();
    if (type !== "buy" && type !== "sell") continue; // header / summary / other

    if (!isMt5PositionRow(c)) {
      skipped += 1;
      // Only a row that IS shaped like a position (numeric volume) but fails
      // validation is worth reporting — Deals/Orders rows legitimately differ.
      if (isPositiveNum(c[4])) {
        warnings.push(
          `Skipped a malformed Positions row (ticket ${c[1] || "?"}).`,
        );
      }
      continue;
    }

    const ticket = parseNum(c[1]);
    const openTime = parseReportTime(c[0], utcOffsetMinutes);
    const closeTime = parseReportTime(c[8], utcOffsetMinutes);
    const volume = parseNum(c[4]);
    const openPrice = parseNum(c[5]);
    const closePrice = parseNum(c[9]);
    const profit = trailingProfit(c, 12);

    if (
      ticket === null ||
      openTime === null ||
      closeTime === null ||
      volume === null ||
      openPrice === null ||
      closePrice === null ||
      profit === null
    ) {
      skipped += 1;
      warnings.push(`Skipped a malformed Positions row (ticket ${c[1] || "?"}).`);
      continue;
    }

    const sl = parseNum(c[6]);
    const tp = parseNum(c[7]);

    events.push({
      type: "close",
      ticket,
      symbol: c[2],
      direction: type,
      volume,
      entry_price: openPrice,
      sl: sl && sl > 0 ? sl : null,
      tp: tp && tp > 0 ? tp : null,
      open_time: openTime,
      exit_price: closePrice,
      close_time: closeTime,
      profit,
      commission: parseNum(c[10]) ?? 0,
      swap: parseNum(c[11]) ?? 0,
      is_final: true,
    });
  }

  return { events, skipped };
}

/* ----------------------------------- MT4 ----------------------------------- */

function parseMt4ClosedTransactions(
  rows: readonly Row[],
  utcOffsetMinutes: number,
  warnings: string[],
): { events: Mt5Event[]; skipped: number } {
  const events: Mt5Event[] = [];
  let skipped = 0;

  for (const row of rows) {
    const c = row.cells;
    const type = (c[2] ?? "").trim().toLowerCase();
    if (type !== "buy" && type !== "sell") {
      // Count real balance ops as skipped so the UI can report them.
      if (c.some((cell) => /^balance$/i.test(cell.trim()))) skipped += 1;
      continue;
    }

    if (!isMt4ClosedRow(c)) {
      skipped += 1;
      if (isPositiveNum(c[3])) {
        warnings.push(`Skipped a malformed row (ticket ${c[0] || "?"}).`);
      }
      continue;
    }

    const ticket = parseNum(c[0]);
    const openTime = parseReportTime(c[1], utcOffsetMinutes);
    const closeTime = parseReportTime(c[8], utcOffsetMinutes);
    const volume = parseNum(c[3]);
    const openPrice = parseNum(c[5]);
    const closePrice = parseNum(c[9]);
    const profit = trailingProfit(c, 13);

    if (
      ticket === null ||
      openTime === null ||
      closeTime === null ||
      volume === null ||
      openPrice === null ||
      closePrice === null ||
      profit === null
    ) {
      skipped += 1;
      warnings.push(`Skipped a malformed row (ticket ${c[0] || "?"}).`);
      continue;
    }

    const sl = parseNum(c[6]);
    const tp = parseNum(c[7]);

    events.push({
      type: "close",
      ticket,
      symbol: (c[4] ?? "").toUpperCase(),
      direction: type,
      volume,
      entry_price: openPrice,
      sl: sl && sl > 0 ? sl : null,
      tp: tp && tp > 0 ? tp : null,
      open_time: openTime,
      exit_price: closePrice,
      close_time: closeTime,
      profit,
      // Fold MT4 taxes into commission — same "cost" bucket.
      commission: (parseNum(c[10]) ?? 0) + (parseNum(c[11]) ?? 0),
      swap: parseNum(c[12]) ?? 0,
      is_final: true,
    });
  }

  return { events, skipped };
}

/* ---------------------------------- entry ---------------------------------- */

export function parseTradeReport(
  html: string,
  utcOffsetMinutes: number,
): ParsedReport {
  if (!/<table|<tr/i.test(html)) {
    throw new ReportParseError(
      "That file doesn't look like an MT4/MT5 report. Export via History → right-click → Report (HTML or XLSX) and upload that file.",
      "not_a_report",
    );
  }

  const rows = extractRows(html);
  const plainText = stripTags(html.slice(0, 4000));
  return parseReportRows(rows, plainText, utcOffsetMinutes);
}

/**
 * Format-agnostic core: given reconstructed table rows + a plain-text sample
 * (for title/account detection), detect MT5 vs MT4 and parse closed trades.
 * Shared by the HTML, PDF (pdf-report.ts) and XLSX (xlsx-report.ts) parsers.
 */
export function parseReportRows(
  rows: readonly Row[],
  plainText: string,
  utcOffsetMinutes: number,
): ParsedReport {
  const warnings: string[] = [];

  // Structure decides; titles/banners only break ties. This is what lets a
  // French (or any non-English) report import without a word list.
  const mt5RowCount = rows.filter((r) => isMt5PositionRow(r.cells)).length;
  const mt4RowCount = rows.filter((r) => isMt4ClosedRow(r.cells)).length;
  const mt5Hint =
    findPositionsBanner(rows) >= 0 || /trade history report/i.test(plainText);
  const mt4Hint =
    /closed transactions/i.test(plainText) ||
    rows.some((r) => r.cells.some((c) => /^closed transactions:?$/i.test(c.trim())));

  const isMt5 =
    mt5RowCount > 0 ? mt5RowCount >= mt4RowCount : mt4RowCount === 0 && mt5Hint;
  const isMt4 = !isMt5 && (mt4RowCount > 0 || mt4Hint);

  if (!isMt5 && !isMt4) {
    // Distinguish the very common mistake of uploading MT5's *analytics*
    // report (the visual "Reports" summary) — it has Gain / Profit Factor /
    // Drawdown but NO per-trade rows, so there's nothing to import.
    const looksLikeSummary =
      /profit\s*factor|sharp[e]?\s*ratio|gross\s*(profit|loss)|max\.?\s*drawdown|recovery\s*factor|trades\s*per\s*week/i.test(
        plainText,
      );
    if (looksLikeSummary) {
      throw new ReportParseError(
        "That's a performance summary (Gain, Profit Factor, Drawdown…). It doesn't list individual trades, so there's nothing to import. Export the detailed history instead: MT5 → History tab → right-click → Report → XLSX (or HTML).",
        "not_a_report",
      );
    }
    throw new ReportParseError(
      "Couldn't find any trades in this report. Upload the MT5 'History → right-click → Report' export (XLSX or HTML), or an MT4 'Save as Report' file. MT5's built-in PDF 'Reports' are summaries without individual trades.",
      "not_a_report",
    );
  }

  const account = findAccountHeader(plainText);
  const { events, skipped } = isMt5
    ? parseMt5Positions(rows, utcOffsetMinutes, warnings)
    : parseMt4ClosedTransactions(rows, utcOffsetMinutes, warnings);

  if (events.length === 0) {
    throw new ReportParseError(
      "No closed trades found in this report. Set the History period to 'All History' before exporting. Open positions can't be imported until they close.",
      "no_trades",
    );
  }

  return {
    platform: isMt5 ? "mt5" : "mt4",
    accountLogin: account.login,
    accountCurrency: account.currency,
    events,
    skippedRows: skipped,
    warnings,
  };
}
