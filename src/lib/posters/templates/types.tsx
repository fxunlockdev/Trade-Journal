import type { PosterStats } from "@/lib/posters/poster-data";
import type { PosterTheme } from "@/lib/posters/theme";

/**
 * Everything a poster template can print.
 *
 * Statistics arrive pre-computed in `stats` — a template formats, it never
 * derives. That keeps the three designs incapable of disagreeing with each
 * other about the same period.
 */
export interface PosterProps {
  readonly stats: PosterStats;
  readonly theme: PosterTheme;
  /** Journal name, or the user's override. The one editable string. */
  readonly group: string;
  /** "DAILY" | "WEEKLY" | "MONTHLY". */
  readonly periodKind: string;
  /** e.g. "25 Aug 2026" or "August 2026". */
  readonly dateLabel: string;
  readonly disclaimer: string;
}

/** Every poster rasterises at exactly this size. */
export const POSTER_SIZE = 1080;

/**
 * Fractal-noise grain, inlined as an SVG data URI so the rasteriser never has
 * to fetch it. Purely decorative — it sits under `mix-blend-mode: soft-light`
 * and degrades to a faint flat overlay if blending is unsupported.
 */
export const NOISE_SVG =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27180%27%20height%3D%27180%27%3E%3Cfilter%20id%3D%27n%27%3E%3CfeTurbulence%20type%3D%27fractalNoise%27%20baseFrequency%3D%270.8%27%20numOctaves%3D%272%27%20stitchTiles%3D%27stitch%27%2F%3E%3CfeColorMatrix%20type%3D%27saturate%27%20values%3D%270%27%2F%3E%3C%2Ffilter%3E%3Crect%20width%3D%27100%25%27%20height%3D%27100%25%27%20filter%3D%27url(%23n)%27%2F%3E%3C%2Fsvg%3E";

/** The grain overlay every design shares. */
export const noiseLayerStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0.1,
  mixBlendMode: "soft-light",
  backgroundImage: `url("${NOISE_SVG}")`,
  backgroundSize: "180px 180px",
  pointerEvents: "none",
};

/**
 * Props for a gradient-filled numeral.
 *
 * `background-clip: text` needs `color: transparent` to reveal the gradient, so
 * a renderer that doesn't support the clip would show NOTHING where the
 * headline number belongs — the worst failure this feature has. The
 * `.poster-gradient-text` utility (globals.css) gates transparency behind a CSS
 * `@supports` rule and falls back to the solid accent otherwise.
 *
 * The gate is CSS, not a `CSS.supports()` branch in JS, because a runtime
 * branch renders one way on the server and another in the browser and trips
 * React's hydration check.
 */
/**
 * Shrink an oversized headline so it can't breach the canvas.
 *
 * Pip counts are not small for every instrument: XAUUSD has a 0.1 pip size, so
 * an active month of gold clears five figures easily. At the design's fixed
 * 270px with `white-space: nowrap`, "+12345" already overruns the decorative
 * frame and "+123456" runs past the 1080px edge, where the root's
 * `overflow: hidden` shears the last digit off — publishing a number that is
 * simply wrong. Stepping the size down keeps long values inside the frame.
 */
export function fitHeadline(text: string, baseSize: number): number {
  const digits = text.replace(/[^0-9]/g, "").length;
  if (digits <= 4) return baseSize;
  if (digits === 5) return Math.round(baseSize * 0.74);
  if (digits === 6) return Math.round(baseSize * 0.6);
  return Math.round(baseSize * 0.5);
}

export function GradientNumber({
  gradient,
  fallbackColor,
  style,
  children,
}: {
  readonly gradient: string;
  readonly fallbackColor: string;
  readonly style?: React.CSSProperties;
  readonly children: React.ReactNode;
}) {
  return (
    <span
      className="poster-gradient-text"
      style={
        {
          display: "block",
          // MUST be the longhand. The `background` shorthand resets every
          // background-* longhand, including the `background-clip: text` set by
          // the class — and because inline styles outrank the class, the
          // gradient would then paint the whole box while the text stayed
          // transparent, i.e. a solid rectangle where the number should be.
          backgroundImage: gradient,
          // Consumed by the utility's `color` declaration.
          "--poster-num-fallback": fallbackColor,
          ...style,
        } as React.CSSProperties
      }
    >
      {children}
    </span>
  );
}
