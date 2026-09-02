import { describe, expect, it } from "vitest";
import {
  posterProblem,
  MIN_POSTER_BYTES,
  MIN_POSTER_TEXT,
} from "@/lib/reports/poster-check";
import { POSTER_DISCLAIMER } from "@/lib/posters/theme";
import { POSTER_SIZE } from "@/lib/posters/templates/types";

/**
 * This guard sits on an unattended path to a partner channel, so it has to be
 * right in BOTH directions.
 *
 * Rejecting a broken poster is the obvious half. Never rejecting a good one is
 * the dangerous half: a guard that is too strict does not degrade the feature,
 * it stops it completely, silently, at 06:00 on a morning nobody is watching.
 * The first block below is therefore the most important in this file.
 */

/** What a real poster's canvas actually contains: the headline figure, the
 *  counts, the desk name, the period, and the standing risk warning. */
const REAL_POSTER = {
  text: `+85\nPIPS\n6\n5\n1\nRENDER SPIKE\nAugust 2026\n${POSTER_DISCLAIMER}`,
  width: POSTER_SIZE,
  height: POSTER_SIZE,
  bytes: 240_000,
};

describe("a good poster is never rejected", () => {
  it("passes a realistic poster", () => {
    expect(posterProblem(REAL_POSTER, "design-a")).toBeNull();
  });

  it("passes a losing month, where the headline is negative", () => {
    expect(
      posterProblem({ ...REAL_POSTER, text: REAL_POSTER.text.replace("+85", "-142") }, "design-a"),
    ).toBeNull();
  });

  it("passes a flat result of exactly zero pips", () => {
    // "0" is falsy in JavaScript and this is exactly where a naive check
    // treats a real result as missing data.
    expect(
      posterProblem({ ...REAL_POSTER, text: REAL_POSTER.text.replace("+85", "0") }, "design-a"),
    ).toBeNull();
  });

  it("passes a single-trade day", () => {
    expect(
      posterProblem({ ...REAL_POSTER, text: "+12\nPIPS\n1\n1\n0\nFOREX\n28 Aug 2026\n" + POSTER_DISCLAIMER }, "design-b"),
    ).toBeNull();
  });

  it("passes the disclaimer alone comfortably over the text floor", () => {
    // Sanity: the floor must sit far below the smallest real poster, so it
    // cannot start rejecting good ones after a copy change.
    expect(POSTER_DISCLAIMER.replace(/\s+/g, "").length).toBeGreaterThan(
      MIN_POSTER_TEXT * 5,
    );
  });

  it("passes a poster only just over the byte floor", () => {
    expect(
      posterProblem({ ...REAL_POSTER, bytes: MIN_POSTER_BYTES }, "design-a"),
    ).toBeNull();
  });
});

describe("a broken poster is rejected", () => {
  it("rejects a collapsed layout", () => {
    const p = posterProblem({ ...REAL_POSTER, height: 0 }, "design-a");
    expect(p).toMatch(/laid out at/);
  });

  it("rejects an under-sized canvas", () => {
    const p = posterProblem({ ...REAL_POSTER, width: 400 }, "design-a");
    expect(p).toMatch(/expected 1080x1080/);
  });

  it("rejects an empty frame", () => {
    const p = posterProblem({ ...REAL_POSTER, text: "" }, "design-a");
    expect(p).toMatch(/almost no text/);
  });

  it("rejects whitespace masquerading as content", () => {
    // An empty frame usually still contains newlines and indentation, which a
    // naive length check would pass.
    const p = posterProblem({ ...REAL_POSTER, text: "\n\n    \t  \n" }, "design-a");
    expect(p).toMatch(/almost no text/);
  });

  it("rejects NaN, the one that gets forwarded", () => {
    const p = posterProblem(
      { ...REAL_POSTER, text: REAL_POSTER.text.replace("+85", "NaN") },
      "design-a",
    );
    expect(p).toMatch(/NaN/);
  });

  it("rejects undefined and Infinity too", () => {
    for (const bad of ["undefined", "Infinity", "[object Object]"]) {
      const p = posterProblem(
        { ...REAL_POSTER, text: `${bad}\nPIPS\n${POSTER_DISCLAIMER}` },
        "design-c",
      );
      expect(p).toContain(bad);
    }
  });

  it("rejects a PNG too small to be a drawn image", () => {
    const p = posterProblem({ ...REAL_POSTER, bytes: 1200 }, "design-a");
    expect(p).toMatch(/too small/);
  });

  it("names the style, so a partial album says which one failed", () => {
    expect(posterProblem({ ...REAL_POSTER, text: "" }, "design-c")).toContain(
      "design-c",
    );
  });
});

describe("before the screenshot", () => {
  it("checks everything it can without the bytes", () => {
    // Called once before the screenshot and again after, so a broken render
    // costs nothing further.
    const { bytes: _omitted, ...noBytes } = REAL_POSTER;
    expect(posterProblem(noBytes, "design-a")).toBeNull();
    expect(posterProblem({ ...noBytes, text: "" }, "design-a")).toMatch(
      /almost no text/,
    );
  });
});
