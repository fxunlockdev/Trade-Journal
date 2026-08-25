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
      /only 1 traded in this period/i,
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
