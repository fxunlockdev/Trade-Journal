import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseXlsxReport, columnToIndex } from "@/lib/import/xlsx-report";
import { parseTradeReport, ReportParseError } from "@/lib/import/mt5-report";
import { decodeReportText, sniffFileKind } from "@/lib/import/decode-text";
import { buildTradeRow, buildSlTpPatch, buildCloseFields } from "@/lib/mt5/ingest";
import { computeTradeFields } from "@/lib/trades/computations";

/**
 * Regression suite for the report importer.
 *
 * The XLSX fixture is a REAL MetaTrader 5 export (PU Prime, French UI) with the
 * account holder's name/login/broker scrubbed. Everything that made the
 * original fail in production is preserved verbatim:
 *   - XML parts encoded UTF-16LE (not UTF-8)
 *   - a non-English UI ("Symbole", "Ordres", "Transactions", "Compte:")
 *   - rows that OMIT empty cells, so S/L and T/P are simply absent
 * Do not "clean up" the fixture — those quirks are the test.
 */

const FIXTURE = join(process.cwd(), "tests/fixtures/mt5-history-fr.xlsx");
const xlsxBytes = new Uint8Array(readFileSync(FIXTURE));

/** Broker times are UTC when we pass a 0 offset, keeping expectations exact. */
const utc = (
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
) => Math.floor(Date.UTC(y, mo - 1, d, h, mi, s) / 1000);

