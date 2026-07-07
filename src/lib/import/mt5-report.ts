import type { Mt5Event } from "@/lib/validators/mt5";

/**
 * MT5 / MT4 trade-report (HTML) parser — the manual-import path.
 *
 * Format facts (verified against genuine report files):
 * - MT5: Toolbox → History → right-click → Report → HTML. One big <table>
 *   with banner rows ("Positions", "Orders", "Deals", …). We parse ONLY the
 *   Positions section (closed positions) — deposits/withdrawals live in
 *   Deals, so cash flows are naturally excluded. Verbatim headers:
 *   Time | Position | Symbol | Type | Volume | Price | S / L | T / P |
 *   Time | Price | Commission | Swap | Profit(colspan=2)
 *   Quirk: data rows include `<td class="hidden" colspan="8">` drill-down
 *   cells between Type and Volume — they MUST be skipped, or indexing breaks.
 * - MT4: Account History → "Save as Report" → single table with a
 *   "Closed Transactions:" section; Ticket | Open Time | Type | Size | Item |
 *   Price | S/L | T/P | Close Time | Price | Commission | Taxes | Swap |
 *   Profit; `balance` rows are interleaved and must be filtered.
 * - Times are `yyyy.MM.dd HH:mm[:ss]` in BROKER time (report has no TZ info)
 *   → caller passes a UTC offset chosen by the user at upload.
 * - Reports are rendered in the terminal's UI language — we detect the
 *   English markers and return a clear error otherwise (TradeZella does the
 *   same).
 *
 * Pure module: string in → events out. No DOM libs — MT5 reports are
 * machine-generated, so regex row/cell extraction is reliable.
 */

