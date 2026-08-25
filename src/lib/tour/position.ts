import type { TourPlacement } from "@/lib/tour/steps";

/**
 * Tooltip placement maths, kept out of the component so the awkward cases
 * (target near an edge, target taller than the viewport) can be unit-tested
 * without a DOM.
 */

export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface TooltipSize {
  readonly width: number;
  readonly height: number;
}

export interface Placed {
  readonly top: number;
  readonly left: number;
  readonly placement: TourPlacement;
}

/** Gap between the spotlight and the tooltip. */
const GAP = 14;
/** Minimum breathing room from the viewport edge. */
const MARGIN = 12;

function clamp(value: number, min: number, max: number): number {
  // A viewport narrower than the tooltip makes max < min; pin to min rather
  // than returning a NaN-ish inverted range.
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function fits(placement: TourPlacement, target: Rect, tip: TooltipSize, vp: Viewport): boolean {
  switch (placement) {
    case "bottom":
      return target.top + target.height + GAP + tip.height + MARGIN <= vp.height;
    case "top":
      return target.top - GAP - tip.height - MARGIN >= 0;
    case "right":
      return target.left + target.width + GAP + tip.width + MARGIN <= vp.width;
    case "left":
      return target.left - GAP - tip.width - MARGIN >= 0;
  }
}

/**
 * Where to put the tooltip for a given target.
 *
 * Tries the step's preferred side, then the opposite, then the remaining two.
 * If nothing fits — a small viewport, or a target filling the screen — it
 * falls back to centring, which is always readable even if it loses the visual
 * link to the spotlight.
 */
export function placeTooltip(
  preferred: TourPlacement,
  target: Rect,
  tip: TooltipSize,
  vp: Viewport,
): Placed {
  const opposite: Record<TourPlacement, TourPlacement> = {
    bottom: "top",
    top: "bottom",
    right: "left",
    left: "right",
  };
  const order: TourPlacement[] = [
    preferred,
    opposite[preferred],
    ...(["bottom", "top", "right", "left"] as TourPlacement[]),
  ];

  const chosen = order.find((p) => fits(p, target, tip, vp));

  if (!chosen) {
    return {
      top: clamp(
        (vp.height - tip.height) / 2,
        MARGIN,
        Math.max(MARGIN, vp.height - tip.height - MARGIN),
      ),
      left: clamp(
        (vp.width - tip.width) / 2,
        MARGIN,
        Math.max(MARGIN, vp.width - tip.width - MARGIN),
      ),
      placement: preferred,
    };
  }

  const maxLeft = Math.max(MARGIN, vp.width - tip.width - MARGIN);
  const maxTop = Math.max(MARGIN, vp.height - tip.height - MARGIN);

  switch (chosen) {
    case "bottom":
    case "top": {
      // Centred on the target horizontally, then pulled inside the viewport.
      const left = clamp(
        target.left + target.width / 2 - tip.width / 2,
        MARGIN,
        maxLeft,
      );
      const top =
        chosen === "bottom"
          ? target.top + target.height + GAP
          : target.top - GAP - tip.height;
      return { top: clamp(top, MARGIN, maxTop), left, placement: chosen };
    }
    case "right":
    case "left": {
      const top = clamp(
        target.top + target.height / 2 - tip.height / 2,
        MARGIN,
        maxTop,
      );
      const left =
        chosen === "right"
          ? target.left + target.width + GAP
          : target.left - GAP - tip.width;
      return { top, left: clamp(left, MARGIN, maxLeft), placement: chosen };
    }
  }
}
