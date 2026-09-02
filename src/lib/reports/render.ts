import "server-only";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";
import { createRenderToken } from "@/lib/reports/render-token";
import { POSTER_SIZE } from "@/lib/posters/templates/types";

/**
 * Drawing a poster with no browser present.
 *
 * The designs use CSS that lightweight server renderers cannot draw — grid,
 * background-clip: text, blend modes, an SVG turbulence filter — which is why
 * `lib/posters/export.ts` rasterises in the user's own browser today. A
 * scheduled report has no such browser, so one is started here.
 *
 * Screenshotting real DOM is MORE faithful than the client's `domToBlob`, not
 * less: there is no serialisation step to lose anything in.
 */

/**
 * Floors for "this is a real poster", not tuned thresholds.
 *
 * Each is set well below anything a correct render produces and well above what
 * a broken one does, so they catch disasters without ever failing a good image.
 * A blank 1080x1080 PNG compresses to a couple of kilobytes; a drawn poster
 * runs to hundreds.
 */
const MIN_POSTER_BYTES = 10_000;
const MIN_POSTER_TEXT = 20;

/** Values that must never reach a partner. They read as authoritative and get
 *  forwarded, which makes them worse than a missing poster. */
const BROKEN_VALUES = ["NaN", "undefined", "Infinity", "[object Object]"];

/** Chromium is heavy to start, so one browser serves every style in a report. */
let cached: Browser | null = null;

async function launch(): Promise<Browser> {
  if (cached?.connected) return cached;

  // Locally there is no @sparticuz binary for the host architecture, so use the
  // developer's own Chrome. In production the bundled one is the only option.
  const local = process.env.CHROME_EXECUTABLE_PATH;
  cached = await puppeteer.launch(
    local
      ? { executablePath: local, args: ["--no-sandbox"], headless: true }
      : {
          args: chromium.args,
          executablePath: await chromium.executablePath(),
          headless: true,
        },
  );
  return cached;
}

/** Release the browser between invocations so a warm lambda does not leak one. */
export async function closeRenderer(): Promise<void> {
  if (cached?.connected) await cached.close();
  cached = null;
}

export interface RenderRequest {
  readonly snapshotId: string;
  readonly style: string;
  /** Absolute origin of this deployment, e.g. https://www.fx-apps.com */
  readonly appUrl: string;
}

/**
 * Screenshot one poster, at exactly 1080x1080.
 *
 * The page is authorised by a freshly minted token rather than a session,
 * because this browser carries no cookies. The token is minted HERE, from the
 * server's own secret, so nothing outside this process ever needs to hold it.
 */
export async function renderPoster(req: RenderRequest): Promise<Buffer> {
  const token = createRenderToken(req.snapshotId, req.style);
  if (!token) {
    throw new Error(
      "CRON_SECRET is not configured, so a render URL cannot be signed.",
    );
  }

  const browser = await launch();
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: POSTER_SIZE,
      height: POSTER_SIZE,
      deviceScaleFactor: 1,
    });

    const url = `${req.appUrl.replace(/\/$/, "")}/render/poster/${token}`;
    const response = await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });

    // A 404 here is the token or the snapshot, and it renders as Next's own
    // not-found page — which would screenshot perfectly happily as a poster
    // nobody could tell was wrong. Caught explicitly.
    const status = response?.status() ?? 0;
    if (status !== 200) {
      throw new Error(`Render page returned ${status} for ${req.style}.`);
    }

    // Fonts must be RESOLVED before the shot, or the poster ships in a fallback
    // face. `networkidle0` does not cover webfont decoding.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    // And the canvas must actually exist. Without this a layout failure would
    // produce a blank 1080x1080 image rather than an error.
    await page.waitForSelector('[data-testid="render-canvas"]', {
      timeout: 10_000,
    });

    // WHAT THE POSTER ACTUALLY SAYS.
    //
    // Everything above proves the page loaded, not that it drew anything worth
    // publishing. A template rendering `NaN`, or laid out off-canvas, satisfies
    // all of it and screenshots perfectly happily. These images go to business
    // partners with no human in the loop, so the text is read back before the
    // shot is taken.
    //
    // Done in the page rather than by decoding the PNG: the DOM already knows
    // what it rendered, and no image library is needed to ask it.
    const drawn = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="render-canvas"]');
      const box = canvas?.getBoundingClientRect();
      return {
        text: (canvas as HTMLElement | null)?.innerText ?? "",
        width: box?.width ?? 0,
        height: box?.height ?? 0,
      };
    });

    if (drawn.width < POSTER_SIZE || drawn.height < POSTER_SIZE) {
      throw new Error(
        `Poster laid out at ${Math.round(drawn.width)}x${Math.round(drawn.height)}, expected ${POSTER_SIZE}x${POSTER_SIZE} (${req.style}).`,
      );
    }

    // A poster with almost no text has not rendered its figures. Every template
    // prints at least a headline number, a trade count and a date.
    if (drawn.text.replace(/\s+/g, "").length < MIN_POSTER_TEXT) {
      throw new Error(
        `Poster drew almost no text for ${req.style}; it would publish blank.`,
      );
    }

    // The specific way a broken number reaches an audience. `NaN pips` is worse
    // than no poster, because it looks authoritative and gets forwarded.
    const broken = BROKEN_VALUES.find((v) => drawn.text.includes(v));
    if (broken) {
      throw new Error(`Poster shows "${broken}" for ${req.style}.`);
    }

    const shot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: POSTER_SIZE, height: POSTER_SIZE },
    });

    // Last check, on the bytes themselves. A 1080x1080 poster is hundreds of
    // kilobytes; a flat or near-empty one compresses to a few. This catches a
    // failure the DOM cannot see, such as an image that never painted.
    if (shot.length < MIN_POSTER_BYTES) {
      throw new Error(
        `Poster for ${req.style} is ${shot.length} bytes, too small to be a drawn image.`,
      );
    }

    return Buffer.from(shot);
  } finally {
    await page.close();
  }
}
