/**
 * The admin-client implementation of the listener's store. Thin, like the
 * other stores: one query per method, every decision in feed.ts.
 */

import type { Admin } from "@/lib/telegram/accounts";
import type { Feed, FeedStore, MessageRecord, TradeRow } from "@/lib/telegram/feed";

function toFeed(r: Record<string, unknown>): Feed {
  return {
    id: r.id as string,
    chatId: r.chat_id as string,
    threadId: (r.thread_id as number | null) ?? null,
    journalId: r.journal_id as string,
    userId: r.user_id as string,
    defaultLots: Number(r.default_lots),
    enabled: r.enabled === true,
    react: r.react === true,
  };
}

export function feedStore(admin: Admin): FeedStore {
  return {
    feedFor: async (chatId, threadId) => {
      let q = admin.from("telegram_feeds").select("*").eq("chat_id", chatId);
      q = threadId === null ? q.is("thread_id", null) : q.eq("thread_id", threadId);
      const { data } = await q.maybeSingle();
      return data ? toFeed(data as Record<string, unknown>) : null;
    },
    seen: async (chatId, messageId) => {
      const { data } = await admin
        .from("telegram_feed_messages")
        .select("kind, status, trade_id")
        .eq("chat_id", chatId)
        .eq("message_id", messageId)
        .maybeSingle();
      if (!data) return null;
      return { kind: data.kind as MessageRecord["kind"], status: data.status as MessageRecord["status"], tradeId: (data.trade_id as string | null) ?? null };
    },
    record: async (r) => {
      await admin.from("telegram_feed_messages").upsert(
        {
          chat_id: r.chatId, message_id: r.messageId, thread_id: r.threadId, feed_id: r.feedId,
          kind: r.kind, status: r.status, reason: r.reason, trade_id: r.tradeId,
          reply_to_message_id: r.replyToMessageId, sender: r.sender, text: r.text.slice(0, 4000),
          posted_at: r.postedAt, edited: r.edited, processed_at: new Date().toISOString(),
        },
        { onConflict: "chat_id,message_id" },
      );
    },
    tradeByMessage: async (chatId, messageId) => {
      const { data } = await admin
        .from("trades")
        .select("*")
        .eq("telegram_chat_id", chatId)
        .eq("telegram_message_id", messageId)
        .maybeSingle();
      return (data as TradeRow | null) ?? null;
    },
    tradeById: async (id) => {
      const { data } = await admin.from("trades").select("*").eq("id", id).maybeSingle();
      return (data as TradeRow | null) ?? null;
    },
    latestOpenTrade: async (journalId, instrument, since) => {
      let q = admin
        .from("trades")
        .select("*")
        .eq("journal_id", journalId)
        .eq("source", "telegram")
        .gte("entry_time", since)
        .is("exit_price", null)
        .is("tp1_result", null)
        .order("entry_time", { ascending: false })
        .limit(1);
      if (instrument) q = q.eq("instrument", instrument);
      const { data } = await q.maybeSingle();
      return (data as TradeRow | null) ?? null;
    },
    insertTrade: async (row) => {
      const { data, error } = await admin.from("trades").insert(row).select("id").single();
      if (error) {
        if (error.code === "23505" && /telegram_message/.test(error.message)) return { duplicate: true };
        console.error("[telegram/feed] insert failed", { message: error.message, code: error.code, details: error.details });
        return { error: error.message };
      }
      return { id: data.id as string };
    },
    updateTrade: async (id, patch) => {
      const { error } = await admin.from("trades").update(patch).eq("id", id);
      if (error) console.error("[telegram/feed] update failed", { id, message: error.message });
      return !error;
    },
  };
}
