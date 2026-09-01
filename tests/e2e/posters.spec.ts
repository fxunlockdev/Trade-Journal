import { expect, test, type Page } from "@playwright/test";

/**
 * Poster E2E.
 *
 * The arithmetic behind a poster is covered hermetically by
 * `tests/unit/poster-data.test.ts` — that's the right layer for it. What only a
 * real browser can prove is the part that silently degrades:
 *
 *  - the 1080×1080 PNG actually rasterises, at the right size;
 *  - it isn't a BLANK square, which is what you get when a web font fails to
 *    embed or `background-clip: text` isn't honoured (the headline numeral is
 *    transparent by design, so a broken clip makes it vanish);
 *  - the numbers a user sees on screen are the ones the data layer computed.
 *
 * `/poster-harness` is a development-only route rendering the same client
 * component against fixed trades, so these assertions need no session and no
 * live data. The real `/posters` page is auth-gated, and that gate is asserted
 * separately below.
 */

const HARNESS = "/poster-harness";

/** Seeded harness trades: 3 wins / 1 loss, +130 net pips, 1 with no close time. */
const EXPECTED = {
  pips: "+130",
  trades: 4,
  wins: 3,
  losses: 1,
  winRate: "75%",
  avgR: "1.1R",
} as const;

async function gotoHarness(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await expect(page.getByTestId("poster-canvas")).toBeVisible();
  // Web fonts must settle before anything is measured or rasterised.
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Renders the poster through the real Download path and decodes the PNG in the
 * page, so the assertions describe the actual downloaded bytes.
 */
async function analysePoster(page: Page) {
  return page.evaluate(async () => {
    // Where the headline numeral actually sits, in poster coordinates. The
    // whole-canvas colour count cannot detect a missing numeral: all three
    // designs paint stacked gradients plus a noise texture, which alone yields
    // hundreds of distinct colours with zero glyphs drawn.
    const canvasEl = document.querySelector<HTMLElement>(
      '[data-testid="poster-canvas"]',
    );
    const heroEl = canvasEl?.querySelector<HTMLElement>(".poster-gradient-text");
    let heroBox: { x: number; y: number; w: number; h: number } | null = null;
    if (canvasEl && heroEl) {
      const root = canvasEl.getBoundingClientRect();
      const hero = heroEl.getBoundingClientRect();
      // The preview is CSS-scaled; normalise back to the 1080 poster space.
      const scale = root.width / 1080;
      heroBox = {
        x: Math.max(0, Math.round((hero.left - root.left) / scale)),
        y: Math.max(0, Math.round((hero.top - root.top) / scale)),
        w: Math.round(hero.width / scale),
        h: Math.round(hero.height / scale),
      };
    }

    let captured: Blob | null = null;
    const realCreate = URL.createObjectURL.bind(URL);
    // Intercept rather than accept a download, so the test never writes a file.
    URL.createObjectURL = (b: Blob) => {
      captured = b;
      return realCreate(b);
    };
    try {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="poster-download"]',
      );
      btn?.click();
      const started = Date.now();
      while (!captured && Date.now() - started < 20_000) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      URL.createObjectURL = realCreate;
    }
    if (!captured) return null;

    const blob = captured as Blob;
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);

    // Sample sparsely with a prime stride so the sample can't align to the
    // background grid and under-report the colour variety.
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4 * 997) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }

    // Two independent signals inside the headline's own box, because the
    // numeral has TWO distinct ways to fail and each hides the other:
    //
    //   blank      — font missing: the box is flat background, no ink.
    //   solid slab — background-clip lost (e.g. someone reintroduces the
    //                `background` shorthand): the gradient paints the whole box
    //                and the transparent glyphs vanish INTO it. Plenty of
    //                colour, so an ink-only check sails straight past it.
    //
    // Real glyphs show both: ink for the strokes AND poster background visible
    // in the counters and between digits.
    let heroBgShare: number | null = null;
    if (heroBox && heroBox.w > 0 && heroBox.h > 0) {
      // The poster's own backdrop, sampled from a corner the layout never uses.
      const corner = ctx.getImageData(4, bmp.height - 6, 1, 1).data;
      const hero = ctx.getImageData(heroBox.x, heroBox.y, heroBox.w, heroBox.h);
      let near = 0;
      for (let i = 0; i < hero.data.length; i += 4) {
        const [r, g, b] = [hero.data[i], hero.data[i + 1], hero.data[i + 2]];
        if (
          Math.abs(r - corner[0]) < 26 &&
          Math.abs(g - corner[1]) < 26 &&
          Math.abs(b - corner[2]) < 26
        ) {
          near++;
        }
      }
      const total = hero.data.length / 4;
      heroBgShare = near / total;
    }

    return {
      type: blob.type,
      bytes: blob.size,
      width: bmp.width,
      height: bmp.height,
      distinctColors: seen.size,
      heroBgShare,
    };
  });
}

