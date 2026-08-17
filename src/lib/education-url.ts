/**
 * Live Education lives on its own site.
 *
 * Set NEXT_PUBLIC_EDUCATION_URL to that address and every "Live Education" link
 * (nav, app tile, section CTA) points there and opens in a new tab. Until it's
 * set, the links fall back to the bundled /education page so nothing 404s.
 *
 * One env var is the whole switch — no code change needed when the URL lands.
 */
const configured = process.env.NEXT_PUBLIC_EDUCATION_URL?.trim();

export const EDUCATION_URL: string =
  configured && configured.length > 0 ? configured : "/education";

/** True when EDUCATION_URL points off-site (so links get target/rel). */
export function isExternalEducation(): boolean {
  return /^https?:\/\//i.test(EDUCATION_URL);
}
