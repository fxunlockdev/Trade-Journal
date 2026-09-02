import { POSTER_SIZE } from "@/lib/posters/templates/types";

/**
 * Is this a poster worth publishing?
 *
 * Separated from the renderer so the rules are testable without a browser. A
 * guard on an unattended, outward-facing path has to be verified in both
 * directions: it must reject a broken poster, and it must NEVER reject a good
 * one. The second is the dangerous half. A guard that is too strict does not
 * degrade the feature, it stops it completely, and it does so silently at 06:00
 * on a morning nobody is watching.
 *
 * Every threshold is therefore a floor for "this is a real poster", not a tuned
 * number: far below what a correct render produces, far above what a broken one
 * does.
 */

/** A blank 1080x1080 PNG compresses to a couple of kilobytes. A drawn poster
 *  runs to hundreds, so this rejects only the genuinely empty. */
export const MIN_POSTER_BYTES = 10_000;

/** Every template prints a headline figure, counts, a date and a disclaimer,
 *  which together run to hundreds of characters. */
export const MIN_POSTER_TEXT = 20;

/**
 * Values that must never reach a partner.
 *
 * Worse than a missing poster: they look authoritative, and they get forwarded.
 */
export const BROKEN_VALUES = [
  "NaN",
  "undefined",
  "Infinity",
  "[object Object]",
] as const;

export interface DrawnPoster {
  /** Visible text on the canvas, from the DOM rather than a decoded image. */
  readonly text: string;
  readonly width: number;
  readonly height: number;
  /** Byte length of the PNG. Omitted when checking before the screenshot. */
  readonly bytes?: number;
}

/**
 * The reason this poster must not be published, or null if it is fine.
 *
 * Returns a message rather than throwing so the caller decides severity, and so
 * a test can assert on the reason instead of a stack.
 */
export function posterProblem(
  drawn: DrawnPoster,
  style: string,
): string | null {
  if (drawn.width < POSTER_SIZE || drawn.height < POSTER_SIZE) {
    return `Poster laid out at ${Math.round(drawn.width)}x${Math.round(
      drawn.height,
    )}, expected ${POSTER_SIZE}x${POSTER_SIZE} (${style}).`;
  }

  // Whitespace stripped: an "empty" frame often still contains newlines and
  // indentation, which would otherwise pass a naive length check.
  if (drawn.text.replace(/\s+/g, "").length < MIN_POSTER_TEXT) {
    return `Poster drew almost no text for ${style}; it would publish blank.`;
  }

  const broken = BROKEN_VALUES.find((v) => drawn.text.includes(v));
  if (broken) {
    return `Poster shows "${broken}" for ${style}.`;
  }

  if (drawn.bytes !== undefined && drawn.bytes < MIN_POSTER_BYTES) {
    return `Poster for ${style} is ${drawn.bytes} bytes, too small to be a drawn image.`;
  }

  return null;
}
