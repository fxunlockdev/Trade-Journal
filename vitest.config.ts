import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the "@/*" paths from tsconfig.json natively (no plugin needed).
  resolve: { tsconfigPaths: true },
  test: {
    // Unit/integration only — Playwright owns tests/e2e (different runner).
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
