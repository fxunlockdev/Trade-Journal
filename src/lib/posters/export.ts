import { domToBlob } from "modern-screenshot";
import { POSTER_SIZE } from "@/lib/posters/templates/types";

/**
 * Rasterising a poster.
 *
 * The poster is rendered as real DOM and snapshotted, rather than drawn
 * server-side with Satori/`next/og`. Satori supports "only flexbox and a subset
 * of CSS" — no `display: grid`, no `background-clip: text`, no blend modes —
 * and all three supplied designs depend on those, so server rendering would
 * mean redrawing the designs rather than reproducing them.
 */

/**
 * Fonts must be RESOLVED before the snapshot, or the rasteriser captures a
 * fallback face and every poster silently ships in the wrong typeface.
 * `document.fonts.ready` settles once pending faces have loaded; the explicit
 * loads cover the case where nothing on screen has requested that weight yet.
 */
async function waitForPosterFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const families = [
    '700 270px "Space Grotesk"',
    '600 46px "Space Grotesk"',
    '400 19px "Jost"',
    '500 17px "Jost"',
  ];
  try {
    await Promise.all(families.map((f) => document.fonts.load(f)));
  } catch {
    // A failed preload is not fatal — document.fonts.ready still gates on
    // whatever the poster actually references.
  }
  await document.fonts.ready;
}

export interface RenderOptions {
  /** Device pixel scale. 1 gives exactly 1080×1080. */
  readonly scale?: number;
}

/**
 * Snapshot a poster node to a PNG blob at exactly 1080×1080.
 *
 * `backgroundColor` is passed explicitly: without it a theme whose own
 * background sits on a decorative layer can rasterise with transparent
 * corners, which most social platforms then composite onto white.
 */
/**
 * Every image on the poster must be painted before the snapshot.
 *
 * `modern-screenshot` does await media, but it RESOLVES rather than rejects
 * when an image fails to load, decode, or times out. Left alone, a logo that
 * did not paint yields a perfectly valid 1080x1080 PNG with an empty
 * "Presented by" slot, handed to the user under a success toast. A poster is a
 * public claim, so publishing one with the attribution silently missing is
 * worse than failing the export.
 */
async function requirePaintedImages(node: HTMLElement): Promise<void> {
  const images = [...node.querySelectorAll("img")];
  await Promise.all(
    images.map(async (img) => {
      if (img.complete && img.naturalWidth > 0) return;
      try {
        await img.decode();
      } catch {
        throw new Error(
          "Your logo couldn't be rendered. Re-upload it and try again.",
        );
      }
      if (img.naturalWidth === 0) {
        throw new Error(
          "Your logo couldn't be rendered. Re-upload it and try again.",
        );
      }
    }),
  );
}

export async function posterToBlob(
  node: HTMLElement,
  backgroundColor: string,
  { scale = 1 }: RenderOptions = {},
): Promise<Blob> {
  await waitForPosterFonts();
  await requirePaintedImages(node);
  const blob = await domToBlob(node, {
    width: POSTER_SIZE,
    height: POSTER_SIZE,
    scale,
    backgroundColor,
    type: "image/png",
    // The node is rendered inside a CSS-scaled preview wrapper; the snapshot
    // must ignore that transform and capture the poster at its true size.
    style: { transform: "none", transformOrigin: "top left", margin: "0" },
  });
  if (!blob) throw new Error("Poster rendering produced no image");
  return blob;
}

/** Trigger a browser download for a rendered poster. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // setTimeout rather than requestAnimationFrame: rAF does not fire in a
  // backgrounded tab, and switching tabs right after clicking Download is the
  // natural flow — the blob (1–2 MB) would stay pinned until navigation.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Copy a poster to the clipboard.
 *
 * Takes a FACTORY, not a blob. WebKit requires `clipboard.write` to happen
 * inside the user gesture, and rasterising a 1080×1080 poster takes long enough
 * to exhaust that activation — so the ClipboardItem is constructed with the
 * pending promise and the write is issued immediately.
 *
 * Not universally available (Firefox has no image ClipboardItem support), so
 * callers must surface the rejection and leave Download as the way out.
 */
export async function copyPosterToClipboard(
  render: () => Promise<Blob>,
): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Your browser can't copy images. Use Download instead.");
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": render() }),
    ]);
  } catch (err: unknown) {
    // A denied clipboard permission reads as an opaque platform string
    // ("The request is not allowed by the user agent"); point at the way out.
    if (err instanceof Error && err.name === "NotAllowedError") {
      throw new Error("Clipboard access was blocked. Use Download instead.");
    }
    throw err;
  }
}

/** e.g. "ttc-gold-yohan-daily-2026-08-25.png" */
export function posterFilename(group: string, kind: string, date: Date): string {
  const slug =
    group
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "poster";
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${slug}-${kind.toLowerCase()}-${stamp}.png`;
}
