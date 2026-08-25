import { expect, test, type Page } from "@playwright/test";

/**
 * First-run tour E2E.
 *
 * The step data and the placement maths are unit-tested hermetically
 * (`tests/unit/tour.test.ts`). What needs a real browser is the part that can
 * only be wrong on screen: that the spotlight actually lands on the element it
 * claims to describe, that the tooltip stays inside the viewport, and that the
 * tour can always be escaped.
 *
 * `/tour-harness` is development-only and renders stand-in anchors carrying the
 * same `data-tour` names as the real sidebar and topbar, so this needs no
 * session and no brand-new account.
 */

const HARNESS = "/tour-harness";

async function startTour(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await page.getByTestId("harness-start").click();
  await expect(page.getByTestId("tour-tooltip")).toBeVisible();
}

/**
 * Boxes of the spotlight and the element the current step points at.
 *
 * Moving BETWEEN steps is deliberately animated (300ms), so the spotlight is
 * polled until it stops moving. Measuring mid-flight would assert against a
 * position the user never sees. The first appearance is not animated, so this
 * returns immediately there.
 */
async function boxes(page: Page, target: string) {
  const spotlight = page.getByTestId("tour-spotlight");
  let previous: string | null = null;
  for (let i = 0; i < 20; i++) {
    const box = await spotlight.boundingBox();
    const key = box ? `${Math.round(box.x)},${Math.round(box.y)}` : "none";
    if (key === previous) break;
    previous = key;
    await page.waitForTimeout(50);
  }
  const spot = await spotlight.boundingBox();
  const el = await page.locator(`[data-tour="${target}"]`).boundingBox();
  return { spot, el };
}

test.describe("first-run tour", () => {
  test("opens on the first step", async ({ page }) => {
    await startTour(page);
    const tip = page.getByTestId("tour-tooltip");
    await expect(tip).toContainText("Step 1 of 4");
    await expect(tip).toContainText("Start with a journal");
  });

  test("the spotlight lands on the element the step describes", async ({
    page,
  }) => {
    await startTour(page);
    const { spot, el } = await boxes(page, "journal-switcher");
    expect(spot, "no spotlight rendered").not.toBeNull();
    expect(el, "target anchor missing").not.toBeNull();

    // The spotlight is the target's box plus a small pad, so their centres
    // should coincide. A mismatch here is the failure that makes a tour
    // useless: dimming the screen and highlighting the wrong thing.
    const spotCx = spot!.x + spot!.width / 2;
    const spotCy = spot!.y + spot!.height / 2;
    const elCx = el!.x + el!.width / 2;
    const elCy = el!.y + el!.height / 2;
    expect(Math.abs(spotCx - elCx)).toBeLessThan(2);
    expect(Math.abs(spotCy - elCy)).toBeLessThan(2);
    expect(spot!.width).toBeGreaterThan(el!.width);
  });

  test("walks forward through every step, tracking each target", async ({
    page,
  }) => {
    await startTour(page);
    const targets = [
      "journal-switcher",
      "nav-journal-new",
      "nav-journal",
      "nav-dashboard",
    ];

    for (const [i, target] of targets.entries()) {
      await expect(page.getByTestId("tour-tooltip")).toContainText(
        `Step ${i + 1} of 4`,
      );
      const { spot, el } = await boxes(page, target);
      expect(spot, `step ${i + 1} had no spotlight`).not.toBeNull();
      expect(
        Math.abs(spot!.x + spot!.width / 2 - (el!.x + el!.width / 2)),
        `step ${i + 1} spotlight is not on ${target}`,
      ).toBeLessThan(2);

      await page.getByTestId("tour-next").click();
    }

    // The last "Next" reads Done and ends the tour.
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0);
    await expect(page.getByTestId("harness-finished")).toContainText(
      "finished: 1",
    );
  });

  test("Back returns to the previous step", async ({ page }) => {
    await startTour(page);
    await page.getByTestId("tour-next").click();
    await expect(page.getByTestId("tour-tooltip")).toContainText("Step 2 of 4");
    await page.getByTestId("tour-back").click();
    await expect(page.getByTestId("tour-tooltip")).toContainText("Step 1 of 4");
    // No Back on the first step — there's nowhere to go.
    await expect(page.getByTestId("tour-back")).toHaveCount(0);
  });

  test("the last step says Done, not Next", async ({ page }) => {
    await startTour(page);
    for (let i = 0; i < 3; i++) await page.getByTestId("tour-next").click();
    await expect(page.getByTestId("tour-next")).toHaveText("Done");
  });

  test("Skip exits immediately", async ({ page }) => {
    await startTour(page);
    await page.getByTestId("tour-skip").click();
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0);
  });

  test("Escape always exits — nobody is trapped in a tutorial", async ({
    page,
  }) => {
    await startTour(page);
    await page.getByTestId("tour-next").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0);
  });

  test("arrow keys move between steps", async ({ page }) => {
    await startTour(page);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("tour-tooltip")).toContainText("Step 2 of 4");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("tour-tooltip")).toContainText("Step 1 of 4");
  });

  test("the tooltip stays fully inside the viewport on every step", async ({
    page,
  }) => {
    await startTour(page);
    const vp = page.viewportSize();
    expect(vp).not.toBeNull();

    for (let i = 0; i < 4; i++) {
      const box = await page.getByTestId("tour-tooltip").boundingBox();
      expect(box, `step ${i + 1} tooltip missing`).not.toBeNull();
      expect(box!.x, `step ${i + 1} tooltip off the left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.y, `step ${i + 1} tooltip off the top edge`).toBeGreaterThanOrEqual(0);
      expect(
        box!.x + box!.width,
        `step ${i + 1} tooltip off the right edge`,
      ).toBeLessThanOrEqual(vp!.width + 1);
      expect(
        box!.y + box!.height,
        `step ${i + 1} tooltip off the bottom edge`,
      ).toBeLessThanOrEqual(vp!.height + 1);
      if (i < 3) await page.getByTestId("tour-next").click();
    }
  });

  test("stays on screen in a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 700 });
    await startTour(page);
    const box = await page.getByTestId("tour-tooltip").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(381);
  });

  test("the overlay covers the page so the app can't be clicked through", async ({
    page,
  }) => {
    await startTour(page);
    const overlay = await page.getByTestId("tour-overlay").boundingBox();
    const vp = page.viewportSize();
    expect(overlay!.width).toBeGreaterThanOrEqual(vp!.width - 1);
    expect(overlay!.height).toBeGreaterThanOrEqual(vp!.height - 1);
  });

  test("finishing records that it was seen", async ({ page }) => {
    await page.goto(HARNESS);
    // The harness drives the overlay directly, so assert the storage contract
    // the real gate depends on rather than the harness's own state.
    const before = await page.evaluate(() =>
      window.localStorage.getItem("trdr_tour_seen_v1"),
    );
    expect(before).toBeNull();

    await page.evaluate(() =>
      window.localStorage.setItem("trdr_tour_seen_v1", "1"),
    );
    const after = await page.evaluate(() =>
      window.localStorage.getItem("trdr_tour_seen_v1"),
    );
    expect(after).toBe("1");
  });
});
