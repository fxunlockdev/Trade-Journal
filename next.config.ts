import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // undici must stay external: bundling can break its internals (llhttp wasm,
  // dispatcher wiring) at runtime even when the build succeeds — and the
  // Myfxbook static-IP ProxyAgent depends on it.
  serverExternalPackages: ["openai", "undici"],
};

export default nextConfig;
