import { describe, expect, it } from "vitest";
import {
  clearTourSeen,
  hasSeenTour,
  markTourSeen,
  TOUR_STEPS,
  visibleSteps,
  type TourStep,
} from "@/lib/tour/steps";
import { placeTooltip, type Rect } from "@/lib/tour/position";

/** In-memory Storage stand-in. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** Storage that throws on every access, as private browsing can. */
const hostileStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("tour steps", () => {
  it("teaches the core loop in order", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      "journal",
      "add-trade",
      "journal-list",
      "dashboard",
    ]);
  });

  it("every step has somewhere to point and something to say", () => {
    for (const step of TOUR_STEPS) {
      expect(step.target.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(20);
    }
  });

  it("drops steps whose target isn't on the page", () => {
    // The sidebar is a drawer on mobile, so its anchors genuinely vanish.
    const present = new Set(["journal-switcher"]);
    const usable = visibleSteps(TOUR_STEPS, (t) => present.has(t));
    expect(usable.map((s) => s.id)).toEqual(["journal"]);
  });

  it("keeps the declared order when only some targets exist", () => {
    const present = new Set(["nav-dashboard", "journal-switcher"]);
    const usable = visibleSteps(TOUR_STEPS, (t) => present.has(t));
    expect(usable.map((s) => s.id)).toEqual(["journal", "dashboard"]);
  });

  it("returns nothing when the page has no anchors at all", () => {
    expect(visibleSteps(TOUR_STEPS, () => false)).toEqual([]);
  });

  it("does not reference a target twice — a repeated spotlight reads as a bug", () => {
    const targets = TOUR_STEPS.map((s) => s.target);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe("seen flag", () => {
  it("is false for a first-time visitor, true once marked", () => {
    const store = fakeStorage();
    expect(hasSeenTour(store)).toBe(false);
    markTourSeen(store);
    expect(hasSeenTour(store)).toBe(true);
  });

  it("clearing lets the tour run again", () => {
    const store = fakeStorage();
    markTourSeen(store);
    clearTourSeen(store);
    expect(hasSeenTour(store)).toBe(false);
  });

  it("treats unreadable storage as SEEN, so nobody gets stuck in a loop", () => {
    // Private browsing throws on access. Failing to "already seen" means the
    // worst case is missing the tour, not being shown it on every navigation
    // with no way to make it stop.
    expect(hasSeenTour(hostileStorage)).toBe(true);
  });

  it("never throws when storage is blocked", () => {
    expect(() => markTourSeen(hostileStorage)).not.toThrow();
    expect(() => clearTourSeen(hostileStorage)).not.toThrow();
  });
});

describe("tooltip placement", () => {
  const vp = { width: 1280, height: 800 };
  const tip = { width: 340, height: 180 };

  it("honours the preferred side when it fits", () => {
    const target: Rect = { top: 100, left: 600, width: 120, height: 40 };
    const p = placeTooltip("bottom", target, tip, vp);
    expect(p.placement).toBe("bottom");
    expect(p.top).toBe(100 + 40 + 14);
  });

  it("flips to the opposite side when the preferred one would overflow", () => {
    // Target near the bottom edge: "bottom" cannot fit.
    const target: Rect = { top: 760, left: 600, width: 120, height: 30 };
    const p = placeTooltip("bottom", target, tip, vp);
    expect(p.placement).toBe("top");
    expect(p.top).toBeGreaterThanOrEqual(0);
  });

  it("flips right to left beside a target on the right edge", () => {
    const target: Rect = { top: 300, left: 1200, width: 60, height: 40 };
    const p = placeTooltip("right", target, tip, vp);
    expect(p.placement).toBe("left");
    expect(p.left).toBeGreaterThanOrEqual(12);
  });

  it("keeps the tooltip fully on screen beside a target in the corner", () => {
    const target: Rect = { top: 8, left: 8, width: 40, height: 24 };
    const p = placeTooltip("right", target, tip, vp);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.left + tip.width).toBeLessThanOrEqual(vp.width);
    expect(p.top + tip.height).toBeLessThanOrEqual(vp.height);
  });

  it("centres as a last resort when no side fits", () => {
    // A viewport barely larger than the tooltip leaves no room on any side.
    const tiny = { width: 360, height: 200 };
    const target: Rect = { top: 0, left: 0, width: 360, height: 200 };
    const p = placeTooltip("bottom", target, tip, tiny);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.left).toBeGreaterThanOrEqual(12);
  });

  it("never returns NaN when the viewport is narrower than the tooltip", () => {
    const narrow = { width: 200, height: 400 };
    const target: Rect = { top: 50, left: 10, width: 50, height: 20 };
    const p = placeTooltip("right", target, tip, narrow);
    expect(Number.isFinite(p.top)).toBe(true);
    expect(Number.isFinite(p.left)).toBe(true);
  });

  it("centres on the target horizontally when placed above or below", () => {
    const target: Rect = { top: 300, left: 600, width: 200, height: 40 };
    const p = placeTooltip("bottom", target, tip, vp);
    // Target centre 700; tooltip centre should match.
    expect(p.left + tip.width / 2).toBeCloseTo(700, 0);
  });

  it("centres on the target vertically when placed beside it", () => {
    const target: Rect = { top: 300, left: 100, width: 60, height: 100 };
    const p = placeTooltip("right", target, tip, vp);
    expect(p.top + tip.height / 2).toBeCloseTo(350, 0);
  });
});

describe("copy quality", () => {
  it("does not promise features the core-loop tour skips", () => {
    // Coverage was scoped to the core loop; mentioning posters or MT5 here
    // would advertise steps the tour never shows.
    const text = TOUR_STEPS.map((s) => `${s.title} ${s.body}`)
      .join(" ")
      .toLowerCase();
    for (const off of ["poster", "mt5", "myfxbook", "portfolio"]) {
      expect(text).not.toContain(off);
    }
  });

  it("stays short enough to read in a tooltip", () => {
    for (const step of TOUR_STEPS) {
      expect(step.body.length).toBeLessThan(220);
    }
  });
});

describe("step shape", () => {
  it("only uses placements the overlay understands", () => {
    const allowed = new Set(["top", "bottom", "left", "right"]);
    for (const s of TOUR_STEPS as readonly TourStep[]) {
      expect(allowed.has(s.placement)).toBe(true);
    }
  });
});
