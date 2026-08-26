/**
 * localStorage that cannot take a page down.
 *
 * Touching `window.localStorage` THROWS, rather than returning null, in
 * situations that are ordinary rather than exotic: Safari's private mode,
 * Firefox with dom.storage disabled, and Chrome with cookies blocked for the
 * site all raise SecurityError on access. A write also throws
 * QuotaExceededError once the ~5 MB origin budget is full.
 *
 * The policy is stated once, here, because a guard is only worth having if
 * every call site uses it. One unprotected `getItem` in an effect throws before
 * any downstream guard runs, React unwinds to the nearest error boundary, and
 * the page renders blank over a preference that was never important enough to
 * break anything.
 *
 * Reads and removes cannot usefully report failure, so they don't: a missing
 * preference is a cosmetic loss. Writes DO report it, because "this won't be
 * remembered" is something the user needs told.
 */

/** The stored value, or null if absent or unreadable. */
export function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** True when the value was stored. False means over quota or blocked. */
export function safeSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** True when the key is gone. False means the removal itself was blocked. */
export function safeRemove(key: string): boolean {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