test.describe("combining journals", () => {
  // The harness seeds two journals: YOHAN (4 trades, +130 pips, incl. one
  // XAUUSD at +80) and CHRIS (2 XAUUSD trades, +30 and -10 => +20).
  test("defaults to the active journal alone", async ({ page }) => {
    await gotoHarness(page);
    await expect(page.getByTestId("poster-canvas")).toContainText("+130");
    // The labelled row, not a bare "4" — that also matches "4 / 2" and "4 of 4".
    await expect(
      page.getByTestId("poster-receipt").getByText("Closed trades in range"),
    ).toBeVisible();
    await expect(page.getByTestId("poster-canvas")).toContainText("4");
    // A single journal makes no combining claim.
    await expect(page.getByTestId("poster-combine-caution")).toHaveCount(0);
    await expect(page.getByTestId("poster-canvas")).not.toContainText(
      /Combined results across/i,
    );
  });

  test("ticking a second journal sums both", async ({ page }) => {
    await gotoHarness(page);
    await page.getByTestId("poster-journal-journal-b").click();
    // 130 + 20.
    await expect(page.getByTestId("poster-canvas")).toContainText("+150");
  });

  test("the receipt breaks the total down per journal", async ({ page }) => {
    await gotoHarness(page);
    await page.getByTestId("poster-journal-journal-b").click();
    const receipt = page.getByTestId("poster-receipt");
    await expect(receipt).toContainText("YOHAN");
    await expect(receipt).toContainText("CHRIS");
    // 4 + 2 = 6, and the canvas is the unambiguous place to read the total.
    await expect(page.getByTestId("poster-canvas")).toContainText("6");
  });

  test("a combined poster says so on the artefact, not just on screen", async ({
    page,
  }) => {
    await gotoHarness(page);
    await page.getByTestId("poster-journal-journal-b").click();
    // Must be IN the poster — the on-screen receipt is not published.
    await expect(page.getByTestId("poster-canvas")).toContainText(
      /Combined results across 2 journals/i,
    );
    await expect(page.getByTestId("poster-combine-caution")).toBeVisible();
  });

  test("names the combination without anyone typing", async ({ page }) => {
    await gotoHarness(page);
    await page.getByTestId("poster-journal-journal-b").click();
    await expect(page.getByTestId("poster-canvas")).toContainText(
      "YOHAN + CHRIS",
    );
  });

  test("Yohan + Chris on Gold — the case this was built for", async ({
    page,
  }) => {
    await gotoHarness(page);
    await page.getByTestId("poster-journal-journal-b").click();
    await page.getByTestId("poster-asset-XAUUSD").click();

    const canvas = page.getByTestId("poster-canvas");
    // Yohan's one gold trade (+80) plus Chris's two (+30, -10).
    await expect(canvas).toContainText("+100");
    // A single instrument names itself rather than saying ALL PAIRS.
    await expect(canvas).toContainText("XAUUSD");
    await expect(page.getByTestId("poster-receipt")).toContainText("3");
  });

  test("the asset list only offers what the chosen journals traded", async ({
    page,
  }) => {
    await gotoHarness(page);

    // Both journals: every pair either of them traded is offered.
    await page.getByTestId("poster-journal-journal-b").click();
    await expect(page.getByTestId("poster-asset-EURUSD")).toBeVisible();
    await expect(page.getByTestId("poster-asset-XAUUSD")).toBeVisible();

    // Chris alone traded only gold, so EURUSD is no longer offered — selecting
    // it would return an empty poster. The row itself stays, because "All" has
    // to remain reachable no matter how the scope narrows.
    await page.getByTestId("poster-journal-journal-a").click();
    await expect(page.getByTestId("poster-asset-EURUSD")).toHaveCount(0);
    await expect(page.getByTestId("poster-asset-XAUUSD")).toBeVisible();
    await expect(page.getByTestId("poster-asset-all")).toBeVisible();
  });

  test("changing journals clears an asset filter the new scope can't satisfy", async ({
    page,
  }) => {
    await gotoHarness(page);
    // Yohan traded EURUSD; Chris traded only XAUUSD.
    await page.getByTestId("poster-journal-journal-b").click();
    await page.getByTestId("poster-asset-EURUSD").click();
    await expect(page.getByTestId("poster-canvas")).toContainText("+100");

    // Switch to Chris alone. EURUSD is meaningless there — if the selection
    // survived, the poster would report "no closed trades" with no visible
    // filter to blame, and the row (with its "All" chip) can unmount entirely.
    await page.getByTestId("poster-journal-journal-a").click();
    await expect(page.getByTestId("poster-canvas")).toContainText("+20");
    await expect(
      page.getByText(/no closed trades in this period/i),
    ).toHaveCount(0);
  });

  test("a poster naming two journals says so even if only one traded", async ({
    page,
  }) => {
    await gotoHarness(page);
    await page.getByTestId("poster-journal-journal-b").click();
    // Narrow to a pair only Yohan traded: the headline still claims both, so
    // the artefact must still carry the combined note rather than passing one
    // trader's numbers off as the pair's.
    await page.getByTestId("poster-asset-EURUSD").click();
    const canvas = page.getByTestId("poster-canvas");
    await expect(canvas).toContainText("YOHAN + CHRIS");
    await expect(canvas).toContainText(/Combined results across 2 journals/i);
    await expect(page.getByTestId("poster-combine-caution")).toContainText(
      /only 1 of which traded in this period/i,
    );
  });

  test("combining still produces a real 1080x1080 PNG", async ({ page }) => {
    test.slow();
    await gotoHarness(page);
    await page.getByTestId("poster-journal-journal-b").click();
    await expect(page.getByTestId("poster-canvas")).toContainText("+150");

    const result = await analysePoster(page);
    expect(result, "download produced no image").not.toBeNull();
    expect(result!.width).toBe(1080);
    expect(result!.height).toBe(1080);
    expect(result!.heroBgShare).toBeGreaterThan(0.15);
    expect(result!.heroBgShare).toBeLessThan(0.95);
  });
});

