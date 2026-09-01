/**
 * One-time codes that prove someone is actually in the group.
 *
 * A Trade Journal account and a Telegram account are unrelated identities, and
 * Telegram cannot be asked "is this app user in that chat?". So the user proves
 * it the only way available: by posting a code IN the group, somewhere only a
 * member could put it.
 *
 * Pure, so the alphabet and the matching are testable without a bot.
 */

/**
 * Deliberately excludes 0/O, 1/I/L and 8/B.
 *
 * The code is read off a screen and typed into a phone, usually by someone in a
 * hurry. Every excluded pair is one that gets mistyped, and a mistyped code is
 * indistinguishable from an expired one, which sends people back to the start
 * for no reason.
 */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXY2345679";

export const CLAIM_PREFIX = "TJ-";
export const CLAIM_BODY_LENGTH = 6;

/**
 * `randomBytes` rather than Math.random: this is the ONLY thing standing
 * between a stranger and attaching their group to someone else's account, so it
 * must not be predictable from a previous code.
 *
 * The modulo bias here is negligible (27 into 256) and the code is single-use
 * and expires in fifteen minutes, so the practical entropy is what matters:
 * 27^6, about 387 million, against a fifteen-minute window.
 */
export function generateClaimCode(randomBytes: Uint8Array): string {
  let body = "";
  for (let i = 0; i < CLAIM_BODY_LENGTH; i += 1) {
    body += ALPHABET[randomBytes[i] % ALPHABET.length];
  }
  return `${CLAIM_PREFIX}${body}`;
}

const CLAIM_RE = new RegExp(
  `${CLAIM_PREFIX}[${ALPHABET}]{${CLAIM_BODY_LENGTH}}`,
  "i",
);

/**
 * Find a claim code inside a message, or null.
 *
 * Matched anywhere in the text rather than requiring the whole message to be
 * the code: people add "here you go" around it, and refusing those would look
 * broken for no gain. Upper-cased on the way out so the lookup is
 * case-insensitive without needing a case-insensitive index.
 */
export function findClaimCode(text: string | undefined): string | null {
  if (!text) return null;
  const match = CLAIM_RE.exec(text);
  return match ? match[0].toUpperCase() : null;
}
