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
  // undici must stay external: bundling can break its internals (llhttp wasm,
  // dispatcher wiring) at runtime even when the build succeeds — and the
  // Myfxbook static-IP ProxyAgent depends on it.
  serverExternalPackages: ["openai", "undici"],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
