/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * We use it to fail loud (P8) if required environment is missing/invalid, so a
 * misconfigured deploy never reaches the first request.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime has the full secret set; skip the Edge
  // (middleware) runtime, which validates its own narrower needs at use time.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/lib/env");
    validateEnv();
  }
}
