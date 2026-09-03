/**
 * The secret-header check on the public webhook, as a pure function so it can
 * be tested. Constant-time over the characters when the lengths match; an
 * early return on a length mismatch leaks only the length.
 */
export function secretMatches(presented: string | null, expected: string | null): boolean {
  if (!expected) return false;
  const got = presented ?? "";
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i += 1) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
