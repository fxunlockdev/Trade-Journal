import { unzipSync } from "fflate";
import { decodeReportText } from "@/lib/import/decode-text";
import {
  parseReportRows,
  ReportParseError,
  type ParsedReport,
  type Row,
} from "@/lib/import/mt5-report";

/**
 * MT5 / MT4 trade-report (.xlsx) parser — Excel is what MT5's
 * "History → right-click → Report → XLSX" produces, and what most users reach
 * for first.
 *
 * Real-world facts this encodes (verified against a genuine PU Prime export):
 * - An .xlsx is a ZIP of XML parts. MT5 writes those parts as **UTF-16LE with
 *   a BOM** (no encoding= in the XML declaration), NOT UTF-8 — decoding them
 *   as UTF-8 yields garbage, so we sniff the BOM.
 * - **Empty cells are omitted entirely.** A row whose S/L and T/P are unset
 *   jumps <c r="F11"> → <c r="I11">. Cells MUST therefore be placed by their
 *   column letter (r="I11" → index 8), never by sequence — appending in order
 *   silently shifts close-time into the S/L slot and imports wrong prices.
 * - Values arrive as shared strings (t="s" → index into sharedStrings.xml),
 *   inline strings, cached formula results, or raw numbers.
 * - Sheet order isn't guaranteed, so every worksheet is tried and the one that
 *   yields a usable report wins.
 *
 * Rows are handed to the shared, format-agnostic core in mt5-report.ts, so the
 * HTML, PDF and XLSX paths all resolve trades through identical logic.
 */

/** XLSX parts are UTF-16LE (MT5), UTF-16BE, or UTF-8 — decided by BOM/sniffing. */
const decodeXmlPart = decodeReportText;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** Spreadsheet column ref → 0-based index. "A"→0, "Z"→25, "AA"→26. */
export function columnToIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i += 1) {
    n = n * 26 + (ref.charCodeAt(i) - 64); // 'A' = 65
  }
  return n - 1;
}

/** sharedStrings.xml → ordered strings (rich-text runs concatenated). */
function parseSharedStrings(xml: string): readonly string[] {
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let si: RegExpExecArray | null;
  while ((si = siRe.exec(xml)) !== null) {
    let text = "";
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(si[1])) !== null) text += t[1];
    out.push(decodeEntities(text));
  }
  return out;
}

/**
 * Excel serial date → "yyyy.MM.dd HH:mm:ss" (the report's native time format),
 * so re-saved workbooks — where Excel converts the text timestamps into real
 * date cells — still parse. Serial 1 = 1900-01-01, with Excel's 1900 leap-year
 * bug meaning serials > 59 are offset by one day.
 */
function serialToReportTime(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2_958_465) return null;
  const ms = Math.round((serial - 25_569) * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

/** True for a value that already looks like a report timestamp. */
const REPORT_TIME_RE = /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}(:\d{2})?$/;

interface SheetCell {
  readonly index: number;
  readonly value: string;
}

/**
 * One worksheet → dense, column-positioned rows. Gaps left by omitted empty
 * cells are filled with "" so downstream index-based column mapping is exact.
 */
function sheetToRows(xml: string, shared: readonly string[]): readonly Row[] {
  const rows: Row[] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const cells: SheetCell[] = [];
    // Handles both self-closing (<c r="G11" s="5"/>) and full cells.
    const cellRe =
      /<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const index = columnToIndex(cellMatch[1]);
      const attrs = cellMatch[2] ?? "";
      const body = cellMatch[3] ?? "";
      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const type = typeMatch ? typeMatch[1] : "n";

      let value = "";
      if (type === "s") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        const idx = v ? Number(v[1]) : NaN;
        value = Number.isInteger(idx) ? (shared[idx] ?? "") : "";
      } else if (type === "inlineStr") {
        let text = "";
        const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let t: RegExpExecArray | null;
        while ((t = tRe.exec(body)) !== null) text += t[1];
        value = decodeEntities(text);
      } else {
        // Numbers, booleans and cached formula results all live in <v>.
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = v ? decodeEntities(v[1]) : "";
      }

      cells.push({ index, value: value.trim() });
    }

    if (cells.length === 0) continue;

    const width = Math.max(...cells.map((c) => c.index)) + 1;
    const dense: string[] = new Array(width).fill("");
    for (const c of cells) dense[c.index] = c.value;

    rows.push({ cells: dense, cellCount: width });
  }

  return rows;
}

/**
 * Re-saved workbooks turn the report's text timestamps into numeric date
 * serials. Convert any bare serial sitting in a column that elsewhere holds
 * real report timestamps, so both native and re-saved files parse identically.
 */
function healDateSerials(rows: readonly Row[]): readonly Row[] {
  const timeColumns = new Set<number>();
  for (const row of rows) {
    row.cells.forEach((cell, i) => {
      if (REPORT_TIME_RE.test(cell)) timeColumns.add(i);
    });
  }
  if (timeColumns.size === 0) return rows;

  return rows.map((row) => {
    let touched = false;
    const cells = row.cells.map((cell, i) => {
      if (!timeColumns.has(i) || cell === "" || REPORT_TIME_RE.test(cell)) {
        return cell;
      }
      const n = Number(cell);
      // Serial dates are large fractional day counts; a ticket or price in a
      // time column would be nonsense anyway, so only convert plausible ones.
      if (!Number.isFinite(n) || n < 20_000 || n > 80_000) return cell;
      const healed = serialToReportTime(n);
      if (!healed) return cell;
      touched = true;
      return healed;
    });
    return touched ? { cells, cellCount: row.cellCount } : row;
  });
}

/** First rows flattened to text — used for platform/account detection. */
function rowsToPlainText(rows: readonly Row[]): string {
  return rows
    .slice(0, 25)
    .map((r) => r.cells.filter(Boolean).join(" "))
    .join("\n");
}

export function parseXlsxReport(
  bytes: Uint8Array,
  utcOffsetMinutes: number,
): ParsedReport {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ReportParseError(
      "That .xlsx file couldn't be opened. It may be corrupted or password-protected. Re-export it from MT5 (History → right-click → Report → XLSX) and try again.",
      "not_a_report",
    );
  }

  const sharedPart = Object.keys(files).find((f) =>
    /^xl\/sharedStrings\.xml$/i.test(f),
  );
  const shared = sharedPart
    ? parseSharedStrings(decodeXmlPart(files[sharedPart]))
    : [];

  const sheetPaths = Object.keys(files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(f))
    .sort();

  if (sheetPaths.length === 0) {
    throw new ReportParseError(
      "That .xlsx file has no worksheets. Re-export the report from MT5 (History → right-click → Report → XLSX).",
      "not_a_report",
    );
  }

  // Try every sheet — the report isn't guaranteed to be the first one. The
  // first sheet that parses into trades wins; otherwise surface the most
  // specific error we saw.
  let lastError: ReportParseError | null = null;
  for (const path of sheetPaths) {
    const rows = healDateSerials(sheetToRows(decodeXmlPart(files[path]), shared));
    if (rows.length === 0) continue;
    try {
      return parseReportRows(rows, rowsToPlainText(rows), utcOffsetMinutes);
    } catch (err: unknown) {
      if (err instanceof ReportParseError) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw (
    lastError ??
    new ReportParseError(
      "No trades found in that spreadsheet. Export from MT5 with History → Period: All History → right-click → Report → XLSX.",
      "no_trades",
    )
  );
}
