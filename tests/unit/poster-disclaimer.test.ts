import { describe, expect, it } from "vitest";
import { posterDisclaimer } from "@/lib/posters/disclaimer";
import { POSTER_DISCLAIMER } from "@/lib/posters/theme";
import type { PosterStats } from "@/lib/posters/poster-data";

/**
 * These notes are the difference between a poster that is true and one that is
 * merely not false.
 *
 * They existed only on the preview a human looks at; the scheduled render built
 * its own shorter version, so every poster published unattended to partners had
 * them stripped. One builder now serves both, and these pin what it must say.
 */

const stats = (o: Partial<PosterStats> = {}): PosterStats =>
  ({
    pips: 475,
    tradeCount: 38,
    wins: 27,
    losses: 11,
    breakeven: 0,
    winRate: 71,
    avgR: 1.0,
    rCovered: 38,
    asset: "ALL PAIRS",
    log: [],
    closeTimeKnown: 38,
    timeZone: "Asia/Dubai",
    ...o,
  }) as PosterStats;

describe("posterDisclaimer", () => {
  it("always carries the standing risk warning", () => {
    expect(posterDisclaimer(stats(), 1)).toContain(POSTER_DISCLAIMER);
  });

  it("says nothing extra when every figure covers everything", () => {
    expect(posterDisclaimer(stats(), 1)).toBe(POSTER_DISCLAIMER);
  });

  it("discloses trades placed by entry date", () => {
    // 165 of 166 real trades have no recorded close time, so almost every
    // poster rests on this fallback. It is the most likely reason a poster
    // disagrees with someone reading the journal.
    const text = posterDisclaimer(stats({ closeTimeKnown: 30 }), 1);
    expect(text).toContain("8 trades placed by entry date");
  });

  it("uses the singular for one such trade", () => {
    const text = posterDisclaimer(stats({ closeTimeKnown: 37 }), 1);
    expect(text).toContain("1 trade placed by entry date");
  });

  it("discloses that the win rate excludes breakevens", () => {
    // Without this, a poster reading 38 trades / 27 wins / 11 losses with two
    // breakevens simply does not add up, and nothing on it explains why.
    const text = posterDisclaimer(stats({ breakeven: 2, wins: 25 }), 1);
    expect(text).toContain("excludes 2 breakeven trades");
    expect(text).toContain("do not sum to the trade count");
  });

  it("discloses when Avg R covers only some trades", () => {
    const text = posterDisclaimer(stats({ rCovered: 14 }), 1);
    expect(text).toContain("Avg R covers the 14 of 38 trades");
  });

  it("says a poster combines journals", () => {
    // A reader would otherwise take two traders' figures for one record.
    expect(posterDisclaimer(stats(), 2)).toMatch(/[Cc]ombined/);
  });

  it("carries every note at once when every caveat applies", () => {
    const text = posterDisclaimer(
      stats({ breakeven: 2, rCovered: 14, closeTimeKnown: 30 }),
      2,
    );
    expect(text).toMatch(/[Cc]ombined/);
    expect(text).toContain("Avg R covers");
    expect(text).toContain("breakeven");
    expect(text).toContain("entry date");
    expect(text).toContain(POSTER_DISCLAIMER);
  });

  it("falls back to the risk warning with no stats", () => {
    expect(posterDisclaimer(null, 1)).toBe(POSTER_DISCLAIMER);
  });
});