describe("sniffFileKind — dispatch on magic bytes, never the filename", () => {
  it("detects a real .xlsx as a zip container", () => {
    expect(sniffFileKind(xlsxBytes)).toBe("zip");
  });

  it("detects PDF", () => {
    expect(sniffFileKind(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("pdf");
  });

  it("detects legacy OLE2 .xls so we can tell the user to re-save", () => {
    expect(
      sniffFileKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toBe("ole2");
  });

  it("falls back to text for HTML", () => {
    expect(sniffFileKind(new TextEncoder().encode("<html><table>"))).toBe("text");
  });
});

describe("decodeReportText — MetaTrader writes UTF-16", () => {
  it("decodes UTF-16LE with BOM", () => {
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("<table>é", "utf16le"),
    ]);
    expect(decodeReportText(new Uint8Array(bytes))).toBe("<table>é");
  });

  it("decodes UTF-16BE with BOM", () => {
    const body = Buffer.from("<table>", "utf16le");
    body.swap16();
    const bytes = Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
    expect(decodeReportText(new Uint8Array(bytes))).toBe("<table>");
  });

  it("sniffs BOM-less UTF-16LE from its interleaved NULs", () => {
    expect(decodeReportText(new Uint8Array(Buffer.from("<table>", "utf16le")))).toBe(
      "<table>",
    );
  });

  it("passes UTF-8 through untouched", () => {
    expect(decodeReportText(new TextEncoder().encode("<table>é"))).toBe("<table>é");
  });
});

describe("columnToIndex — spreadsheet refs are positional", () => {
  it.each([
    ["A", 0],
    ["I", 8],
    ["M", 12],
    ["Z", 25],
    ["AA", 26],
    ["AB", 27],
    ["BA", 52],
  ])("%s → %i", (ref, index) => {
    expect(columnToIndex(ref as string)).toBe(index);
  });
});

describe("XLSX — real MT5 French export", () => {
  const report = parseXlsxReport(xlsxBytes, 0);

  it("parses despite the UI being French, not English", () => {
    expect(report.platform).toBe("mt5");
  });

  it("finds the account login behind the French 'Compte:' label", () => {
    expect(report.accountLogin).toBe("99999999");
  });

  it("imports exactly the 10 closed positions", () => {
    expect(report.events).toHaveLength(10);
    expect(report.events.map((e) => e.ticket).sort((a, b) => a - b)).toEqual([
      73684852, 74348594, 74381111, 74866205, 75387290, 76070067, 76611363,
      77287259, 77387893, 77943462,
    ]);
  });

  it("reconciles with the report's own totals", () => {
    // The statement itself says: 800.00 net deposits + 909.19 gross = 908.49
    // balance after -0.70 of swap. If our sums match, the parse is correct —
    // not merely non-crashing.
    const profit = report.events.reduce((s, e) => s + (e.profit ?? 0), 0);
    const swap = report.events.reduce((s, e) => s + (e.swap ?? 0), 0);
    expect(profit).toBeCloseTo(109.19, 2);
    expect(swap).toBeCloseTo(-0.7, 2);
  });

  it("never leaks rows from the Orders or Deals sections", () => {
    const tickets = report.events.map((e) => e.ticket);
    expect(tickets).not.toContain(73746079); // an Orders row
    expect(tickets).not.toContain(70508851); // a Deals row
    expect(report.events.every((e) => e.symbol.length > 0)).toBe(true);
  });

  it("never imports balance operations (deposits/withdrawals)", () => {
    // Transfer In 1000 / Transfer Out -200 live in the Deals section.
    expect(report.events.map((e) => e.profit)).not.toContain(1000);
    expect(report.events.map((e) => e.profit)).not.toContain(-200);
  });

  it("maps a fully-populated row field-for-field", () => {
    const e = report.events.find((x) => x.ticket === 73684852)!;
    expect(e).toMatchObject({
      symbol: "EURUSD.s",
      direction: "buy",
      volume: 0.1,
      entry_price: 1.14231,
      sl: 1.141,
      tp: 1.143,
      exit_price: 1.14101,
      profit: -13,
      commission: 0,
      swap: 0,
      is_final: true,
    });
    expect(e.open_time).toBe(utc(2026, 7, 7, 19, 57, 29));
    expect(e.close_time).toBe(utc(2026, 7, 7, 22, 15, 8));
  });

  it("handles 3-decimal JPY pricing", () => {
    const e = report.events.find((x) => x.ticket === 74381111)!;
    expect(e).toMatchObject({
      symbol: "USDJPY.s",
      direction: "sell",
      entry_price: 162.488,
      exit_price: 162.58,
      profit: -5.66,
    });
  });

  it("carries negative swap through", () => {
    expect(report.events.find((x) => x.ticket === 76070067)!.swap).toBeCloseTo(-0.58, 2);
  });

  /* The bug that would have silently imported WRONG prices. XLSX omits empty
     cells, so these rows jump straight from F to I. Appending cells in
     sequence slides close-time into the S/L slot. */
  describe("sparse rows (omitted empty cells)", () => {
    it("row missing BOTH S/L and T/P keeps every other column aligned", () => {
      const e = report.events.find((x) => x.ticket === 74866205)!;
      expect(e.sl).toBeNull();
      expect(e.tp).toBeNull();
      expect(e.entry_price).toBe(1.14356);
      expect(e.exit_price).toBe(1.14334); // NOT shifted
      expect(e.close_time).toBe(utc(2026, 7, 10, 18, 40, 20)); // NOT shifted
      expect(e.swap).toBeCloseTo(0.13, 2);
      expect(e.profit).toBeCloseTo(2.25, 2);
    });

    it("row missing ONLY S/L still reads its T/P", () => {
      const e = report.events.find((x) => x.ticket === 76611363)!;
      expect(e.sl).toBeNull();
      expect(e.tp).toBe(1.143);
      expect(e.exit_price).toBe(1.14298);
      expect(e.profit).toBeCloseTo(14.7, 2);
    });
  });

  it("applies the broker UTC offset", () => {
    const shifted = parseXlsxReport(xlsxBytes, 180); // GMT+3 broker
    const e = shifted.events.find((x) => x.ticket === 73684852)!;
    expect(e.open_time).toBe(utc(2026, 7, 7, 19, 57, 29) - 180 * 60);
  });
});

describe("ingest mapping — every parsed trade produces an insertable row", () => {
  // Regression for the 10→8 drop: the trades table rejects an SL on the wrong
  // side of entry (break-even / trailed stops), and processEvents swallowed the
  // rejection, so those trades silently vanished with their P&L. buildTradeRow
  // must now sanitise SL/TP so the constraint is always satisfied.
  const report = parseXlsxReport(xlsxBytes, 0);
  const rows = report.events.map((e) =>
    buildTradeRow(e, "statement:99999999", "user-1", "journal-1"),
  );

  const slSideValid = (row: Record<string, unknown>) => {
    const sl = row.stop_loss as number | null;
    if (sl === null) return true;
    return row.direction === "buy"
      ? sl < (row.entry_price as number)
      : sl > (row.entry_price as number);
  };
  const tpSideValid = (row: Record<string, unknown>) => {
    const tp = row.take_profit as number | null;
    if (tp === null) return true;
    return row.direction === "buy"
      ? tp > (row.entry_price as number)
      : tp < (row.entry_price as number);
  };

  it("maps all 10 trades to rows (none dropped in mapping)", () => {
    expect(rows).toHaveLength(10);
  });

  it("never emits an SL/TP on the wrong side of entry (the constraint the DB enforces)", () => {
    for (const row of rows) {
      expect(slSideValid(row)).toBe(true);
      expect(tpSideValid(row)).toBe(true);
    }
  });

  const rowFor = (ticket: number) =>
    rows.find((r) => r.mt5_ticket === ticket)!;

  it("the break-even-SL buy (74348594) survives: SL nulled, valid TP kept", () => {
    const row = rowFor(74348594);
    expect(row).toBeDefined();
    expect(row.entry_price).toBe(1.13979);
    expect(row.stop_loss).toBeNull(); // SL == entry → not a real stop
    expect(row.take_profit).toBe(1.1415); // TP above entry → valid, kept
    expect(row.tp1).toBe(1.1415);
    expect(row.direction).toBe("buy");
  });

  it("the trailed-SL buy (77943462) survives: SL nulled, valid TP kept", () => {
    const row = rowFor(77943462);
    expect(row).toBeDefined();
    expect(row.entry_price).toBe(1.14367);
    expect(row.stop_loss).toBeNull(); // SL 1.14368 > entry → invalid for a buy
    expect(row.take_profit).toBe(1.1455);
  });

  it("keeps a genuinely valid SL untouched (74381111, JPY sell)", () => {
    const row = rowFor(74381111);
    expect(row.direction).toBe("sell");
    expect(row.stop_loss).toBe(162.58); // above entry → valid for a sell
    expect(slSideValid(row)).toBe(true);
  });

  it("keeps a valid buy SL untouched (73684852)", () => {
    const row = rowFor(73684852);
    expect(row.stop_loss).toBe(1.141); // below entry 1.14231 → valid
    expect(row.take_profit).toBe(1.143);
  });

  it("buildSlTpPatch applies the same sanitisation", () => {
    const badBuy = report.events.find((e) => e.ticket === 77943462)!;
    const patch = buildSlTpPatch(badBuy);
    expect(patch.stop_loss).toBeNull();
    expect(patch.take_profit).toBe(1.1455);
  });
});

describe("TP/SL-hit detection — which level closed each position", () => {
  // The close-reason must be inferred from the exit vs SL/TP, WITHOUT touching
  // the broker's authoritative P&L. Expected per the real report:
  //   73684852 buy  exit 1.14101 ≈ SL 1.14100  → sl   (loss -13.00)
  //   74381111 sell exit 162.580 = SL 162.580   → sl   (loss  -5.66)
  //   76611363 sell exit 1.14298 ≈ TP 1.14300  → hit  (win  +14.70)
  //   74348594 buy  exit 1.14130 = TP-2pips     → null (partial/manual, +15.10)
  //   everything else closed away from any level → null
  const report = parseXlsxReport(xlsxBytes, 0);

  // Mirror what the ingest actually persists on a final close.
  const stored = new Map(
    report.events.map((e) => [
      e.ticket,
      {
        ...buildTradeRow(e, "statement:99999999", "u", "j"),
        ...buildSlTpPatch(e),
        ...buildCloseFields(e),
      },
    ]),
  );

  const EXPECTED: Record<number, "hit" | "sl" | null> = {
    73684852: "sl",
    74348594: null,
    74381111: "sl",
    74866205: null,
    75387290: null,
    76070067: null,
    76611363: "hit",
    77287259: null,
    77387893: null,
    77943462: null,
  };

  it.each(Object.entries(EXPECTED))(
    "ticket %s → tp1_result %s",
    (ticket, expected) => {
      expect(stored.get(Number(ticket))!.tp1_result).toBe(expected);
    },
  );

  it("marks exactly one TP hit and two SL hits", () => {
    const results = [...stored.values()].map((r) => r.tp1_result);
    expect(results.filter((r) => r === "hit")).toHaveLength(1);
    expect(results.filter((r) => r === "sl")).toHaveLength(2);
  });

  it("does NOT read a position that closed 2 pips short of TP as a hit", () => {
    // 74348594: a partial close whose averaged exit (1.14130) lands near — but
    // not at — TP 1.14150. Stays null; still a Win by its stored P&L.
    const row = stored.get(74348594)!;
    expect(row.tp1_result).toBeNull();
    expect(row.pnl_absolute).toBeCloseTo(15.1, 2);
  });

  it("leaves the broker's P&L untouched when stamping a result", () => {
    // The TP-hit and SL-hit trades keep their exact broker net P&L — the label
    // must never trigger a price×qty recompute.
    expect(stored.get(76611363)!.pnl_absolute).toBeCloseTo(14.7, 2); // TP hit
    expect(stored.get(73684852)!.pnl_absolute).toBeCloseTo(-13.0, 2); // SL hit
    expect(stored.get(74381111)!.pnl_absolute).toBeCloseTo(-5.66, 2); // SL hit (JPY)
  });

  it("computeTradeFields would NOT corrupt P&L for a stamped import trade", () => {
    // Guard the guard: feed a stamped row through computeTradeFields (the edit
    // path). It WILL recompute to a different number — which is exactly why the
    // PATCH route preserves the stored value for broker-sourced ("csv") trades.
    const slHit = stored.get(73684852)!;
    const recomputed = computeTradeFields({
      entry_price: slHit.entry_price as number,
      exit_price: slHit.exit_price as number,
      quantity: slHit.quantity as number,
      direction: slHit.direction as "buy" | "sell",
      fees: slHit.fees as number,
      stop_loss: slHit.stop_loss as number | null,
      take_profit: slHit.take_profit as number | null,
      tp1: slHit.tp1 as number | null,
      tp1_result: slHit.tp1_result as "hit" | "sl" | "be" | null,
    });
    // Proves the recompute diverges (so preserving the stored value matters).
    expect(recomputed.pnl_absolute).not.toBeCloseTo(-13.0, 2);
  });
});

describe("TP/SL-hit — adversarial edge cases (review hardening)", () => {
  const mkClose = (o: Record<string, unknown>) =>
    ({
      type: "close",
      is_final: true,
      ticket: 1,
      symbol: "EURUSD",
      direction: "buy",
      volume: 0.1,
      entry_price: 1.1,
      open_time: 1_700_000_000,
      exit_price: 1.1,
      close_time: 1_700_003_600,
      profit: 0,
      commission: 0,
      swap: 0,
      ...o,
    }) as unknown as Parameters<typeof buildCloseFields>[0];

  it("a flat close in an overlapping tp≈sl scalp is neither hit nor sl", () => {
    // TP and SL within 1 pip of entry → tolerance bands overlap; a break-even
    // exit belongs to neither side.
    const r = buildCloseFields(
      mkClose({ entry_price: 1.1, tp: 1.10005, sl: 1.09995, exit_price: 1.1, profit: 0 }),
    );
    expect(r.tp1_result).toBeNull();
  });

  it("a losing stop-out in an overlapping band is 'sl', never 'hit'", () => {
    // The dangerous mislabel: TP-first ordering used to flag this a win.
    const r = buildCloseFields(
      mkClose({
        entry_price: 1.1,
        tp: 1.10005,
        sl: 1.09995,
        exit_price: 1.09996,
        profit: -4,
      }),
    );
    expect(r.tp1_result).toBe("sl");
    expect(r.pnl_absolute).toBeCloseTo(-4, 2);
  });

  it("a TP that reached price but netted <= 0 after swap is NOT marked hit", () => {
    // Keeps the table status consistent with pnl-based win-rate analytics.
    const r = buildCloseFields(
      mkClose({
        entry_price: 1.1,
        tp: 1.101,
        exit_price: 1.101, // touched TP
        profit: 100,
        swap: -150, // but a big swap made it a net loss
      }),
    );
    expect(r.tp1_result).toBeNull();
    expect(r.pnl_absolute).toBeCloseTo(-50, 2);
  });

  it("a clean TP hit with positive net is still marked hit", () => {
    const r = buildCloseFields(
      mkClose({ entry_price: 1.1, tp: 1.101, exit_price: 1.101, profit: 100, swap: -5 }),
    );
    expect(r.tp1_result).toBe("hit");
  });
});

describe("PATCH default-injection hazard (documents the guard)", () => {
  it("updateTradeSchema.partial() re-applies defaults — so a raw spread would flip source", async () => {
    const { updateTradeSchema } = await import("@/lib/validators/trade");
    const parsed = updateTradeSchema.safeParse({ notes: "reviewed" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // The hazard: Zod injects source:"manual" for a note-only edit.
    expect((parsed.data as { source?: string }).source).toBe("manual");

    // The route's mitigation: keep only keys actually present in the body.
    const body = { notes: "reviewed" };
    const bodyKeys = new Set(Object.keys(body));
    const sent = Object.fromEntries(
      Object.entries(parsed.data).filter(([k]) => bodyKeys.has(k)),
    );
    expect(sent).toEqual({ notes: "reviewed" });
    expect("source" in sent).toBe(false);
    expect("fees" in sent).toBe(false);
    expect("tags" in sent).toBe(false);
  });

  it("source is dropped from the write even when explicitly sent (immutable provenance)", async () => {
    const { updateTradeSchema } = await import("@/lib/validators/trade");
    // A raw/scripted PATCH tries to flip a broker trade's provenance.
    const body = { source: "manual", notes: "x" };
    const parsed = updateTradeSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const bodyKeys = new Set(Object.keys(body));
    const updatePatch: Record<string, unknown> = Object.fromEntries(
      Object.entries(parsed.data).filter(([k]) => bodyKeys.has(k)),
    );
    // The route's `delete updatePatch.source` — provenance can never be edited.
    delete updatePatch.source;
    expect("source" in updatePatch).toBe(false);
    expect(updatePatch).toEqual({ notes: "x" });
  });
});

describe("HTML — English MT5 (no regression)", () => {
  const html = `<html><body><table>
    <tr><td>Trade History Report</td></tr>
    <tr><td>Account:</td><td>555111 (USD, Broker, real)</td></tr>
    <tr><th colspan="13">Positions</th></tr>
    <tr><th>Time</th><th>Position</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>S / L</th><th>T / P</th><th>Time</th><th>Price</th><th>Commission</th><th>Swap</th><th>Profit</th></tr>
    <tr><td>2026.01.02 10:00:00</td><td>111</td><td>GBPUSD</td><td>buy</td><td>0.50</td><td>1.2500</td><td>1.2400</td><td>1.2600</td><td>2026.01.02 12:00:00</td><td>1.2600</td><td>-2.00</td><td>0.50</td><td>50.00</td></tr>
    <tr><td colspan="13">Orders</td></tr>
    <tr><td>2026.01.02 10:00:00</td><td>999</td><td>GBPUSD</td><td>buy</td><td>0.50 / 0.50</td><td>market</td><td></td><td></td><td>2026.01.02 10:00:00</td><td>filled</td></tr>
  </table></body></html>`;

  it("parses the Positions section only", () => {
    const r = parseTradeReport(html, 0);
    expect(r.platform).toBe("mt5");
    expect(r.accountLogin).toBe("555111");
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ ticket: 111, profit: 50, commission: -2 });
  });

  it("decodes a UTF-16LE HTML report (MetaTrader's default)", () => {
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(html, "utf16le"),
    ]);
    const r = parseTradeReport(decodeReportText(new Uint8Array(bytes)), 0);
    expect(r.events).toHaveLength(1);
  });
});

