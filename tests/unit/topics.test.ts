import { describe, expect, it } from "vitest";
import { topicOf } from "@/lib/telegram/topics";

describe("topicOf", () => {
  it("reads the thread id and the name from the topic's creation message", () => {
    expect(
      topicOf({
        chat: { type: "supergroup" },
        message_thread_id: 42,
        is_topic_message: true,
        text: "🔵BUY  XAUUSD\nENTRY: 4374",
        reply_to_message: { message_thread_id: 42, forum_topic_created: { name: "Gold scalp" } },
      }),
    ).toEqual({ threadId: 42, name: "Gold scalp", sample: "🔵BUY XAUUSD ENTRY: 4374" });
  });

  it("keeps a sample when the name did not travel (a reply inside the topic)", () => {
    expect(
      topicOf({ chat: { type: "supergroup" }, message_thread_id: 42, text: "TP1 HIT +10 pips" }),
    ).toEqual({ threadId: 42, name: null, sample: "TP1 HIT +10 pips" });
  });

  it("is null outside a topic or outside a supergroup", () => {
    expect(topicOf({ chat: { type: "supergroup" }, text: "hello" })).toBeNull();
    expect(topicOf({ chat: { type: "private" }, message_thread_id: 42, text: "hello" })).toBeNull();
  });

  it("bounds the sample and reads a caption", () => {
    const r = topicOf({ chat: { type: "supergroup" }, message_thread_id: 7, caption: "x".repeat(200) });
    expect(r?.sample?.length).toBe(80);
  });
});
