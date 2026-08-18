import { describe, it, expect } from "vitest";
import { damp, heroParallax } from "@/app/_home/useAppleMotion";

/**
 * These guard the two properties that made the landing page feel like it moved
 * on its own after the reader stopped scrolling.
 */
describe("hero parallax", () => {
  const VH = 800;

  it("starts at rest", () => {
    expect(heroParallax(0, VH)).toEqual({ y: 0, opacity: 1 });
  });

  it("is bounded no matter how far the page scrolls", () => {
    // The regression: y was scrollY * 0.3, so this row climbed forever and the
    // lerp kept chasing it long after the reader stopped.
    const cap = VH * 0.22;
    for (const sy of [1_000, 5_000, 50_000, 1_000_000]) {
      const { y, opacity } = heroParallax(sy, VH);
      expect(y).toBeLessThanOrEqual(cap);
      expect(opacity).toBeGreaterThanOrEqual(0.25);
    }
    expect(heroParallax(1_000_000, VH)).toEqual(heroParallax(VH * 0.85, VH));
  });

  it("moves monotonically and reaches the cap within one viewport", () => {
    let prev = -1;
    for (let sy = 0; sy <= VH; sy += 50) {
      const { y } = heroParallax(sy, VH);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    expect(heroParallax(VH * 0.85, VH).y).toBeCloseTo(VH * 0.22, 5);
  });

  it("survives a zero-height viewport during hydration", () => {
    expect(heroParallax(500, 0)).toEqual({ y: 0, opacity: 1 });
  });

  it("ignores negative scroll from rubber-banding", () => {
    expect(heroParallax(-300, VH)).toEqual({ y: 0, opacity: 1 });
  });
});

describe("damp", () => {
  it("matches the base factor at a 60Hz frame", () => {
    expect(damp(0.16, 16.667)).toBeCloseTo(0.16, 4);
  });

  it("settles at the same rate regardless of refresh rate", () => {
    // Two 120Hz frames must cover the same ground as one 60Hz frame, otherwise
    // the animation runs twice as fast on a ProMotion display.
    const frame60 = 16.667;
    const oneAt60 = damp(0.16, frame60);
    const k120 = damp(0.16, frame60 / 2);
    const twoAt120 = 1 - (1 - k120) ** 2;
    expect(twoAt120).toBeCloseTo(oneAt60, 10);
  });

  it("clamps long frames so a stalled tab cannot jump the animation", () => {
    // A backgrounded tab can hand back a multi-second dt; without the clamp the
    // factor saturates to 1 and everything teleports on the first frame back.
    expect(damp(0.16, 5_000)).toBe(damp(0.16, 50));
    expect(damp(0.16, 5_000)).toBeLessThan(1);
  });
});
