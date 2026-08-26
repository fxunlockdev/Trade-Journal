import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  getTheme,
  POSTER_THEMES,
  type PosterTheme,
} from "@/lib/posters/theme";

/**
 * A poster theme is consumed as `theme.tWhatever` at dozens of sites across the
 * three templates, and a missing token renders as `undefined` in a CSS string
 * rather than throwing. The result is an invisible element on a published
 * image, so the shape of every theme is worth pinning.
 */
const TOKENS: readonly (keyof PosterTheme)[] = [
  "tBg",
  "tText",
  "tText2",
  "tMuted",
  "tFaint",
  "tAccent",
  "tGlow1",
  "tGlow2",
  "tBlush",
  "tStreak",
  "tFrame",
  "tFrameSoft",
  "tGridLine",
  "tChipBorder",
  "tCardFill",
  "tCardBg",
  "tRowLine",
  "tTopBar",
  "tNumGrad",
  "win",
  "loss",
];

describe("POSTER_THEMES", () => {
  it("has every theme carrying every token, non-empty", () => {
    for (const theme of POSTER_THEMES) {
      for (const token of TOKENS) {
        expect(theme[token], `${theme.id}.${token}`).toBeTruthy();
        expect(typeof theme[token], `${theme.id}.${token}`).toBe("string");
      }
    }
  });

  it("has unique ids, so getTheme can't be ambiguous", () => {
    const ids = POSTER_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a distinct human label per theme", () => {
    const labels = POSTER_THEMES.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l.trim()).not.toBe("");
  });

  it("uses literal colours, never a CSS variable", () => {
    // A poster must rasterise identically whatever the app's light/dark class
    // happens to be. A var() would resolve against the page and make a
    // downloaded PNG change colour with a UI setting.
    for (const theme of POSTER_THEMES) {
      for (const token of TOKENS) {
        expect(String(theme[token]), `${theme.id}.${token}`).not.toContain(
          "var(",
        );
      }
    }
  });

  it("resolves the default id", () => {
    expect(POSTER_THEMES.some((t) => t.id === DEFAULT_THEME_ID)).toBe(true);
    expect(getTheme(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID);
  });

  it("falls back rather than throwing on an unknown id", () => {
    // Theme choice is component state that can outlive a theme being renamed
    // or removed, so an unknown id has to render something.
    expect(getTheme("no-such-theme").id).toBe(DEFAULT_THEME_ID);
    expect(getTheme("").id).toBe(DEFAULT_THEME_ID);
  });

  it("includes the blue-violet theme, and it runs blue into purple", () => {
    const t = POSTER_THEMES.find((x) => x.id === "blue-violet");
    expect(t).toBeDefined();
    // The two ambient washes are painted at opposite corners, so they must be
    // different colours or the theme reads as a single hue.
    expect(t!.tGlow1).not.toBe(t!.tGlow2);
    // The hero numeral's gradient is the whole point of the pairing.
    expect(t!.tNumGrad).toContain("gradient");
  });
});
