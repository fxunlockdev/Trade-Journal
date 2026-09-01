import { describe, expect, it } from "vitest";
import { buildCaption, escapeHtml } from "@/lib/reports/caption";
import { computeReportMetrics } from "@/lib/reports/metrics";
import {
  retryAfterMs,
  retryFitsBudget,
  CAPTION_MAX,
} from "@/lib/telegram/media";
import type { Trade } from "@/types/database";

/**
 * A caption is published text sitting under published images. These tests are
 * about the ways a plausible caption would be WRONG: a figure the trades never
 * supported, a total across two currencies, or a desk name that breaks the send
 * it is part of.
 */

let seq = 0;
const mk = (o: Partial<Trade> = {}): Trade =>
  ({
    id: `t${seq++}`,
    instrument: "EURUSD",
    asset_type: "forex",
    direction: "buy",
    entry_price: 1.1,
    exit_price: 1.101,
    quantity: 10_000,
    fees: 0,
    stop_loss: 1.099,
    pnl_absolute: 100,
    pnl_currency: "USD",
    r_multiple: 1,
    entry_time: "2026-08-25T12:00:00Z",
    exit_time: null,
    tp1: null,
    tp1_result: null,
    ...o,
  }) as unknown as Trade;

const caption = (trades: readonly Trade[], deskName = "Gold Intraday") =>
  buildCaption({
    deskName,
    cadence: "daily",
    periodLabel: "1 Sep 2026",
    metrics: computeReportMetrics(trades, "Europe/London"),
  });

describe("escapeHtml", () => {
  it("escapes the three characters Telegram's HTML mode reserves", () => {
    expect(escapeHtml("Gold <b> & co")).toBe("Gold &lt;b&gt; &amp; co");
  });

  it("escapes the ampersand first, so escapes are not double-escaped", () => {
    // Naive ordering turns "<" into "&lt;" and then the "&" into "&amp;lt;".
    expect(escapeHtml("<")).toBe("&lt;");
  });
});

describe("buildCaption", () => {
  it("names the desk, the cadence and the period", () => {
    const text = caption([mk()]);
    expect(text).toContain("<b>Gold Intraday</b>");
    expect(text).toContain("Daily · 1 Sep 2026");
  });

  it("signs the pip total, so a gain cannot read as a loss", () => {
    expect(caption([mk()])).toMatch(/\+\d+ pips/);
  });

  it("says 'trade' not 'trades' for a single trade", () => {
    expect(caption([mk()])).toContain("1 trade ·");
  });

  it("neutralises a desk name that would break the send", () => {
    // An unescaped "<b>" here is a malformed entity: Telegram rejects the whole
    // call, so the images do not post either.
    const text = caption([mk()], "Gold <b>");
    expect(text).toContain("&lt;b&gt;");
    expect(text).not.toContain("<b>Gold <b></b>");
  });

  it("omits R entirely when no trade carried a stop", () => {
    // avgR/netR are null without stops. Printing "Net +0.0R" would state a
    // result that was never measured.
    const text = caption([mk({ stop_loss: null, r_multiple: null })]);
    expect(text).not.toMatch(/R\b/);
  });

  it("discloses when only some trades carried a stop", () => {
    const text = caption([mk(), mk({ stop_loss: null, r_multiple: null })]);
    expect(text).toContain("with a stop");
  });

  it("omits money rather than summing across currencies", () => {
    const text = caption([
      mk({ pnl_currency: "USD" }),
      mk({ pnl_currency: "EUR" }),
    ]);
    expect(text).not.toMatch(/Net -?\+?[\d.]+ (USD|EUR)/);
  });

  it("prints money when the period agrees on one currency", () => {
    expect(caption([mk({ pnl_currency: "USD" })])).toMatch(/Net \+[\d.]+ USD/);
  });

  it("never exceeds Telegram's caption limit", () => {
    const text = caption([mk()], "D".repeat(4000));
    expect(text.length).toBeLessThanOrEqual(CAPTION_MAX);
  });
});

describe("retryAfterMs", () => {
  it("reads Telegram's back-pressure instruction", () => {
    expect(retryAfterMs({ parameters: { retry_after: 5 } })).toBe(5000);
  });

  it("is null when Telegram did not ask us to wait", () => {
    expect(retryAfterMs({ description: "Bad Request" })).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
  });

  it("clamps an absurd wait rather than parking the function", () => {
    // A serverless invocation that sleeps for an hour is a billing incident.
    expect(retryAfterMs({ parameters: { retry_after: 99_999 } })).toBe(60_000);
  });

  it("ignores a negative or non-numeric wait", () => {
    expect(retryAfterMs({ parameters: { retry_after: -1 } })).toBeNull();
    expect(
      retryAfterMs({ parameters: { retry_after: "5" } } as never),
    ).toBeNull();
  });
});

describe("retryFitsBudget", () => {
  it("allows a wait that leaves room for the call itself", () => {
    // 5s wait + a 60s call budget fits inside 120s remaining.
    expect(retryFitsBudget(5_000, 120_000)).toBe(true);
  });

  it("refuses a wait that would outlast the invocation", () => {
    // Sleeping 60s with 20s left converts a rate-limit into a platform kill,
    // which leaves the send in doubt: strictly worse than giving up cleanly.
    expect(retryFitsBudget(60_000, 20_000)).toBe(false);
  });

  it("refuses when the wait fits but the retry could not finish", () => {
    // 10s wait fits in 30s, but the call needs 60s more than we have.
    expect(retryFitsBudget(10_000, 30_000)).toBe(false);
  });

  it("accounts for a shorter call budget", () => {
    expect(retryFitsBudget(10_000, 30_000, 15_000)).toBe(true);
  });
});
