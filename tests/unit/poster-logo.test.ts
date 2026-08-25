import { describe, expect, it } from "vitest";
import {
  fitWithin,
  hasTransparency,
  isPngSignature,
  LOGO_MAX_EDGE,
  logoStorageKey,
} from "@/lib/posters/logo";

/** The 8-byte PNG signature, as a real PNG's first bytes. */
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** JPEG's SOI marker plus JFIF, i.e. what a renamed photo actually starts with. */
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];

/** Build an RGBA buffer of `count` pixels, every one at the given alpha. */
function pixels(count: number, alpha: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    buf[i * 4 + 0] = 200;
    buf[i * 4 + 1] = 100;
    buf[i * 4 + 2] = 50;
    buf[i * 4 + 3] = alpha;
  }
  return buf;
}

describe("isPngSignature — format is decided by bytes, never the filename", () => {
  it("accepts the PNG signature", () => {
    expect(isPngSignature(new Uint8Array([...PNG_HEAD, 0x00, 0x01]))).toBe(true);
  });

  it("rejects a JPEG, which is what a renamed photo.jpg actually is", () => {
    expect(isPngSignature(new Uint8Array(JPEG_HEAD))).toBe(false);
  });

  it("rejects a truncated file rather than reading past the end", () => {
    expect(isPngSignature(new Uint8Array(PNG_HEAD.slice(0, 4)))).toBe(false);
    expect(isPngSignature(new Uint8Array([]))).toBe(false);
  });

  it("rejects a near-miss that shares the first bytes", () => {
    // Same 0x89 'P' 'N' 'G' opening, wrong CRLF/EOF terminator. A prefix-only
    // check would let this through.
    expect(
      isPngSignature(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x0d, 0x1a, 0x0a]),
      ),
    ).toBe(false);
  });
});

describe("hasTransparency — the background heuristic", () => {
  it("reports a fully opaque image as having a background", () => {
    expect(hasTransparency(pixels(64, 255))).toBe(false);
  });

  it("reports a fully transparent image as transparent", () => {
    expect(hasTransparency(pixels(64, 0))).toBe(true);
  });

  it("catches partial alpha, not just fully-clear pixels", () => {
    const buf = pixels(64, 255);
    buf[3] = 254;
    expect(hasTransparency(buf)).toBe(true);
  });

  it("samples the alpha channel, never a colour channel", () => {
    // Every pixel is opaque but has a zero-valued BLUE channel. A stride that
    // isn't pixel-aligned would read that 0 as alpha and wrongly report
    // transparency, which would silently disable the warning for opaque logos.
    const buf = pixels(64, 255);
    for (let i = 0; i < 64; i++) buf[i * 4 + 2] = 0;
    for (const stride of [1, 2, 3, 5, 7, 13]) {
      expect(hasTransparency(buf, stride)).toBe(false);
    }
  });

  it("finds a lone transparent pixel that the stride lands on", () => {
    const buf = pixels(64, 255);
    buf[10 * 4 + 3] = 0;
    expect(hasTransparency(buf, 1)).toBe(true);
  });

  it("coerces a nonsense stride to a safe one rather than looping forever", () => {
    const buf = pixels(16, 0);
    expect(hasTransparency(buf, 0)).toBe(true);
    expect(hasTransparency(buf, -5)).toBe(true);
    expect(hasTransparency(buf, 0.4)).toBe(true);
  });
});

describe("fitWithin — downscale, never enlarge", () => {
  it("leaves an already-small logo alone", () => {
    expect(fitWithin(200, 80, LOGO_MAX_EDGE)).toEqual({ width: 200, height: 80 });
  });

  it("scales the LONGEST edge to the cap", () => {
    expect(fitWithin(3000, 1500, 512)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(1500, 3000, 512)).toEqual({ width: 256, height: 512 });
  });

  it("preserves aspect ratio within a rounding pixel", () => {
    const { width, height } = fitWithin(1920, 1080, 512);
    expect(Math.abs(width / height - 1920 / 1080)).toBeLessThan(0.01);
  });

  it("never returns a zero edge for an extreme aspect ratio", () => {
    // A 4000x3 rule would round its height to 0 and produce a 0-height canvas,
    // which throws on drawImage.
    expect(fitWithin(4000, 3, 512).height).toBeGreaterThanOrEqual(1);
  });

  it("returns zeroes for degenerate input instead of NaN", () => {
    expect(fitWithin(0, 100, 512)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-10, 10, 512)).toEqual({ width: 0, height: 0 });
  });
});

describe("logoStorageKey — scoped exactly like the name it replaces", () => {
  it("is order-independent, so a combination has one entry", () => {
    expect(logoStorageKey(["b", "a"])).toBe(logoStorageKey(["a", "b"]));
  });

  it("returns null with no journals rather than a keyless global entry", () => {
    expect(logoStorageKey([])).toBeNull();
  });

  it("does not collide with the group-name key for the same journals", () => {
    expect(logoStorageKey(["a"])).not.toBe("trdr_poster_group:a");
    expect(logoStorageKey(["a"])).toBe("trdr_poster_logo:a");
  });

  it("gives different combinations different keys", () => {
    expect(logoStorageKey(["a"])).not.toBe(logoStorageKey(["a", "b"]));
  });
});
