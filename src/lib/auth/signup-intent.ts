/**
 * Carrying the "who are you?" answer across the sign-up round trip.
 *
 * The choice is made on the sign-up form, but the account does not exist yet at
 * that moment, so there is nowhere to write it. Both sign-up paths then leave
 * the page before the user is real:
 *
 * - Google bounces through accounts.google.com and back.
 * - Email sends a confirmation link that is clicked later.
 *
 * So the answer travels two ways, and whichever arrives first wins:
 *
 * 1. `options.data` on signUp, which Supabase stores as user_metadata. Survives
 *    anything, including the confirmation link being opened days later in a
 *    different browser. Not available for OAuth, which takes no such payload.
 * 2. sessionStorage, which survives a cross-origin redirect in the same tab and
 *    so covers Google. Lost if the tab is closed, hence the fallback below.
 *
 * If both miss, IntentPrompt still asks after sign-in, so the answer is never
 * simply dropped. Nothing here grants access: recording "ib" files a request
 * that an admin has to approve. See record_signup_intent().
 */

export type SignupIntent = "trader" | "ib";

const STORAGE_KEY = "fxu:signup-intent";

export function isSignupIntent(value: unknown): value is SignupIntent {
  return value === "trader" || value === "ib";
}

/** Called just before we hand off to Google or submit the sign-up form. */
export function stashSignupIntent(intent: SignupIntent): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, intent);
  } catch {
    // Private mode, or storage disabled. IntentPrompt will ask instead.
  }
}

/**
 * Read and clear in one step. Clearing matters: record_signup_intent is
 * write-once, so a stale value left behind would be retried on every visit and
 * fail every time.
 */
export function takeSignupIntent(): SignupIntent | null {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    if (value !== null) window.sessionStorage.removeItem(STORAGE_KEY);
    return isSignupIntent(value) ? value : null;
  } catch {
    return null;
  }
}
