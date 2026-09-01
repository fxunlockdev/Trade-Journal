interface TelegramSendResponse {
  readonly ok: boolean;
  readonly message_id?: number;
}

interface TelegramEditResponse {
  readonly ok: boolean;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<TelegramSendResponse> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram sendMessage failed: ${data.description ?? "Unknown error"}`,
    );
  }

  return {
    ok: true,
    message_id: data.result?.message_id,
  };
}

export async function editTelegramMessage(
  botToken: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<TelegramEditResponse> {
  const url = `https://api.telegram.org/bot${botToken}/editMessageText`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram editMessageText failed: ${data.description ?? "Unknown error"}`,
    );
  }

  return { ok: true };
}

/* ────────────────────────── discovery ────────────────────────── */

export interface TelegramChat {
  /** Kept as a STRING: supergroup ids exceed JavaScript's safe integer range. */
  readonly id: string;
  readonly title: string;
  readonly type: "group" | "supergroup" | "channel" | "private";
}

interface RawUpdate {
  readonly message?: { readonly chat?: RawChat };
  readonly channel_post?: { readonly chat?: RawChat };
  readonly my_chat_member?: { readonly chat?: RawChat };
}

interface RawChat {
  readonly id?: number;
  readonly title?: string;
  readonly type?: string;
}

/**
 * Groups the bot has recently seen activity in.
 *
 * Telegram gives a bot no way to list the chats it belongs to; the only route
 * is to read recent updates and collect the chats they came from. That is why
 * connecting requires someone to send a message in the group first — an
 * inconvenience of the platform, not of this design.
 *
 * `getUpdates` is mutually exclusive with a registered webhook: Telegram
 * answers 409 while one is set. This is the connect-time path only, and moves
 * to reading the webhook's own updates once that exists.
 */
export async function listTelegramChats(
  botToken: string,
): Promise<readonly TelegramChat[]> {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates?limit=100&allowed_updates=${encodeURIComponent(
    JSON.stringify(["message", "channel_post", "my_chat_member"]),
  )}`;

  const response = await fetch(url, { cache: "no-store" });
  const data: {
    ok?: boolean;
    description?: string;
    result?: readonly RawUpdate[];
  } = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram getUpdates failed: ${data.description ?? "Unknown error"}`,
    );
  }

  // Deduped by id and ordered newest-first by insertion, so the group someone
  // just posted in appears at the top of the picker.
  const seen = new Map<string, TelegramChat>();
  for (const update of [...(data.result ?? [])].reverse()) {
    const chat =
      update.message?.chat ??
      update.channel_post?.chat ??
      update.my_chat_member?.chat;
    if (!chat?.id || !chat.type) continue;
    // Private chats are the bot's own DMs, never a publishing destination.
    if (chat.type === "private") continue;
    const id = String(chat.id);
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      title: chat.title ?? "Untitled chat",
      type: chat.type as TelegramChat["type"],
    });
  }
  return [...seen.values()];
}
