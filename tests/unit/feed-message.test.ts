import { describe, expect, it } from "vitest";
import { feedMessageFromUpdate } from "@/lib/telegram/feed-message";

describe("feedMessageFromUpdate", () => {
  const chat = { id: -100999, type: "supergroup", title: "The Trading Circle" };

  it("reads a group message with its topic, reply, sender and time", () => {
    const r = feedMessageFromUpdate({
      message: {
        message_id: 23, date: 1756994400, chat, text: "🎯 TP1 HIT +10 pips",
        from: { id: 1, first_name: "Yohan", last_name: "Morel" },
        message_thread_id: 42, reply_to_message: { message_id: 21 },
      },
    });
    expect(r).toEqual({
      chatId: "-100999", chatType: "supergroup", messageId: 23, threadId: 42, replyToMessageId: 21,
      text: "🎯 TP1 HIT +10 pips", sender: "Yohan Morel", postedAt: "2025-09-04T14:00:00.000Z", edited: false,
    });
  });

  it("reads a channel post with its signature, and a caption as text", () => {
    const r = feedMessageFromUpdate({
      channel_post: { message_id: 6065, date: 1756994400, chat: { id: -100555, type: "channel", title: "TIG master channel" }, caption: "🔵BUY  XAUUSD\nENTRY: 4374", author_signature: "TIG" },
    });
    expect(r).toMatchObject({ chatType: "channel", sender: "TIG", text: "🔵BUY  XAUUSD\nENTRY: 4374" });
    const noSig = feedMessageFromUpdate({ channel_post: { message_id: 1, date: 1, chat: { id: -100555, type: "channel", title: "TIG master channel" }, text: "x" } });
    expect(noSig?.sender).toBe("TIG master channel");
  });

  it("marks edits and does not treat the topic's creation message as a reply", () => {
    const r = feedMessageFromUpdate({
      edited_message: { message_id: 5, date: 1, chat, text: "y", message_thread_id: 42, reply_to_message: { message_id: 42, forum_topic_created: { name: "Gold" } } },
    });
    expect(r).toMatchObject({ edited: true, replyToMessageId: null, threadId: 42 });
  });

  it("is null for private chats and for updates without a room message", () => {
    expect(feedMessageFromUpdate({ message: { message_id: 1, date: 1, chat: { id: 5, type: "private" }, text: "hi" } })).toBeNull();
    expect(feedMessageFromUpdate({})).toBeNull();
  });
});
