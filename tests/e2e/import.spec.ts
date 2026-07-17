import { join } from "node:path";
import { expect, test, type Page, type Locator } from "@playwright/test";

/**
 * Report-import E2E.
 *
 * Scope is deliberate:
 *  - The import API and page are auth-gated, so the always-on tests cover the
 *    contract that needs no secrets: the gate holds, and the endpoint rejects
 *    anonymous uploads of a real file.
 *  - The full upload → preview journey needs a real session, so it runs only
 *    when E2E_EMAIL / E2E_PASSWORD are supplied (see README). It stops at
 *    PREVIEW, which is read-only by design — E2E must never write trades into
 *    a real journal.
 *  - Parsing itself (UTF-16, French, sparse cells, MT4/HTML/PDF) is covered
 *    exhaustively and hermetically by `npm test` — that's the right layer for
 *    it, and it runs in milliseconds without a browser.
 */

const FIXTURE = join(process.cwd(), "tests/fixtures/mt5-history-fr.xlsx");
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const hasCreds = Boolean(EMAIL && PASSWORD);

class ImportPage {
  readonly page: Page;
  readonly fileInput: Locator;
  readonly previewButton: Locator;
  readonly previewCard: Locator;
  readonly rows: Locator;
  readonly account: Locator;
  readonly platform: Locator;
  readonly commitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.fileInput = page.getByTestId("import-file");
    this.previewButton = page.getByTestId("import-preview");
    this.previewCard = page.getByTestId("import-preview-card");
    this.rows = page.getByTestId("import-row");
    this.account = page.getByTestId("import-account");
    this.platform = page.getByTestId("import-platform");
    this.commitButton = page.getByTestId("import-commit");
  }

  async goto() {
    await this.page.goto("/import");
  }

  async choose(file: string) {
    await this.fileInput.setInputFiles(file);
  }

  /** Upload + preview. Read-only: nothing is written to the journal. */
  async preview() {
    const response = this.page.waitForResponse(
      (r) => r.url().includes("/api/import/mt5-report") && r.request().method() === "POST",
    );
    await this.previewButton.click();
    return response;
  }
}

test.describe("import — auth gate (no secrets needed)", () => {
  test("the /import page requires a session", async ({ page }) => {
    await page.goto("/import");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the API refuses an anonymous upload of a real report", async ({ request }) => {
    const response = await request.post("/api/import/mt5-report", {
      multipart: {
        file: FIXTURE,
        journal_id: "00000000-0000-0000-0000-000000000000",
        utc_offset: "0",
        mode: "preview",
      },
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  test("the API refuses an anonymous commit", async ({ request }) => {
    const response = await request.post("/api/import/mt5-report", {
      multipart: {
        file: FIXTURE,
        journal_id: "00000000-0000-0000-0000-000000000000",
        utc_offset: "0",
        mode: "commit",
      },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("import — full journey", () => {
  test.skip(
    !hasCreds,
    "Set E2E_EMAIL and E2E_PASSWORD to run the authenticated upload journey.",
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i).fill(PASSWORD!);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  });

  test("previews the French UTF-16 XLSX report with correct trades", async ({ page }) => {
    const importPage = new ImportPage(page);
    await importPage.goto();
    await importPage.choose(FIXTURE);

    const response = await importPage.preview();
    expect(response.status()).toBe(200);

    await expect(importPage.previewCard).toBeVisible();
    await expect(importPage.platform).toHaveText(/mt5/i);
    await expect(importPage.account).toContainText("99999999");
    // The fixture holds exactly 10 closed positions — Orders/Deals excluded.
    await expect(importPage.rows).toHaveCount(10);
    await expect(page.getByText("EURUSD.s").first()).toBeVisible();

    await page.screenshot({ path: "artifacts/import-preview.png", fullPage: true });

    // Deliberately NOT clicking commit: previews write nothing, and an E2E run
    // must not inject trades into a real journal.
    await expect(importPage.commitButton).toBeVisible();
  });

  test("rejects a non-report file with an actionable message", async ({ page }, testInfo) => {
    const importPage = new ImportPage(page);
    await importPage.goto();
    const junk = join(testInfo.outputPath(), "not-a-report.html");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(junk, "<html><body>hello, no table here</body></html>");

    await importPage.choose(junk);
    const response = await importPage.preview();
    expect(response.status()).toBe(422);
    await expect(page.getByText(/doesn't look like an MT4\/MT5 report/i)).toBeVisible();
  });
});
