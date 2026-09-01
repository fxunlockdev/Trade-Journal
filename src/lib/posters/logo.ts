import { posterScopeKey } from "@/lib/posters/scope";

/**
 * A brand logo for the poster's "Presented by" slot.
 *
 * The logo replaces the group NAME, not the label, so the three designs keep
 * their exact header rhythm. It never leaves the browser: the file is decoded,
 * downscaled through a canvas, and kept in localStorage as a PNG data URL
 * beside the group name. That is deliberate. Uploading to storage would mean a
 * bucket, RLS policies, a public URL and a CORS-clean fetch during
 * rasterisation, for an asset only one browser ever needs. A data URL is
 * already inline, so `domToBlob` embeds it with no network round-trip.
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
 * Posters print a logo at a few dozen CSS pixels tall (see LOGO_SIZE in
 * templates/types.tsx), so 512 leaves generous headroom even for a 2x export.
 * It exists to bound the localStorage footprint: a 3000px source PNG re-encodes
 * to megabytes of base64 and would blow the ~5 MB per-origin quota that also
 * holds the group name.
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
 * Built from the same scope key as the group name it replaces, so the two are
 * scoped to the same journal combination and appear and disappear together.
 */
export function logoStorageKey(journalIds: readonly string[]): string | null {
  return posterScopeKey("logo", journalIds);
}

/** The only shape a stored logo may have. */
const LOGO_DATA_URL_PREFIX = "data:image/png;base64,";

/**
 * Narrow a value read back from storage to a logo, or null.
 *
 * localStorage is an INPUT, even though this app is the only thing that writes
 * it. The write path only ever stores a canvas-produced PNG data URL, but a
 * value that has been tampered with is still handed to an <img> inside the
 * poster, and `domToBlob` only skips its fetch step for sources beginning
 * "data:". An http(s) URL smuggled into this key would therefore be FETCHED
 * during export, turning a poster download into a callout to someone else's
 * origin. Validating on read costs one comparison and removes that path.
 */
export function parseStoredLogo(raw: string | null): string | null {
  return raw && raw.startsWith(LOGO_DATA_URL_PREFIX) ? raw : null;
}

/**
 * Largest DECODED image accepted, in pixels.
 *
 * `LOGO_MAX_BYTES` bounds the compressed file, which is not the same bound at
 * all: PNG is lossless but heavily compressed, so 25000x25000 of flat colour is
 * a few hundred KB on disk and ~2.5 GB once the decoder expands it to RGBA.
 * That passes the byte cap and the signature check and then hangs or OOMs the
 * tab. 40 megapixels is far above any real logo and well below that cliff.
 */
export const LOGO_MAX_PIXELS = 40_000_000;

export interface ParsedLogo {
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

/**
 * Decode a PNG from bytes we have already vouched for.
 *
 * The Blob's type is PINNED to image/png rather than inherited from
 * `File.type`. `readAsDataURL` builds `data:${file.type};base64,...`, so
 * inheriting would hand the decoder a MIME string taken verbatim from the
 * untrusted file, immediately after this module refused to trust that same
 * attribute for the format check. The bytes decide the type here too.
 */
function decodePng(url: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new LogoError("That PNG could not be decoded. Try re-exporting it."),
      );
    img.src = url;
  });
}

/**
 * The dimensions a PNG DECLARES, read without decoding it.
 *
 * IHDR is mandatory and always the first chunk, so width and height sit at
 * fixed offsets: 8 signature bytes + 4 length + 4 type = 16, then two
 * big-endian uint32s. Reading them here is the whole point — a decompression
 * bomb has to be refused BEFORE the decoder allocates its RGBA buffer, and a
 * check on `naturalWidth` runs after that allocation has already happened.
 *
 * Null unless the chunk is genuinely an IHDR: the right length, the right type
 * tag. Reading the offsets unconditionally would interpret whatever bytes
 * happen to sit there, so a corrupt file whose garbage decodes to a large
 * uint32 would be turned away as "too large" instead of "could not be decoded",
 * pointing the user at the wrong problem. Null hands it to the decoder, which
 * will say what is actually wrong with it.
 */
const IHDR_LENGTH = 13;

/**
 * PNG dimensions from the IHDR header, without decoding the image.
 *
 * Exported because the SERVER needs it too: an upload route has no canvas, so
 * the header is the only thing it can check. Reading the declared size before
 * any decode is also what keeps a decompression bomb from being decoded at all.
 */
