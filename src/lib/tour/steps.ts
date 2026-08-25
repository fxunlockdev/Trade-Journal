/**
 * First-run tour — what a new trader is shown, and in what order.
 *
 * The tour teaches the CORE LOOP only: pick a journal, set the capital, log a
 * trade, read the result. Everything else (posters, importing, MT5, portfolio)
 * is discoverable from the sidebar once that loop makes sense, and a tour that
 * covers everything teaches nothing.
 *
 * Steps are plain data so the copy and the ordering can be unit-tested without
 * a browser, and so a step whose target isn't on screen can be dropped rather
 * than pointing at nothing.
 */

export type TourPlacement = "bottom" | "right" | "left" | "top";

export interface TourStep {
  readonly id: string;
  /** Matched against `[data-tour="…"]`. */
  readonly target: string;
  readonly title: string;
  readonly body: string;
  /** Preferred side to sit on; the overlay flips it if it won't fit. */
  readonly placement: TourPlacement;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "journal",
    target: "journal-switcher",
    title: "Start with a journal",
    body: "Every trade belongs to a journal — one per account or strategy. Switch between them here, add another, and open Journal settings to set your account capital and risk %.",
    placement: "bottom",
  },
  {
    id: "add-trade",
    // Derived from the href (/journal/new), not the label.
    target: "nav-journal-new",
    title: "Log a trade",
    body: "Enter the pair, your entry and your stop. Once a journal has capital set, the position size is worked out for you — you don't type a quantity.",
    placement: "right",
  },
  {
    id: "journal-list",
    target: "nav-journal",
    title: "Every trade you've logged",
    body: "The full list, filterable by pair, direction and date. Edit a trade here and every number on the dashboard updates with it.",
    placement: "right",
  },
  {
    id: "dashboard",
    target: "nav-dashboard",
    title: "Watch it add up",
    body: "Your balance, win rate, expectancy and equity curve — all computed from the trades you log. Nothing here is typed in by hand.",
    placement: "right",
  },
];

/** localStorage key. Versioned so a reworked tour can run again. */
export const TOUR_SEEN_KEY = "trdr_tour_seen_v1";

/**
 * The steps that can actually be shown right now.
 *
 * A target can legitimately be missing — the sidebar is a drawer on mobile, and
 * nav items are role-gated — so pointing a spotlight at a nonexistent element
 * would leave the user staring at a dimmed screen with a hole in the corner.
 * Anything that isn't on the page is dropped.
 */
export function visibleSteps(
  steps: readonly TourStep[],
  isPresent: (target: string) => boolean,
): readonly TourStep[] {
  return steps.filter((s) => isPresent(s.target));
}

/** Whether the tour has already been seen in this browser. */
export function hasSeenTour(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    // Private browsing can throw on access — treat as "seen" so a broken
    // storage never traps someone in a tour they can't dismiss permanently.
    return true;
  }
}

export function markTourSeen(storage: Pick<Storage, "setItem">): void {
  try {
    storage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // Non-critical: worst case the tour offers itself again next visit.
  }
}

export function clearTourSeen(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(TOUR_SEEN_KEY);
  } catch {
    // Non-critical.
  }
}
