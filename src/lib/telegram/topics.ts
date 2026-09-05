/**
 * Which forum topic a group message belongs to, and what it is called.
 *
 * In a forum supergroup every message carries `message_thread_id`. The
 * topic's NAME only travels on the service message that created it, which
 * Telegram attaches as `reply_to_message` to top-level messages in the topic;
 * a reply to another message loses it. So the name is taken when present and
 * a short sample of the text is kept otherwise, so a person can still tell
 * the topics apart when mapping them to journals.
 */

export interface TopicMessage {
  readonly message_thread_id?: number;
  readonly is_topic_message?: boolean;
  readonly text?: string;
  readonly caption?: string;
  readonly forum_topic_created?: { readonly name?: string };
  readonly reply_to_message?: {
    readonly message_thread_id?: number;
    readonly forum_topic_created?: { readonly name?: string };
  };
  readonly chat?: { readonly type?: string };
}

export interface SeenTopic {
  readonly threadId: number;
  readonly name: string | null;
  readonly sample: string | null;
}

const SAMPLE_LENGTH = 80;

/** The topic this message was posted in, or null when it was not in one. */
export function topicOf(msg: TopicMessage): SeenTopic | null {
  if (msg.chat?.type !== "supergroup") return null;
  const threadId = msg.message_thread_id ?? msg.reply_to_message?.message_thread_id;
  if (!threadId) return null;
  const name = msg.forum_topic_created?.name ?? msg.reply_to_message?.forum_topic_created?.name ?? null;
  const text = (msg.text ?? msg.caption ?? "").replace(/\s+/g, " ").trim();
  return {
    threadId,
    name: name && name.trim() ? name.trim() : null,
    sample: text ? text.slice(0, SAMPLE_LENGTH) : null,
  };
}
