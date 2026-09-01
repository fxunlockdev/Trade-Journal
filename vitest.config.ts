import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the "@/*" paths from tsconfig.json natively (no plugin needed).
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` is a marker package: its default entry THROWS, and only
      // the "react-server" export condition resolves to a no-op. Next applies
      // that condition; vitest does not, so a server module under test would
      // fail on import. Pointed at the package's own empty build rather than
      // stripping the import from the source — that import is what fails the
      // BUILD if a module holding secrets ever reaches a client bundle.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    // Unit/integration only — Playwright owns tests/e2e (different runner).
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
