/**
 * One-time codes that prove someone is actually in the group.
 *
 * A Trade Journal account and a Telegram account are unrelated identities, and
 * Telegram cannot be asked "is this app user in that chat?". So the user proves
 * it the only way available: by posting a code IN the group, somewhere only a
 * member could put it.
 *
 * Pure, so the alphabet and the matching are testable without a bot.
 *
 * There are now two KINDS of code, and they must never be interchangeable:
 *
 *   TJ-   connects a chat as a publishing destination
 *   ME-   links a Telegram account to an app account
 *
 * A single prefix would let a code minted to connect a group be posted to link
 * an account instead, which are very different grants. Distinct prefixes mean a
 * code only ever does the thing it was issued for.
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

/** Connects a chat as a publishing destination. */
export const CLAIM_PREFIX = "TJ-";
/** Links a Telegram account to an app account. */
export const LINK_PREFIX = "ME-";
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
function generateCode(prefix: string, randomBytes: Uint8Array): string {
  let body = "";
  for (let i = 0; i < CLAIM_BODY_LENGTH; i += 1) {
    body += ALPHABET[randomBytes[i] % ALPHABET.length];
  }
  return `${prefix}${body}`;
}

/** A chat-connect code. */
export function generateClaimCode(randomBytes: Uint8Array): string {
  return generateCode(CLAIM_PREFIX, randomBytes);
}

/** An account-link code. */
export function generateLinkCode(randomBytes: Uint8Array): string {
  return generateCode(LINK_PREFIX, randomBytes);
}

/**
 * Built per prefix, and bounded at BOTH ends: a code is exactly the prefix
 * plus the body, not a longer run of letters that happens to start with it.
 * Without the trailing bound "TJ-ACDEFGHJ" was read as "TJ-ACDEFG".
 *
 * "ME-" is not a suffix of "TJ-" or the reverse, so the two prefixes cannot be
 * confused; the constraint is written down because they are the only thing
 * keeping the two grants apart.
 */
function codeRe(prefix: string): RegExp {
  const safePrefix = prefix.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(
    `(?<![A-Z0-9])${safePrefix}[${ALPHABET}]{${CLAIM_BODY_LENGTH}}(?![A-Z0-9])`,
    "i",
  );
}

const CLAIM_RE = codeRe(CLAIM_PREFIX);
const LINK_RE = codeRe(LINK_PREFIX);

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

/** Find an account-link code inside a message, or null. */
export function findLinkCode(text: string | undefined): string | null {
  if (!text) return null;
  const match = LINK_RE.exec(text);
  return match ? match[0].toUpperCase() : null;
}
