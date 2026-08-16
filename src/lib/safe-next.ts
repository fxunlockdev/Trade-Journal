/**
 * Open-redirect guard for post-auth (`?next=`) redirects.
 *
 * Returns `raw` only when it is a safe, relative, in-app path. Anything that
 * could bounce the user to another origin — an absolute URL, a
 * protocol-relative `//host`, or the `/\host` backslash trick some browsers
 * normalise to `//host` — falls back to `fallback`.
 *
 * The value must already be URL-decoded (Next's `useSearchParams().get()`
 * returns decoded values), so a single pass is sufficient.
 */
export function safeInternalPath(
  raw: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback; // must be relative to this origin
  if (raw.startsWith("//")) return fallback; // protocol-relative -> off-site
  if (raw.startsWith("/\\")) return fallback; // backslash -> normalised off-site
  return raw;
}
