import "server-only";

/**
 * Posting images to Telegram.
 *
 * Separate from `client.ts` because sending media is a different shape of
 * request: JSON for text, multipart for bytes, and an album is one call
 * carrying several files plus a JSON manifest describing them.
 *
 * Bytes go up directly from memory. Nothing is written to storage first: a
 * poster is rendered from a FROZEN snapshot, so a retry re-renders the same
 * image rather than needing a copy kept somewhere. That removes a bucket,
 * signed URLs, a cleanup job, and the "send failed, now the file leaks" case,
 * at the cost of re-rendering on the rare retry.
 */

/** Telegram's cap on a media caption. Longer and the whole call is rejected. */
export const CAPTION_MAX = 1024;

/** Telegram's cap on one album. Three styles per desk sits well inside it. */
export const ALBUM_MAX = 10;

/**
 * How long one HTTP call to Telegram may take.
 *
 * `fetch` has no timeout of its own. Without this, a stalled connection parks
 * the invocation until the platform kills it, which is the worst possible
 * outcome: the album may or may not have posted and no code runs to record
 * which.
 */
const CALL_TIMEOUT_MS = 60_000;

export interface TelegramPhoto {
  readonly bytes: Buffer;
  /** Shown in Telegram's file view, so it should read as a name, not an id. */
  readonly filename: string;
}

export interface TelegramSendResult {
  /** Every message id the album produced, in order. */
  readonly messageIds: readonly number[];
}

/**
 * A failed send, and whether it might have landed anyway.
 *
 * This distinction is the whole reason this class exists. Telegram has no
 * idempotency key, so a caller deciding whether to retry has exactly one
 * question: could the album already be sitting in the group?
 *
 *   inDoubt = false   Telegram answered, in valid JSON, that it refused.
 *                     Nothing was published. Retrying is safe.
 *   inDoubt = true    Anything else. The request may have been received and
 *                     acted on while the response was lost. Retrying risks a
 *                     second album in front of partners.
 */
export class TelegramSendError extends Error {
  readonly inDoubt: boolean;
  constructor(message: string, inDoubt: boolean) {
    super(message);
    this.name = "TelegramSendError";
    this.inDoubt = inDoubt;
  }
}

interface TelegramError {
  readonly description?: string;
  readonly error_code?: number;
  readonly parameters?: { readonly retry_after?: number };
}

/**
 * How long to wait when Telegram asks us to slow down.
 *
 * `retry_after` is in seconds and is an instruction, not a suggestion: sending
 * again early extends the penalty. Clamped because a hostile or garbled value
 * must not park a serverless function until it times out.
 */