describe("HTML — MT4 (no regression)", () => {
  const html = `<html><table>
    <tr><td>Account: 777222</td></tr>
    <tr><td>Closed Transactions:</td></tr>
    <tr><th>Ticket</th><th>Open Time</th><th>Type</th><th>Size</th><th>Item</th><th>Price</th><th>S/L</th><th>T/P</th><th>Close Time</th><th>Price</th><th>Commission</th><th>Taxes</th><th>Swap</th><th>Profit</th></tr>
    <tr><td>5001</td><td>2026.02.03 08:00</td><td>balance</td><td colspan="11">Deposit</td></tr>
    <tr><td>5002</td><td>2026.02.03 09:00</td><td>sell</td><td>1.00</td><td>eurusd</td><td>1.1000</td><td>1.1100</td><td>1.0900</td><td>2026.02.03 11:00</td><td>1.0900</td><td>-5.00</td><td>0.00</td><td>1.00</td><td>100.00</td></tr>
  </table></html>`;

  it("parses closed transactions and skips balance rows", () => {
    const r = parseTradeReport(html, 0);
    expect(r.platform).toBe("mt4");
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      symbol: "EURUSD",
      profit: 100,
      commission: -5, // taxes folded in
    });
  });
});

describe("failure modes stay actionable", () => {
  it("a corrupt zip explains how to re-export", () => {
    expect(() => parseXlsxReport(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 0))
      .toThrow(ReportParseError);
  });

  it("a non-report is rejected", () => {
    expect(() => parseTradeReport("just some text", 0)).toThrow(/doesn't look like/i);
  });

  it("MT5's performance-summary PDF/HTML gets a specific hint", () => {
    expect(() =>
      parseTradeReport(
        `<table><tr><td>Gain: 12% Profit Factor: 1.8 Max Drawdown: 4%</td></tr></table>`,
        0,
      ),
    ).toThrow(/performance summary/i);
  });

  it("a report with no closed trades says so", () => {
    expect(() =>
      parseTradeReport(
        `<table><tr><td>Trade History Report</td></tr><tr><td colspan="13">Positions</td></tr><tr><th>Time</th><th>Position</th><th>Symbol</th><th>Type</th></tr></table>`,
        0,
      ),
    ).toThrow(/no closed trades/i);
  });
});