export function readDeclaredSize(
  bytes: ArrayBuffer,
): { readonly width: number; readonly height: number } | null {
  if (bytes.byteLength < 24) return null;
  const view = new DataView(bytes);
  if (view.getUint32(8) !== IHDR_LENGTH) return null;
  const tag = new Uint8Array(bytes, 12, 4);
  // "IHDR"
  if (tag[0] !== 0x49 || tag[1] !== 0x48 || tag[2] !== 0x44 || tag[3] !== 0x52) {
    return null;
  }
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Validate, downscale and encode an uploaded logo.
 *
 * Throws `LogoError` with a message written for the user. Every rejection here
 * is one the user can act on: wrong format, too large, undecodable.
 */
export async function readLogoFile(file: File): Promise<ParsedLogo> {
  if (file.size > LOGO_MAX_BYTES) {
    const mb = (LOGO_MAX_BYTES / 1024 / 1024).toFixed(0);
    throw new LogoError(`That file is over ${mb} MB. Export a smaller PNG.`);
  }
  if (file.size === 0) throw new LogoError("That file is empty.");

  // ONE read. Checking the signature on a separate `file.slice()` and then
  // re-reading for the content leaves a window where the file on disk changes
  // between the two, so the bytes that were vetted are not the bytes decoded.
  const bytes = await file.arrayBuffer();
  // Not `new Uint8Array(bytes, 0, 8)`: that constructor throws RangeError when
  // the buffer is shorter than the requested length, and a 1-7 byte file clears
  // both guards above. The RangeError is not a LogoError, so it would surface
  // to the user as a raw engine message. Hand the whole buffer over and let
  // isPngSignature's own length check reject it with real copy.
  if (!isPngSignature(new Uint8Array(bytes))) {
    throw new LogoError(
      "That is not a PNG. Logos must be PNG files with a transparent background.",
    );
  }

  // BEFORE the decode, from the header. A flat-colour 20000x20000 PNG is a few
  // hundred KB on disk, so it clears LOGO_MAX_BYTES, and expands to ~1.6 GB in
  // the decoder. Checking naturalWidth after decodePng would run this guard
  // only once the allocation it exists to prevent had already happened.
  const declared = readDeclaredSize(bytes);
  if (declared && declared.width * declared.height > LOGO_MAX_PIXELS) {
    throw new LogoError(
      "That PNG's dimensions are too large. Export it at 2000px or smaller.",
    );
  }

  // The object URL must outlive every use of the decoded image, not just the
  // decode: WebKit has dropped an image's backing store when its blob URL was
  // revoked before the draw, which would silently bake a blank rectangle into
  // the poster. Revoked in the finally, after the canvas work is done with it.
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  try {
    const img = await decodePng(url);

    // Belt and braces: a header can lie, and the decoder is the authority on
    // what it actually produced.
    if (img.naturalWidth * img.naturalHeight > LOGO_MAX_PIXELS) {
      throw new LogoError(
        "That PNG's dimensions are too large. Export it at 2000px or smaller.",
      );
    }

    const { width, height } = fitWithin(
      img.naturalWidth,
      img.naturalHeight,
      LOGO_MAX_EDGE,
    );
    // A decoder can resolve onload with zero dimensions on malformed input, and
    // fitWithin passes that straight through. Rejected here rather than left to
    // throw inside the canvas work below, where the catch around getImageData
    // would swallow it and report the logo as transparent.
    if (width === 0 || height === 0) {
      throw new LogoError("That PNG has no dimensions. Try re-exporting it.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    // willReadFrequently: the alpha scan below reads the whole surface back, and
    // without the hint Chrome keeps the canvas GPU-side and copies it to do so.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new LogoError("This browser can't process the image.");
    ctx.drawImage(img, 0, 0, width, height);

    // getImageData throws SecurityError on a tainted canvas. A blob URL from
    // our own origin cannot taint one, so this only fires in exotic
    // configurations (a privacy extension blocking canvas reads). There,
    // "can't tell" beats rejecting a valid logo, so it passes with the warning
    // suppressed.
    //
    // Deliberately narrow: a bare catch would also swallow a real decode
    // failure and silently report an opaque logo as transparent, which loses
    // the warning for exactly the file it was written for.
    let transparent = true;
    try {
      transparent = hasTransparency(ctx.getImageData(0, 0, width, height).data);
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "SecurityError")) {
        throw err;
      }
    }

    // Re-encoded as PNG, never JPEG: the whole point is the alpha channel.
    return { dataUrl: canvas.toDataURL("image/png"), width, height, transparent };
  } finally {
    URL.revokeObjectURL(url);
  }
}
