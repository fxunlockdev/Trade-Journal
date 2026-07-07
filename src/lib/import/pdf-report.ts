import { getDocumentProxy } from "unpdf";
import {
  parseReportRows,
  ReportParseError,
  type ParsedReport,
  type Row,
} from "@/lib/import/mt5-report";

/**
 * MT5 / MT4 trade report parser for PDF uploads.
 *
 * MT5 produces PDF via the mobile app ("Save as PDF") and desktop's visual
 * Reports, and users often "print to PDF" the HTML report — all of which
 * keep the trade table as SELECTABLE, positioned text (not images). We
 * extract that positioned text with unpdf (a serverless build of PDF.js),
 * reconstruct table rows, then hand them to the shared row parser.
 *
 * Column reconstruction is data-driven: we cluster the recurring x-positions
 * of text across the wide (data) rows into columns, then bucket every cell
 * into its nearest column. This survives two real hazards:
 *   1. EMPTY cells emit no text in a PDF — naive left-to-right indexing would
 *      shift every following column. Column bucketing keeps blanks aligned.
 *   2. PDF.js sometimes MERGES abutting header labels into one run
 *      ("CommissionSwap"); deriving columns from the data rows (whose values
 *      stay separate) recovers the real column set anyway.
 *
 * Best-effort by nature: broker-portal PDFs with bespoke layouts, scanned
 * image PDFs, or non-English exports may not parse — the caller always shows
 * a preview so nothing is imported blind.
 */

interface Item {
  readonly x: number; // left edge
  readonly w: number; // rendered width
  readonly y: number;
  readonly str: string;
}

/** Two items within this many PDF points on the y-axis share a line. */
const LINE_Y_TOLERANCE = 3;
/** x-centres within this distance collapse into one column. */
const COLUMN_TOLERANCE = 12;
/** A line with at least this many items is treated as tabular (data) row. */
const MIN_TABULAR_ITEMS = 6;

const centre = (it: Item): number => it.x + it.w / 2;

async function extractItemsPerPage(data: Uint8Array): Promise<Item[][]> {
  const pdf = await getDocumentProxy(data);
  const pages: Item[][] = [];
  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of content.items) {
      const it = raw as { str?: unknown; width?: unknown; transform?: unknown };
      if (typeof it.str !== "string" || it.str.trim() === "") continue;
      const t = it.transform as number[] | undefined;
      if (!t || t.length < 6) continue;
      const w = typeof it.width === "number" ? it.width : it.str.length * 4;
      items.push({ x: t[4], w, y: t[5], str: it.str });
    }
    pages.push(items);
  }
  return pages;
}

/** Group a page's items into visual lines (top → bottom), each x-sorted. */
function groupIntoLines(items: readonly Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Item[][] = [];
  let current: Item[] = [];
  let lineY: number | null = null;
  for (const item of sorted) {
    if (lineY === null || Math.abs(item.y - lineY) <= LINE_Y_TOLERANCE) {
      current.push(item);
      lineY = lineY ?? item.y;
    } else {
      lines.push(current.sort((a, b) => a.x - b.x));
      current = [item];
      lineY = item.y;
    }
  }
  if (current.length > 0) lines.push(current.sort((a, b) => a.x - b.x));
  return lines;
}

/** Fraction of a line's items that contain a digit (data rows are numeric). */
function numericFraction(line: readonly Item[]): number {
  if (line.length === 0) return 0;
  const n = line.filter((it) => /\d/.test(it.str)).length;
  return n / line.length;
}

/**
 * Column centres, learned from the x-centres of text in the DATA rows only
 * (wide + mostly numeric). Excluding the text-only header avoids a merged
 * header run ("CommissionSwap") inventing a phantom column; redundancy across
 * many data rows means one blank cell can't hide a real column either.
 */
function detectColumns(lines: readonly Item[][]): number[] {
  const centres: number[] = [];
  for (const line of lines) {
    if (line.length >= MIN_TABULAR_ITEMS && numericFraction(line) >= 0.5) {
      for (const it of line) centres.push(centre(it));
    }
  }
  if (centres.length === 0) return [];
  centres.sort((a, b) => a - b);
  const cols: number[] = [];
  let cluster: number[] = [centres[0]];
  for (let i = 1; i < centres.length; i += 1) {
    if (centres[i] - cluster[cluster.length - 1] <= COLUMN_TOLERANCE) {
      cluster.push(centres[i]);
    } else {
      cols.push(cluster.reduce((s, v) => s + v, 0) / cluster.length);
      cluster = [centres[i]];
    }
  }
  cols.push(cluster.reduce((s, v) => s + v, 0) / cluster.length);
  return cols;
}

/** Merge x-adjacent items (touching, no real gap) into text cells. */
function mergeAdjacent(line: readonly Item[]): string[] {
  const cells: string[] = [];
  let buf: Item[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    cells.push(buf.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim());
    buf = [];
  };
  for (let i = 0; i < line.length; i += 1) {
    if (buf.length > 0) {
      const prev = line[i - 1];
      if (line[i].x - (prev.x + prev.w) > 6) flush();
    }
    buf.push(line[i]);
  }
  flush();
  return cells;
}

/** Assign each item to its nearest column centre; join per column. */
function bucketIntoColumns(line: readonly Item[], columns: readonly number[]): Row {
  const cols: string[][] = columns.map(() => []);
  for (const item of line) {
    const c = centre(item);
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < columns.length; i += 1) {
      const d = Math.abs(c - columns[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    cols[best].push(item.str);
  }
  const cells = cols.map((parts) => parts.join(" ").replace(/\s+/g, " ").trim());
  return { cells, cellCount: cells.length };
}

export async function parsePdfReport(
  data: Uint8Array,
  utcOffsetMinutes: number,
): Promise<ParsedReport> {
  let pages: Item[][];
  try {
    pages = await extractItemsPerPage(data);
  } catch {
    throw new ReportParseError(
      "Couldn't read that PDF. If it's a scanned image or password-protected, export the MT5 report as HTML instead.",
      "not_a_report",
    );
  }

  const allItems = pages.flat();
  if (allItems.length === 0) {
    throw new ReportParseError(
      "This PDF has no selectable text (it looks scanned/flattened). Export the MT5 report as HTML, or 'Save as PDF' from the MT5 app.",
      "not_a_report",
    );
  }

  const plainText = allItems.map((i) => i.str).join(" ");
  const lines = pages.flatMap((p) => groupIntoLines(p));
  const columns = detectColumns(lines);

  const rows: Row[] = lines.map((line) => {
    // Short lines (section banners "Positions"/"Orders", account/summary text)
    // pass through as-is so the shared parser can detect section boundaries.
    if (line.length < MIN_TABULAR_ITEMS || columns.length === 0) {
      const cells = mergeAdjacent(line);
      return { cells, cellCount: cells.length };
    }
    return bucketIntoColumns(line, columns);
  });

  return parseReportRows(rows, plainText, utcOffsetMinutes);
}
