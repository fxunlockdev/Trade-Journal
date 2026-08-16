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

  // The WHATWG URL parser (used by router.push internally) strips tabs,
  // newlines and other C0 control chars as its FIRST normalization step, so a
  // crafted `/<tab>/evil.com` would slip past the checks below and then be
  // re-normalised to `//evil.com` at navigation time. Drop C0 controls (0x00-
  // 0x1F, which includes tab/newline/CR) and DEL (0x7F) up front so the string
  // we validate is exactly the string that gets navigated to.
  const clean = Array.from(raw)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");

  if (!clean.startsWith("/")) return fallback; // must be relative to this origin
  if (clean.startsWith("//")) return fallback; // protocol-relative -> off-site
  if (clean.startsWith("/\\")) return fallback; // backslash -> normalised off-site
  return clean;
}