export function retryAfterMs(
  body: TelegramError | null,
  capSeconds = 60,
): number | null {
  const seconds = body?.parameters?.retry_after;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  if (seconds < 0) return null;
  return Math.min(seconds, capSeconds) * 1000;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Should we spend `waitMs` sleeping, then try again?
 *
 * Only if the retry can actually finish. Sleeping 60s inside an invocation with
 * 20s of budget left converts a rate-limit into a platform kill, which is the
 * in-doubt case: strictly worse than giving up cleanly and retrying later.
 */
export function retryFitsBudget(
  waitMs: number,
  msRemaining: number,
  callBudgetMs = CALL_TIMEOUT_MS,
): boolean {
  return waitMs + callBudgetMs <= msRemaining;
}

interface CallOptions {
  /** Milliseconds of invocation budget left, for the retry decision above. */
  readonly msRemaining: number;
  readonly attempts?: number;
}

/**
 * One Telegram call, honouring back-pressure and classifying every failure.
 *
 * Only 429 is retried. A 400 means the request itself is wrong and will be
 * wrong again; retrying only delays the error.
 */
async function callTelegram(
  botToken: string,
  method: string,
  form: FormData,
  options: CallOptions,
): Promise<unknown> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const attempts = options.attempts ?? 3;
  const startedAt = Date.now();

  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err: unknown) {
      // The request left this process. Whether Telegram acted on it is
      // unknowable from here, so this is in doubt, not a clean failure.
      throw new TelegramSendError(
        `Telegram ${method} did not complete: ${err instanceof Error ? err.message : "network error"}`,
        true,
      );
    }

    // Read as TEXT first. An edge returning an HTML 502 makes `.json()` throw,
    // and a SyntaxError here would otherwise be indistinguishable from a clean
    // refusal, which is exactly the mistake that leads to a duplicate album.
    const raw = await response.text().catch(() => "");
    let data: ({ ok: true; result: unknown } | ({ ok: false } & TelegramError)) | null =
      null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    if (data === null) {
      throw new TelegramSendError(
        `Telegram ${method} returned a non-JSON response (HTTP ${response.status}).`,
        true,
      );
    }

    if (data.ok) return data.result;

    // From here on Telegram has answered in its own protocol, so a refusal is
    // definitive: nothing was published.
    const wait = response.status === 429 ? retryAfterMs(data) : null;
    const elapsed = Date.now() - startedAt;
    const canRetry =
      wait !== null &&
      attempt < attempts &&
      retryFitsBudget(wait, options.msRemaining - elapsed);

    if (!canRetry) {
      // The token lives in `url`, so the URL never appears in the message.
      throw new TelegramSendError(
        `Telegram ${method} failed: ${data.description ?? `HTTP ${response.status}`}`,
        false,
      );
    }
    await sleep(wait);
  }
}

/**
 * Post several images as a single album with one caption.
 *
 * Telegram wants the files as multipart parts and a `media` manifest that
 * refers to them by `attach://<name>`, which is why this cannot be plain JSON.
 * The caption belongs to the FIRST item only: repeating it would render once
 * per image in the client.
 */
export async function sendTelegramAlbum(
  botToken: string,
  chatId: string,
  photos: readonly TelegramPhoto[],
  caption: string,
  msRemaining: number,
): Promise<TelegramSendResult> {
  if (photos.length === 0) {
    throw new TelegramSendError("An album needs at least one image.", false);
  }
  if (photos.length > ALBUM_MAX) {
    throw new TelegramSendError(
      `Telegram allows ${ALBUM_MAX} images per album; got ${photos.length}.`,
      false,
    );
  }
  // Asserted, not silently trimmed. `buildCaption` drops whole lines to stay
  // inside the cap; a slice here would cut mid-tag, and a malformed HTML entity
  // makes Telegram reject the entire call, images included.
  if (caption.length > CAPTION_MAX) {
    throw new TelegramSendError(
      `Caption is ${caption.length} characters, over Telegram's ${CAPTION_MAX} limit.`,
      false,
    );
  }

  const form = new FormData();
  form.append("chat_id", chatId);

  const manifest = photos.map((_photo, index) => ({
    type: "photo",
    media: `attach://file${index}`,
    // Caption on the first item only: this is what makes it read as one post.
    ...(index === 0 && caption ? { caption, parse_mode: "HTML" } : {}),
  }));
  form.append("media", JSON.stringify(manifest));

  photos.forEach((photo, index) => {
    form.append(
      `file${index}`,
      new Blob([new Uint8Array(photo.bytes)], { type: "image/png" }),
      photo.filename,
    );
  });

  const result = await callTelegram(botToken, "sendMediaGroup", form, {
    msRemaining,
  });

  const messages = Array.isArray(result) ? result : [];
  const messageIds = messages
    .map((m: { message_id?: number }) => m?.message_id)
    .filter((id): id is number => typeof id === "number");

  // These ids are the only handle on what was published: without them a wrong
  // album cannot be found and deleted. A short count means the album posted but
  // we cannot fully account for it, which is in doubt rather than failed.
  if (messageIds.length !== photos.length) {
    throw new TelegramSendError(
      `Telegram accepted the album but returned ${messageIds.length} message ids for ${photos.length} images.`,
      true,
    );
  }

  return { messageIds };
}
