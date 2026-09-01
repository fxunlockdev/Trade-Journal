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
export interface ChatDiscovery {
  readonly chats: readonly TelegramChat[];
  /** Raw updates Telegram had queued. Zero is the diagnostic that matters. */
  readonly updatesSeen: number;
  /** Update types present, so "only my_chat_member" is distinguishable. */
  readonly updateKinds: readonly string[];
  /** Private chats dropped. Non-zero with no groups means DMs only. */
  readonly privateSkipped: number;
}

export async function listTelegramChats(
  botToken: string,
): Promise<ChatDiscovery> {
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

  const updates = data.result ?? [];

  // Deduped by id and ordered newest-first by insertion, so the group someone
  // just posted in appears at the top of the picker.
  const seen = new Map<string, TelegramChat>();
  const kinds = new Set<string>();
  let privateSkipped = 0;

  for (const update of [...updates].reverse()) {
    if (update.message) kinds.add("message");
    if (update.channel_post) kinds.add("channel_post");
    if (update.my_chat_member) kinds.add("my_chat_member");

    const chat =
      update.message?.chat ??
      update.channel_post?.chat ??
      update.my_chat_member?.chat;
    if (!chat?.id || !chat.type) continue;
    // Private chats are the bot's own DMs, never a publishing destination.
    if (chat.type === "private") {
      privateSkipped++;
      continue;
    }
    const id = String(chat.id);
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      title: chat.title ?? "Untitled chat",
      type: chat.type as TelegramChat["type"],
    });
  }

  return {
    chats: [...seen.values()],
    updatesSeen: updates.length,
    updateKinds: [...kinds],
    privateSkipped,
  };
}

/**
 * Why discovery found nothing, in words the user can act on.
 *
 * The previous message asserted a single cause ("add the bot to a group, post a
 * message") which is only sometimes right, and unhelpful when it is not. These
 * three cases have genuinely different fixes, and the counts distinguish them.
 */
export function explainNoChats(d: ChatDiscovery): string {
  if (d.updatesSeen === 0) {
    return (
      "Telegram has nothing queued for this bot. Most likely privacy mode is " +
      "still on: in @BotFather send /setprivacy, pick this bot, choose Disable, " +
      "then post in the group again. (A bot with privacy on cannot see ordinary " +
      "group messages.)"
    );
  }
  if (d.privateSkipped > 0 && d.chats.length === 0) {
    return (
      `Only direct messages found (${d.privateSkipped}). A DM with the bot is ` +
      "not a publishing destination. Post in the GROUP, not in the chat with " +
      "the bot."
    );
  }
  return (
    `Saw ${d.updatesSeen} update(s) [${d.updateKinds.join(", ") || "none"}] but ` +
    "no group among them. Post a message in the group and try again."
  );
}