export interface ParsedReport {
  readonly platform: "mt5" | "mt4";
  /** Broker account login parsed from the header (null if not found). */
  readonly accountLogin: string | null;
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
 * A logical table row of cell strings. Produced from HTML `<tr>`s or, for PDF
 * imports, reconstructed from positioned text (see pdf-report.ts) — the row
 * parser below is format-agnostic.
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
  const cleaned = raw.replace(/[\s ]/g, "").replace(/,/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
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

function findAccountLogin(text: string): string | null {
  const m = /Account[^0-9]{0,40}(\d{4,})/i.exec(text);
  return m ? m[1] : null;
}

function rowIsSectionBanner(row: Row, title: string): boolean {
  return (
    row.cellCount <= 2 &&
    row.cells.some((c) => c.toLowerCase() === title.toLowerCase())
  );
}

/* ----------------------------------- MT5 ----------------------------------- */

function parseMt5Positions(
  rows: readonly Row[],
  utcOffsetMinutes: number,
  warnings: string[],
): { events: Mt5Event[]; skipped: number } {
  const events: Mt5Event[] = [];
  let skipped = 0;

  const bannerIdx = rows.findIndex((r) => rowIsSectionBanner(r, "Positions"));
  if (bannerIdx === -1) {
    throw new ReportParseError(
      "Couldn't find the Positions section — make sure this is an MT5 History report exported in ENGLISH (View → Languages → English, restart, re-export).",
      "not_english",
    );
  }

  // Header row sanity: must mention Position + Symbol.
  const header = rows[bannerIdx + 1];
  if (
    !header ||
    !header.cells.some((c) => /^position$/i.test(c)) ||
    !header.cells.some((c) => /^symbol$/i.test(c))
  ) {
    throw new ReportParseError(
      "Positions table header not recognized — export the report in English and re-upload.",
      "not_english",
    );
  }

  for (let i = bannerIdx + 2; i < rows.length; i += 1) {
    const row = rows[i];
    // Next section banner ends the Positions block.
    if (
      rowIsSectionBanner(row, "Orders") ||
      rowIsSectionBanner(row, "Deals") ||
      rowIsSectionBanner(row, "Working Orders") ||
      rowIsSectionBanner(row, "Results")
    ) {
      break;
    }
    if (row.cellCount < 12) continue; // summary/spacer rows

    const c = row.cells;
    // 0 openTime · 1 position · 2 symbol · 3 type · 4 volume · 5 openPrice ·
    // 6 S/L · 7 T/P · 8 closeTime · 9 closePrice · 10 commission · 11 swap ·
    // 12(+13) profit (header colspan=2 — take the last numeric cell).
    const type = (c[3] ?? "").toLowerCase();
    if (type !== "buy" && type !== "sell") {
      skipped += 1;
      continue;
    }

    const ticket = parseNum(c[1]);
    const openTime = parseReportTime(c[0], utcOffsetMinutes);
    const closeTime = parseReportTime(c[8], utcOffsetMinutes);
    const volume = parseNum(c[4]);
    const openPrice = parseNum(c[5]);
    const closePrice = parseNum(c[9]);
    const commission = parseNum(c[10]) ?? 0;
    const swap = parseNum(c[11]) ?? 0;
    const profit = parseNum(c[row.cellCount - 1]) ?? parseNum(c[12]);

    if (
      ticket === null ||
      openTime === null ||
      closeTime === null ||
      volume === null ||
      volume <= 0 ||
      openPrice === null ||
      openPrice <= 0 ||
      closePrice === null ||
      closePrice <= 0 ||
      profit === null
    ) {
      skipped += 1;
      warnings.push(`Skipped a malformed Positions row (ticket ${c[1] ?? "?"}).`);
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
      commission,
      swap,
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

  const bannerIdx = rows.findIndex((r) =>
    r.cells.some((c) => /^closed transactions:?$/i.test(c)),
  );
  if (bannerIdx === -1) {
    throw new ReportParseError(
      "Couldn't find the Closed Transactions section — export the MT4 statement in English and re-upload.",
      "not_english",
    );
  }

  for (let i = bannerIdx + 2; i < rows.length; i += 1) {
    const row = rows[i];
    if (
      row.cells.some((c) => /^(open trades:?|working orders:?|summary:?)$/i.test(c))
    ) {
      break;
    }
    if (row.cellCount < 13) {
      // balance / spacer rows are short — count real balance ops as skipped.
      if (row.cells.some((c) => /^balance$/i.test(c))) skipped += 1;
      continue;
    }

    const c = row.cells;
    // 0 ticket · 1 openTime · 2 type · 3 size · 4 item · 5 openPrice · 6 S/L ·
    // 7 T/P · 8 closeTime · 9 closePrice · 10 commission · 11 taxes · 12 swap ·
    // 13 profit
    const type = (c[2] ?? "").toLowerCase();
    if (type !== "buy" && type !== "sell") {
      skipped += 1;
      continue;
    }

    const ticket = parseNum(c[0]);
    const openTime = parseReportTime(c[1], utcOffsetMinutes);
    const closeTime = parseReportTime(c[8], utcOffsetMinutes);
    const volume = parseNum(c[3]);
    const openPrice = parseNum(c[5]);
    const closePrice = parseNum(c[9]);
    const commission = parseNum(c[10]) ?? 0;
    const taxes = parseNum(c[11]) ?? 0;
    const swap = parseNum(c[12]) ?? 0;
    const profit = parseNum(c[row.cellCount - 1]);

    if (
      ticket === null ||
      openTime === null ||
      closeTime === null ||
      volume === null ||
      volume <= 0 ||
      openPrice === null ||
      openPrice <= 0 ||
      closePrice === null ||
      closePrice <= 0 ||
      profit === null
    ) {
      skipped += 1;
      warnings.push(`Skipped a malformed row (ticket ${c[0] ?? "?"}).`);
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
      commission: commission + taxes,
      swap,
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
      "That file doesn't look like an MT4/MT5 HTML report. Export via History → right-click → Report → HTML and upload that file.",
      "not_a_report",
    );
  }

  const rows = extractRows(html);
  const plainText = stripTags(html.slice(0, 4000));
  return parseReportRows(rows, plainText, utcOffsetMinutes);
}

/**
 * Format-agnostic core: given reconstructed table rows + a plain-text sample
 * (for header/account detection), detect MT5 vs MT4 and parse closed trades.
 * Shared by the HTML parser and the PDF parser (pdf-report.ts).
 */
export function parseReportRows(
  rows: readonly Row[],
  plainText: string,
  utcOffsetMinutes: number,
): ParsedReport {
  const warnings: string[] = [];

  const isMt5 =
    /Trade History Report/i.test(plainText) ||
    rows.some((r) => rowIsSectionBanner(r, "Positions"));
  const isMt4 =
    rows.some((r) => r.cells.some((c) => /^closed transactions:?$/i.test(c))) ||
    /closed transactions/i.test(plainText);

  if (!isMt5 && !isMt4) {
    throw new ReportParseError(
      "Couldn't recognize this report. Make sure it's the MT5 'Report → HTML' (or MT4 'Save as Report') file, exported in English.",
      "not_a_report",
    );
  }

  const accountLogin = findAccountLogin(plainText);
  const { events, skipped } = isMt5
    ? parseMt5Positions(rows, utcOffsetMinutes, warnings)
    : parseMt4ClosedTransactions(rows, utcOffsetMinutes, warnings);

  if (events.length === 0) {
    throw new ReportParseError(
      "No closed trades found in this report. Set the History period to 'All History' before exporting.",
      "no_trades",
    );
  }

  return {
    platform: isMt5 ? "mt5" : "mt4",
    accountLogin,
    events,
    skippedRows: skipped,
    warnings,
  };
}
