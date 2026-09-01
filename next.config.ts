import type { NextConfig } from "next";

/**
 * Security headers (W6). Applied to every route. HSTS is safe here because the
 * app is served over HTTPS (Vercel) and has no plain-HTTP subdomains that need
 * to stay reachable. The CSP is intentionally NOT set here yet — a strict CSP
 * needs per-request nonces wired through the app (Server Components + inline
 * styles), which is a dedicated task; shipping a broken/over-broad CSP is worse
 * than none. Tracked in NOTES.md.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Packages the bundler must NOT relocate.
  //
  // undici: bundling can break its internals (llhttp wasm, dispatcher wiring)
  // at runtime even when the build succeeds.
  //
  // @sparticuz/chromium ships a brotli-compressed Chromium in its own `bin`
  // directory and resolves that path relative to itself at runtime. Bundled,
  // the code is relocated and the binary is left behind.
  // puppeteer-core rides along because it is what loads it.
  serverExternalPackages: [
    "openai",
    "undici",
    "@sparticuz/chromium",
    "puppeteer-core",
  ],

  // The other half of shipping Chromium, and the half that is easy to miss.
  //
  // `serverExternalPackages` stops the bundler REWRITING the module, so
  // `require("@sparticuz/chromium")` still points at node_modules. It says
  // nothing about which FILES get copied into the deployed function: Vercel
  // decides that by tracing `import`/`require`/`fs` with @vercel/nft.
  //
  // Chromium itself is four brotli archives in `bin/` (chromium.br is ~65MB).
  // Nothing imports them — they are opened at runtime from a path built with
  // `__dirname` — so the tracer cannot see them and never copies them. The
  // deployed function then has the library but not the browser, and fails with
  //   The input directory "/var/task/node_modules/@sparticuz/chromium/bin"
  //   does not exist
  // which reads like a bundling problem and is really a packaging one. Adding
  // the package to `serverExternalPackages` alone does NOT fix it; production
  // returned that same error, unchanged, after it was added.
  //
  // Listing the directory explicitly is the documented remedy for exactly this
  // shape of dependency — Next's own example is a native binary under
  // `node_modules/aws-crt/dist/bin`.
  //
  // Scoped to the report routes on purpose: this adds ~69MB to whatever it
  // matches, so a global `/*` key would inflate every function in the app.
  // ANY NEW ROUTE THAT RENDERS A POSTER NEEDS A KEY HERE — the scheduled cron
  // entry point will, when it lands, and it will fail exactly like the above
  // if it does not get one.
  outputFileTracingIncludes: {
    "/api/reports/**": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
