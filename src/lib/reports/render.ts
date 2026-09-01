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

    const shot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: POSTER_SIZE, height: POSTER_SIZE },
    });
    return Buffer.from(shot);
  } finally {
    await page.close();
  }
}
