/**
 * A Telegram update as the listener sees it: one text, one room, one time.
 *
 * Groups deliver `message`, channels deliver `channel_post`, and an edit of
 * either arrives as `edited_message` / `edited_channel_post`. A photo's
 * caption counts as its text. The sender is a person's name in a group, the
 * channel's signature or title in a channel, so the note on the trade says
 * who posted it.
 */

export interface RawChat {
  readonly id?: number;
  readonly type?: string;
  readonly title?: string;
}

export interface RawMessage {
  readonly message_id?: number;
  readonly date?: number;
  readonly text?: string;
  readonly caption?: string;
  readonly chat?: RawChat;
  readonly from?: { readonly id?: number; readonly first_name?: string; readonly last_name?: string };
  readonly sender_chat?: RawChat;
  readonly author_signature?: string;
  readonly message_thread_id?: number;
  readonly reply_to_message?: { readonly message_id?: number; readonly forum_topic_created?: unknown };
}

export interface RawUpdate {
  readonly message?: RawMessage;
  readonly edited_message?: RawMessage;
  readonly channel_post?: RawMessage;
  readonly edited_channel_post?: RawMessage;
}

export interface FeedMessageInput {
  readonly chatId: string;
  readonly chatType: string;
  readonly messageId: number;
  readonly threadId: number | null;
  readonly replyToMessageId: number | null;
  readonly text: string;
  readonly sender: string | null;
  readonly postedAt: string;
  readonly edited: boolean;
}

const ROOM_TYPES = new Set(["group", "supergroup", "channel"]);

/** The room message in an update, or null when the update is not one. */
export function feedMessageFromUpdate(update: RawUpdate): FeedMessageInput | null {
  const [msg, edited] =
    update.message ? [update.message, false]
    : update.channel_post ? [update.channel_post, false]
    : update.edited_message ? [update.edited_message, true]
    : update.edited_channel_post ? [update.edited_channel_post, true]
    : [null, false];
  if (!msg?.chat?.id || !msg.message_id || !msg.chat.type || !ROOM_TYPES.has(msg.chat.type)) return null;

  // A reply to the topic's own creation message is not a reply to a trade.
  const reply = msg.reply_to_message;
  const replyToMessageId = reply?.message_id && !reply.forum_topic_created ? reply.message_id : null;

  const person = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").trim();
  // A channel post is signed by the channel itself when nothing else is.
  const sender =
    person || msg.author_signature || msg.sender_chat?.title || (msg.chat.type === "channel" ? msg.chat.title ?? null : null);

  return {
    chatId: String(msg.chat.id),
    chatType: msg.chat.type,
    messageId: msg.message_id,
    threadId: msg.message_thread_id ?? null,
    replyToMessageId,
    text: (msg.text ?? msg.caption ?? "").trim(),
    sender,
    postedAt: new Date((msg.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    edited,
  };
}
