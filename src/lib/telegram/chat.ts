import "server-only";

/**
 * The Telegram calls the command handler needs.
 *
 * Kept apart from `client.ts` (publishing text) and `media.ts` (publishing
 * images) because this is the INBOUND half: answering taps, checking who is
 * asking, and drawing the desk picker.
 */

interface TelegramEnvelope<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly description?: string;
}

async function call<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await response.json()) as TelegramEnvelope<T>;
    return data.ok ? (data.result ?? null) : null;
  } catch {
    // Every caller here is best-effort feedback to a chat. A failure to draw a
    // button must never take down the request that was going to answer it, and
    // the token lives in the URL so nothing about it is logged.
    return null;
  }
}

/**
 * Is this user an admin of THIS chat?
 *
 * The authorisation question for commands, answered by Telegram rather than by
 * us: group membership is Telegram's to know, and mirroring it into our
 * database would immediately go stale. Anyone can see the images arrive;
 * only admins can cause them to.
 */
export async function getChatMemberStatus(
  botToken: string,
  chatId: string,
  userId: number,
): Promise<string | undefined> {
  const result = await call<{ status?: string }>(botToken, "getChatMember", {
    chat_id: chatId,
    user_id: userId,
  });
  return result?.status;
}

export interface InlineButton {
  readonly text: string;
  readonly callback_data: string;
}

/** A message with one button per row, so long desk names stay readable. */
export async function sendChatMessage(
  botToken: string,
  chatId: string,
  text: string,
  buttons?: readonly InlineButton[],
): Promise<void> {
  await call(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(buttons && buttons.length > 0
      ? { reply_markup: { inline_keyboard: buttons.map((b) => [b]) } }
      : {}),
  });
}

/**
 * Acknowledge a tap.
 *
 * Telegram spins the button until this is called, so it is sent immediately,
 * before any rendering. `show_alert` turns the toast into a dialog, used for
 * refusals so they are not missed.
 */
export async function answerCallback(
  botToken: string,
  callbackId: string,
  text?: string,
  alert = false,
): Promise<void> {
  await call(botToken, "answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text, show_alert: alert } : {}),
  });
}

/**
 * Delete one message the bot posted.
 *
 * Telegram only allows this for about 48 hours, and only for the bot's own
 * messages. Returns whether it went, so a caller can report how much of an
 * album it actually managed to remove rather than claiming all of it.
 *
 * A failure here is ordinary, not exceptional: the message may already be gone,
 * or too old. The caller counts rather than throws.
 */
export async function deleteChatMessage(
  botToken: string,
  chatId: string,
  messageId: number,
): Promise<boolean> {
  const result = await call<boolean>(botToken, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
  return result !== null;
}

/** Replace a message's buttons, so a picker cannot be tapped twice. */
export async function clearButtons(
  botToken: string,
  chatId: string,
  messageId: number,
): Promise<void> {
  await call(botToken, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}
