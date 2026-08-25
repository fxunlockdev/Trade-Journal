/**
 * A brand logo for the poster's "Presented by" slot.
 *
 * The logo replaces the group NAME, not the label, so the three designs keep
 * their exact header rhythm. It never leaves the browser: the file is read to a
 * data URL, downscaled, and kept in localStorage beside the group name. That is
 * deliberate. Uploading to storage would mean a bucket, RLS policies, a public
 * URL and a CORS-clean fetch during rasterisation, for an asset only one browser
 * ever needs. A data URL is already inline, so `domToBlob` embeds it with no
 * network round-trip and no chance of tainting the canvas.
 *
 * The requirement is a PNG with a transparent background. Both halves are
 * checked, but not with the same force:
 *
 *   FORMAT is verifiable and absolute. A JPEG cannot carry transparency at all,
 *   so it is rejected on its signature bytes, never on `file.type` or the
 *   extension, both of which are attacker- and Finder-controlled.
 *
 *   BACKGROUND is a heuristic. "No background" means an alpha channel that is
 *   actually used, and a fully opaque PNG will print as a visible rectangle on
 *   the poster. That is worth saying loudly, but not worth blocking on: the
 *   check reads pixels, and a caller who genuinely wants an opaque mark should
 *   not be argued out of it by a sampler.
 */

/** Largest file accepted, before downscaling. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Longest edge kept after downscaling.
 *
 * The logo prints at 44 CSS px tall on Design A, so 512 is already ~6x the
 * pixels a 2x export can use. It exists to bound the localStorage footprint:
 * a 3000px source PNG re-encodes to megabytes of base64 and would blow the
 * ~5 MB per-origin quota that also holds the group name.
 */
export const LOGO_MAX_EDGE = 512;

/** PNG signature: the 8 bytes every PNG begins with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Does this byte stream begin with the PNG signature?
 *
 * Read from the bytes rather than `file.type`, which is inferred from the
 * extension by most browsers and is empty on some platforms. Renaming
 * `photo.jpg` to `logo.png` gets the MIME type past a naive check and then
 * prints an opaque photograph on the poster.
 */
export function isPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Does any pixel have partial or full transparency?
 *
 * Samples on a stride rather than reading every pixel: a 512x512 logo is 262144
 * pixels, and the answer is almost always decided by the first corner. The
 * stride is in PIXELS and multiplied up to an RGBA offset, so it can never
 * land mid-pixel and read a colour channel as alpha.
 */
export function hasTransparency(
  rgba: Uint8ClampedArray,
  strideInPixels = 7,
): boolean {
  const stride = Math.max(1, Math.floor(strideInPixels)) * 4;
  for (let i = 3; i < rgba.length; i += stride) {
    if (rgba[i] < 255) return true;
  }
  return false;
}

/**
 * Fit natural dimensions into a box, preserving aspect ratio and never
 * enlarging. Returns whole pixels, because a fractional canvas size rounds
 * inconsistently across browsers.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { readonly width: number; readonly height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Where a logo is remembered.
 *
 * Mirrors `groupStorageKey` exactly, including the sorted join, so a logo and
 * the group name it replaces are scoped to the same journal combination and
 * appear and disappear together.
 */
export function logoStorageKey(journalIds: readonly string[]): string | null {
  if (journalIds.length === 0) return null;
  return `trdr_poster_logo:${[...journalIds].sort().join("+")}`;
}

export interface PosterLogo {
  /** PNG data URL, downscaled and re-encoded. */
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  /**
   * False when every sampled pixel was fully opaque, i.e. the PNG has a
   * background and will print as a rectangle. Advisory, not a rejection.
   */
  readonly transparent: boolean;
}

/** A rejection carries the reason the caller should show verbatim. */
export class LogoError extends Error {}

/** Read a File's first bytes without pulling the whole thing into memory. */
async function readSignature(file: File): Promise<Uint8Array> {
  const head = file.slice(0, PNG_SIGNATURE.length);
  return new Uint8Array(await head.arrayBuffer());
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new LogoError("That PNG could not be decoded. Try re-exporting it."));
    img.src = dataUrl;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new LogoError("That file could not be read."));
    reader.readAsDataURL(file);
  });
}

/**
 * Validate, downscale and encode an uploaded logo.
 *
 * Throws `LogoError` with a message written for the user. Every rejection here
 * is one the user can act on: wrong format, too large, undecodable.
 */
export async function readLogoFile(file: File): Promise<PosterLogo> {
  if (file.size > LOGO_MAX_BYTES) {
    const mb = (LOGO_MAX_BYTES / 1024 / 1024).toFixed(0);
    throw new LogoError(`That file is over ${mb} MB. Export a smaller PNG.`);
  }
  if (file.size === 0) throw new LogoError("That file is empty.");

  if (!isPngSignature(await readSignature(file))) {
    throw new LogoError(
      "That is not a PNG. Logos must be PNG files with a transparent background.",
    );
  }

  const img = await loadImage(await fileToDataUrl(file));
  const { width, height } = fitWithin(
    img.naturalWidth,
    img.naturalHeight,
    LOGO_MAX_EDGE,
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // willReadFrequently: the alpha scan below reads the whole surface back, and
  // without the hint Chrome keeps the canvas GPU-side and copies it to do so.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new LogoError("This browser can't process the image.");
  ctx.drawImage(img, 0, 0, width, height);

  // getImageData throws on a tainted canvas. A data URL cannot taint one, so
  // this only fires in exotic browser configurations; treat it as "can't tell"
  // and let the upload through rather than rejecting a valid logo.
  let transparent = true;
  try {
    transparent = hasTransparency(ctx.getImageData(0, 0, width, height).data);
  } catch {
    transparent = true;
  }

  // Re-encoded as PNG, never JPEG: the whole point is the alpha channel.
  return { dataUrl: canvas.toDataURL("image/png"), width, height, transparent };
}