test.describe("poster rendering", () => {
  test("the auth-gated page does not render posters to anonymous visitors", async ({
    page,
  }) => {
    await page.goto("/posters");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("poster-canvas")).toHaveCount(0);
  });

  test("shows the computed stats on screen", async ({ page }) => {
    await gotoHarness(page);

    const receipt = page.getByTestId("poster-receipt");
    await expect(receipt).toContainText(String(EXPECTED.trades));
    await expect(receipt).toContainText(
      `${EXPECTED.wins} / ${EXPECTED.losses}`,
    );

    // The headline number must match the receipt's trade set.
    await expect(page.getByTestId("poster-canvas")).toContainText(EXPECTED.pips);
  });

  test("discloses trades that had no recorded close time", async ({ page }) => {
    await gotoHarness(page);
    // One seeded trade deliberately has exit_time = null.
    await expect(page.getByTestId("poster-receipt").locator("..")).toContainText(
      /no recorded close time/i,
    );
  });

  for (const [id, label] of [
    ["design-a", "Headline"],
    ["design-b", "Scorecard"],
    ["design-c", "Trade Log"],
  ] as const) {
    test(`${label} renders a real 1080x1080 PNG`, async ({ page }) => {
      // Rasterising 1080x1080 is CPU-heavy, and Playwright's default local
      // parallelism points several workers at one dev server. Without the
      // extra headroom these time out locally while passing in CI (workers: 1).
      test.slow();
      await gotoHarness(page);
      await page.getByTestId(`poster-template-${id}`).click();
      await expect(page.getByTestId("poster-canvas")).toContainText(
        EXPECTED.pips,
      );

      const result = await analysePoster(page);
      expect(result, "download produced no image").not.toBeNull();
      expect(result!.type).toBe("image/png");
      expect(result!.width).toBe(1080);
      expect(result!.height).toBe(1080);

      // How much of the headline's box is still poster backdrop. Measured on
      // the real rasterised PNG, this one number separates all three states
      // cleanly (verified by deliberately breaking each):
      //
      //   ~0.65  glyphs drawn, backdrop showing through the counters — correct
      //   0      solid gradient slab: background-clip: text was lost, so the
      //          gradient painted the whole box and ate the transparent glyphs
      //   1.0    nothing drawn at all: the web font never embedded
      //
      // A pixel-count or file-size floor cannot tell these apart — the stacked
      // gradients and noise texture keep every variant looking "busy".
      expect(
        result!.heroBgShare,
        "headline is a solid gradient slab — background-clip: text was lost",
      ).toBeGreaterThan(0.15);
      expect(
        result!.heroBgShare,
        "headline numeral did not render — the web font probably failed to embed",
      ).toBeLessThan(0.95);
      expect(result!.bytes).toBeGreaterThan(20_000);
    });
  }

  test("templates B and C show win rate and average R", async ({ page }) => {
    test.slow();
    await gotoHarness(page);
    for (const id of ["design-b", "design-c"] as const) {
      await page.getByTestId(`poster-template-${id}`).click();
      const canvas = page.getByTestId("poster-canvas");
      await expect(canvas).toContainText(EXPECTED.winRate);
      await expect(canvas).toContainText(EXPECTED.avgR);
    }
  });

  test("the trade log lists a row per trade", async ({ page }) => {
    await gotoHarness(page);
    await page.getByTestId("poster-template-design-c").click();
    const canvas = page.getByTestId("poster-canvas");
    await expect(canvas).toContainText("EURUSD");
    await expect(canvas).toContainText("GBPUSD");
    await expect(canvas).toContainText("XAUUSD");
    await expect(canvas).toContainText("WIN");
    await expect(canvas).toContainText("LOSS");
  });

  test("changing the period changes the numbers", async ({ page }) => {
    await gotoHarness(page);
    await expect(page.getByTestId("poster-canvas")).toContainText(EXPECTED.pips);

    // The seeded trades are all within the last few hours, so yesterday is
    // empty — and an empty period must say so rather than print a stale total.
    await page.getByTestId("poster-period-yesterday").click();
    await expect(page.getByTestId("poster-canvas")).not.toContainText(
      EXPECTED.pips,
    );
    await expect(page.getByText(/no closed trades in this period/i)).toBeVisible();
    await expect(page.getByTestId("poster-download")).toBeDisabled();
  });

  test("switching theme repaints the poster", async ({ page }) => {
    await gotoHarness(page);
    const swatch = () =>
      page
        .getByTestId("poster-canvas")
        .locator("> div")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);

    const gold = await swatch();
    await page.getByTestId("poster-theme-ivory").click();
    await expect
      .poll(swatch, { message: "Ivory theme did not repaint" })
      .not.toBe(gold);
  });

  test("every theme paints a distinct canvas", async ({ page }) => {
    await gotoHarness(page);
    const swatch = () =>
      page
        .getByTestId("poster-canvas")
        .locator("> div")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);

    // A theme added by copy-pasting a sibling and forgetting to change tBg
    // renders as a duplicate choice in the picker: two chips, one look.
    const seen = new Map<string, string>();
    for (const id of ["obsidian-gold", "forest-lime", "blue-violet", "ivory"]) {
      await page.getByTestId(`poster-theme-${id}`).click();
      const bg = await swatch();
      expect(seen.get(bg) ?? id, `${id} paints the same canvas as ${seen.get(bg)}`).toBe(id);
      seen.set(bg, id);
    }
    expect(seen.size).toBe(4);
  });

  test("Blue Violet rasterises a real 1080x1080 PNG", async ({ page }) => {
    test.slow(); // Rasterising is CPU-bound; see the note above.
    await gotoHarness(page);
    await page.getByTestId("poster-theme-blue-violet").click();
    const result = await analysePoster(page);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(1080);
    expect(result!.height).toBe(1080);
    // The same two signals the other render tests use: the headline must show
    // ink AND poster background inside its own box, so a missing font (blank)
    // and a lost background-clip (solid slab) are both caught.
    expect(result!.distinctColors).toBeGreaterThan(3);
    expect(result!.heroBgShare).not.toBeNull();
    expect(result!.heroBgShare!).toBeGreaterThan(0.05);
    expect(result!.heroBgShare!).toBeLessThan(0.95);
  });

  test("the headline numeral is gradient-filled, not invisible", async ({
    page,
  }) => {
    await gotoHarness(page);
    const hero = page.getByTestId("poster-canvas").locator(".poster-gradient-text").first();
    const style = await hero.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        color: cs.color,
        clip: cs.backgroundClip || cs.webkitBackgroundClip,
        image: cs.backgroundImage,
      };
    });
    // Unconditional: transparent text is only safe when the clip is applied,
    // and an opaque fallback is only safe when it is NOT transparent. Guarding
    // this behind an `if` would let it pass having asserted nothing.
    expect(style.image).toContain("gradient");
    const transparent = style.color === "rgba(0, 0, 0, 0)";
    expect(
      transparent ? style.clip : "text",
      "transparent numeral without background-clip renders invisible",
    ).toBe("text");
  });

  test("the dense log truncates at 20 rows and says so", async ({ page }) => {
    await page.goto(`${HARNESS}?seed=dense`);
    await expect(page.getByTestId("poster-canvas")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.getByTestId("poster-template-design-c").click();

    // 22 seeded trades -> the 20 most recent shown, the 2 earliest dropped,
    // and the note carries their pips so the printed column still reconciles
    // with the headline.
    await expect(page.getByTestId("poster-canvas")).toContainText(
      /\+ 2 earlier trades not shown \([-+][\d.]+ pips\)/i,
    );
  });

  test("breakeven trades are disclosed in the poster's own footnote", async ({
    page,
  }) => {
    await page.goto(`${HARNESS}?seed=dense`);
    await expect(page.getByTestId("poster-canvas")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    // The supplied designs have no breakeven cell and are reproduced exactly,
    // so wins + losses deliberately will NOT sum to the trade count when any
    // trade scratched. The footnote is what keeps that honest — without it a
    // reader subtracting 13 + 7 from 22 concludes two trades were hidden.
    const canvas = page.getByTestId("poster-canvas");
    await expect(canvas).toContainText("22");
    await expect(canvas).toContainText(/Win rate excludes 2 breakeven trades/i);

    // And the in-app receipt still breaks it out in full.
    await expect(page.getByTestId("poster-receipt")).toContainText("13 / 7 / 2");
  });

  test("partial R coverage is disclosed on the poster itself", async ({
    page,
  }) => {
    await page.goto(`${HARNESS}?seed=dense`);
    await expect(page.getByTestId("poster-canvas")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // One seeded trade has no stop loss, so Avg R covers 21 of 22 — and that
    // qualification has to be IN the PNG, not only in the app's receipt.
    await expect(page.getByTestId("poster-canvas")).toContainText(
      /Avg R covers the 21 of 22 trades/i,
    );
  });
});

/**
 * Logo upload.
 *
 * Two things can only be proven in a browser: that the format gate rejects a
 * file on its BYTES, and that an uploaded logo survives rasterisation. The
 * second is the one that fails silently — `domToBlob` snapshots DOM into an SVG
 * foreignObject, and an image the rasteriser can't inline leaves a blank gap in
 * a PNG that still downloads at the right size and still passes every other
 * assertion in this file.
 */
test.describe("poster logo", () => {
  const TRANSPARENT = "tests/fixtures/logo-transparent.png";
  const OPAQUE = "tests/fixtures/logo-opaque.png";
  /** 2000x600: the only fixture that actually exercises the downscale. */
  const WIDE = "tests/fixtures/logo-wide.png";
  const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  /** Magenta appears in no poster theme, so finding it proves the logo drew. */
  const MAGENTA = { r: 255, g: 0, b: 255 } as const;

  async function uploadLogo(page: Page, fixture: string): Promise<void> {
    await page.getByTestId("poster-logo-input").setInputFiles(fixture);
    await expect(page.getByTestId("poster-logo-preview")).toBeVisible();
  }

  test("a PNG logo replaces the group name on the poster", async ({ page }) => {
    await gotoHarness(page);
    const canvas = page.getByTestId("poster-canvas");

    // The default group name is on the poster before any upload.
    await expect(canvas).toContainText("YOHAN");

    await uploadLogo(page, TRANSPARENT);

    // Replaced, not merely accompanied: printing both would double the brand.
    await expect(canvas.locator("img[alt='YOHAN']")).toBeVisible();
    await expect(canvas).not.toContainText("YOHAN");

    // Removing it restores the name rather than leaving the slot empty.
    await page.getByTestId("poster-logo-remove").click();
    await expect(canvas).toContainText("YOHAN");
  });

  test("the logo is embedded in the rasterised PNG, not left as a gap", async ({
    page,
  }) => {
    test.slow(); // Rasterising 1080x1080 is CPU-bound; see the note above.
    await gotoHarness(page);
    await uploadLogo(page, TRANSPARENT);

    const found = await page.evaluate(async (target) => {
      let captured: Blob | null = null;
      const realCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (b: Blob) => {
        captured = b;
        return realCreate(b);
      };
      try {
        document
          .querySelector<HTMLButtonElement>('[data-testid="poster-download"]')
          ?.click();
        const started = Date.now();
        while (!captured && Date.now() - started < 30_000) {
          await new Promise((r) => setTimeout(r, 200));
        }
      } finally {
        URL.createObjectURL = realCreate;
      }
      if (!captured) return null;

      const bmp = await createImageBitmap(captured as Blob);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);

      // Every pixel, not a stride: the logo prints at 44px tall, which is under
      // 0.2% of the canvas, and a sparse sample would miss it and report a
      // false failure.
      let hits = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Tolerance absorbs the resampling the rasteriser does at the edges.
        if (
          Math.abs(data[i] - target.r) < 24 &&
          Math.abs(data[i + 1] - target.g) < 24 &&
          Math.abs(data[i + 2] - target.b) < 24
        ) {
          hits++;
        }
      }
      return { size: [bmp.width, bmp.height] as const, hits };
    }, MAGENTA);

    expect(found).not.toBeNull();
    expect(found!.size).toEqual([1080, 1080]);
    // The fixture's core is 40/64 of a 44px-tall render, so several hundred
    // magenta pixels is the floor. Zero means the image never inlined.
    expect(found!.hits).toBeGreaterThan(200);
  });

  test("a renamed JPEG is rejected on its bytes, not its extension", async ({
    page,
  }) => {
    await gotoHarness(page);

    // A real JPEG handed over with a .png name and image/png MIME type: the
    // exact file a user produces by renaming a photo in Finder.
    await page.getByTestId("poster-logo-input").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
      ]),
    });

    await expect(page.getByText(/not a PNG/i)).toBeVisible();
    await expect(page.getByTestId("poster-logo-preview")).toHaveCount(0);
    await expect(page.getByTestId("poster-canvas")).toContainText("YOHAN");
    // The input must be cleared, or re-picking the same file after fixing it
    // fires no change event and the user sees nothing happen.
    await expect(page.getByTestId("poster-logo-input")).toHaveValue("");
  });

  test("an opaque PNG is accepted but warned about", async ({ page }) => {
    await gotoHarness(page);
    await uploadLogo(page, OPAQUE);

    // Accepted — the check is a heuristic, and a caller who wants an opaque
    // mark should not be blocked by a pixel sampler. But it must be SAID.
    await expect(page.getByText(/no transparency/i)).toBeVisible();
    await expect(page.getByTestId("poster-logo-preview")).toBeVisible();
  });

  test("the logo survives a reload and is scoped to the journal selection", async ({
    page,
  }) => {
    await gotoHarness(page);
    await uploadLogo(page, TRANSPARENT);

    await page.reload();
    await expect(page.getByTestId("poster-canvas")).toBeVisible();
    await expect(page.getByTestId("poster-logo-preview")).toBeVisible();

    // Ticking a second journal must not carry YOHAN's mark onto a combined
    // poster: the logo is keyed to the COMBINATION, exactly like the name.
    await page.getByTestId("poster-journal-journal-b").click();
    await expect(page.getByTestId("poster-canvas")).toContainText(
      "YOHAN + CHRIS",
    );
    await expect(page.getByTestId("poster-logo-preview")).toHaveCount(0);

    // And it comes BACK when the original selection is restored. Clearing the
    // stored key on a journal change would satisfy every assertion above while
    // destroying the logo the moment someone glanced at a combined poster.
    await page.getByTestId("poster-journal-journal-b").click();
    await expect(page.getByTestId("poster-canvas")).not.toContainText("YOHAN");
    await expect(page.getByTestId("poster-logo-preview")).toBeVisible();
  });

  test("every design prints the logo, not just the default one", async ({
    page,
  }) => {
    await gotoHarness(page);
    await uploadLogo(page, TRANSPARENT);
    // Designs B and C render the logo through a different header at different
    // dimensions. Without this, dropping `logo` from either one's props leaves
    // the whole suite green while two of the three shipped designs print text.
    for (const id of ["design-a", "design-b", "design-c"] as const) {
      await page.getByTestId(`poster-template-${id}`).click();
      const canvas = page.getByTestId("poster-canvas");
      await expect(canvas.locator("img[alt='YOHAN']")).toBeVisible();
      await expect(canvas).not.toContainText("YOHAN");
    }
  });

  test("an oversized logo is downscaled before it is stored", async ({
    page,
  }) => {
    await gotoHarness(page);
    await uploadLogo(page, WIDE);

    // Both other fixtures are 64x64, so the resize is a no-op in every other
    // test. Removing the downscale entirely would keep them all passing while
    // writing megabytes of base64 into a ~5 MB quota.
    const shown = await page
      .getByTestId("poster-logo-preview")
      .evaluate((el: HTMLImageElement) => ({
        w: el.naturalWidth,
        h: el.naturalHeight,
        len: el.src.length,
      }));
    expect(shown.w).toBe(512);
    expect(Math.abs(shown.w / shown.h - 2000 / 600)).toBeLessThan(0.02);
    expect(shown.len).toBeLessThan(400_000);
  });

  test("a PNG over the size cap is refused before it is decoded", async ({
    page,
  }) => {
    await gotoHarness(page);
    await page.getByTestId("poster-logo-input").setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      // A real signature, so this can only be stopped by the SIZE gate.
      buffer: Buffer.concat([
        Buffer.from(PNG_HEAD),
        Buffer.alloc(2 * 1024 * 1024 + 1),
      ]),
    });
    await expect(page.getByText(/over 2 MB/i)).toBeVisible();
    await expect(page.getByTestId("poster-logo-preview")).toHaveCount(0);
  });

  test("an empty file is refused with its own message", async ({ page }) => {
    await gotoHarness(page);
    await page.getByTestId("poster-logo-input").setInputFiles({
      name: "empty.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(0),
    });
    await expect(page.getByText(/file is empty/i)).toBeVisible();
    await expect(page.getByTestId("poster-logo-preview")).toHaveCount(0);
  });

  test("a valid signature with a corrupt body reports a decode failure", async ({
    page,
  }) => {
    await gotoHarness(page);
    await page.getByTestId("poster-logo-input").setInputFiles({
      name: "corrupt.png",
      mimeType: "image/png",
      buffer: Buffer.concat([
        Buffer.from(PNG_HEAD),
        Buffer.from("not an IHDR chunk, at all"),
      ]),
    });
    await expect(page.getByText(/could not be decoded/i)).toBeVisible();
    await expect(page.getByTestId("poster-logo-preview")).toHaveCount(0);
    // The spinner must clear, or the control is dead for the rest of the
    // session behind a permanently disabled button.
    await expect(page.getByTestId("poster-logo-upload")).toBeEnabled();
  });

  test("a full quota still applies the logo, and says it won't be remembered", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k.startsWith("trdr_poster_logo:")) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        return real.call(this, k, v);
      };
    });
    await gotoHarness(page);
    await uploadLogo(page, TRANSPARENT);
    await expect(page.getByText(/couldn't be saved/i)).toBeVisible();
    // Applied for this session regardless: only remembering it failed.
    await expect(
      page.getByTestId("poster-canvas").locator("img[alt='YOHAN']"),
    ).toBeVisible();
  });

  test("a file shorter than the signature is refused, not crashed on", async ({
    page,
  }) => {
    await gotoHarness(page);
    // 4 bytes. Reading a fixed 8-byte view of this buffer throws RangeError,
    // which is NOT a LogoError, so it would reach the user as a raw engine
    // string instead of copy they can act on.
    await page.getByTestId("poster-logo-input").setInputFiles({
      name: "stub.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    await expect(page.getByText(/not a PNG/i)).toBeVisible();
    await expect(page.getByText(/typed array|RangeError/i)).toHaveCount(0);
    await expect(page.getByTestId("poster-logo-preview")).toHaveCount(0);
  });

  test("a PNG declaring huge dimensions is refused before it is decoded", async ({
    page,
  }) => {
    await gotoHarness(page);
    // A valid signature and an IHDR declaring 30000x30000 (900 Mpx). Only the
    // header is present, so if this reaches the decoder it fails as "could not
    // be decoded" — asserting the DIMENSIONS message is what proves the cap
    // ran first, off the header, before any RGBA buffer was allocated.
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write("IHDR", 4, "ascii");
    ihdr.writeUInt32BE(30000, 8);
    ihdr.writeUInt32BE(30000, 12);
    ihdr[16] = 8;
    ihdr[17] = 6;
    await page.getByTestId("poster-logo-input").setInputFiles({
      name: "bomb.png",
      mimeType: "image/png",
      buffer: Buffer.concat([Buffer.from(PNG_HEAD), ihdr]),
    });
    await expect(page.getByText(/dimensions are too large/i)).toBeVisible();
    await expect(page.getByTestId("poster-logo-preview")).toHaveCount(0);
  });

  test("exports are blocked while a logo is still decoding", async ({
    page,
  }) => {
    await gotoHarness(page);
    // Hold the decode open so the busy window is observable. Without the gate,
    // Download here rasterises the poster still showing the group NAME and
    // reports success, so the user publishes an unbranded poster.
    await page.evaluate(() => {
      const real = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function () {
        return new Promise((resolve) =>
          setTimeout(() => resolve(real.call(this)), 1500),
        );
      };
    });
    await page.getByTestId("poster-logo-input").setInputFiles(TRANSPARENT);
    await expect(page.getByTestId("poster-download")).toBeDisabled();
    await expect(page.getByTestId("poster-copy")).toBeDisabled();
    // And released once it lands.
    await expect(page.getByTestId("poster-logo-preview")).toBeVisible();
    await expect(page.getByTestId("poster-download")).toBeEnabled();
  });

  test("a tampered storage entry is ignored rather than rendered", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // An http URL where a data URL belongs. The rasteriser only skips its
      // fetch step for "data:", so rendering this would turn a poster export
      // into a callout to someone else's origin.
      window.localStorage.setItem(
        "trdr_poster_logo:journal-a",
        "https://example.invalid/tracker.png",
      );
    });
    await gotoHarness(page);
    await expect(page.getByTestId("poster-logo-preview")).toHaveCount(0);
    await expect(page.getByTestId("poster-canvas")).toContainText("YOHAN");
  });
});

/**
 * Telegram connect endpoints.
 *
 * These reach a third party and can make it deliver a message to a room full
 * of partners, so the auth gate matters more than usual. Asserted anonymously,
 * following the import.spec.ts precedent — no session, no secrets needed.
 */
test.describe("telegram connect — auth gate", () => {
  test("listing groups requires a session", async ({ request }) => {
    const res = await request.get("/api/telegram/chats");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  test("connecting a destination requires a session", async ({ request }) => {
    const res = await request.post("/api/telegram/destination", {
      data: { chat_id: "-1001234567890", chat_title: "Someone else's group" },
    });
    expect(res.status()).toBe(401);
  });

  test("sending a test message requires a session", async ({ request }) => {
    // The one that actually notifies people. An anonymous caller must never
    // be able to make the bot post.
    const res = await request.post("/api/telegram/test");
    expect(res.status()).toBe(401);
  });

  test("disconnecting requires a session", async ({ request }) => {
    const res = await request.delete("/api/telegram/destination");
    expect(res.status()).toBe(401);
  });
});
