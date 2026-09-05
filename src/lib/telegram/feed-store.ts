/**
 * The admin-client implementation of the listener's store. Thin, like the
 * other stores: one query per method, every decision in feed.ts.
 */

import type { Admin } from "@/lib/telegram/accounts";
import { allowRequest, LIMITS } from "@/lib/rate-limit";
import { canEditTrades } from "@/lib/journals/active-journal";
import type { JournalRole } from "@/types/database";
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

/** Whether any account listens to this chat: the bot then never speaks in it. */
export async function anyFeedIn(admin: Admin, chatId: string): Promise<boolean> {
  const { data } = await admin.from("telegram_feeds").select("id").eq("chat_id", chatId).limit(1);
  return (data ?? []).length > 0;
}

export function feedStore(admin: Admin): FeedStore {
  return {
    feedFor: async (chatId, threadId) => {
      let q = admin.from("telegram_feeds").select("*").eq("chat_id", chatId);
      q = threadId === null ? q.is("thread_id", null) : q.eq("thread_id", threadId);
      const { data } = await q.limit(1).maybeSingle();
      return data ? toFeed(data as Record<string, unknown>) : null;
    },
    mayWrite: async (feed) => {
      const { data, error } = await admin
        .from("journal_members")
        .select("role, journals!inner(is_archived)")
        .eq("journal_id", feed.journalId)
        .eq("user_id", feed.userId)
        .maybeSingle();
      if (error) return null;
      type M = { role: JournalRole; journals: { is_archived: boolean } };
      const m = data as unknown as M | null;
      return !!m && !m.journals.is_archived && canEditTrades(m.role);
    },
    allowWrite: (feed) => allowRequest(admin, LIMITS.telegramFeedWrite, feed.id),
    isKnownSender: async (feed, senderId) => {
      const { data } = await admin
        .from("telegram_feed_messages")
        .select("message_id")
        .eq("feed_id", feed.id)
        .eq("sender_id", senderId)
        .eq("kind", "signal")
        .eq("status", "applied")
        .limit(1);
      return (data ?? []).length > 0;
    },
    seen: async (chatId, messageId) => {
      const { data } = await admin
        .from("telegram_feed_messages")
        .select("kind, status, trade_id, text")
        .eq("chat_id", chatId)
        .eq("message_id", messageId)
        .maybeSingle();
      if (!data) return null;
      return { kind: data.kind as MessageRecord["kind"], status: data.status as MessageRecord["status"], tradeId: (data.trade_id as string | null) ?? null, text: (data.text as string | null) ?? "" };
    },
    record: async (r) => {
      await admin.from("telegram_feed_messages").upsert(
        {
          chat_id: r.chatId, message_id: r.messageId, thread_id: r.threadId, feed_id: r.feedId,
          kind: r.kind, status: r.status, reason: r.reason, trade_id: r.tradeId,
          reply_to_message_id: r.replyToMessageId, sender: r.sender, sender_id: r.senderId,
          text: r.text.slice(0, 4000), posted_at: r.postedAt, edited: r.edited, processed_at: new Date().toISOString(),
        },
        { onConflict: "chat_id,message_id" },
      );
    },
    tradeByMessage: async (feed, messageId) => {
      const { data } = await admin
        .from("trades")
        .select("*")
        .eq("telegram_chat_id", feed.chatId)
        .eq("telegram_message_id", messageId)
        .eq("journal_id", feed.journalId)
        .eq("user_id", feed.userId)
        .maybeSingle();
      return (data as TradeRow | null) ?? null;
    },
    tradeById: async (feed, id) => {
      const { data } = await admin
        .from("trades")
        .select("*")
        .eq("id", id)
        .eq("journal_id", feed.journalId)
        .eq("user_id", feed.userId)
        .maybeSingle();
      return (data as TradeRow | null) ?? null;
    },
    recentTrades: async (feed, instrument, since, until, limit) => {
      let q = admin
        .from("trades")
        .select("*")
        .eq("journal_id", feed.journalId)
        .eq("user_id", feed.userId)
        .eq("source", "telegram")
        .gte("entry_time", since)
        .lte("entry_time", until)
        .order("entry_time", { ascending: false })
        .limit(limit);
      if (instrument) q = q.eq("instrument", instrument);
      const { data } = await q;
      return (data ?? []) as TradeRow[];
    },
    insertTrade: async (row) => {
      const { data, error } = await admin.from("trades").insert(row).select("id").single();
      if (error) {
        if (error.code === "23505" && /telegram_message/.test(error.message)) return { duplicate: true };
        console.error("[telegram/feed] insert failed", { message: error.message, code: error.code });
        return { error: error.message };
      }
      return { id: data.id as string };
    },
    updateTrade: async (feed, id, patch) => {
      const { error } = await admin.from("trades").update(patch).eq("id", id).eq("journal_id", feed.journalId).eq("user_id", feed.userId);
      if (error) console.error("[telegram/feed] update failed", { id, message: error.message });
      return !error;
    },
  };
}
