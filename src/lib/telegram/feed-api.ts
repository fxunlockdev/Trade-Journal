/**
 * What the Posters page needs to manage signal rooms: the rooms this person
 * has proven they are in, the topics seen in them, and their feeds. Shared by
 * the feeds routes so the ownership rules are written once.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { canEditTrades } from "@/lib/journals/active-journal";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JournalRole } from "@/types/database";

export interface SourceTopic {
  readonly threadId: number;
  readonly name: string | null;
  readonly sample: string | null;
  readonly messageCount: number;
}

export interface Source {
  readonly chatId: string;
  readonly chatType: string;
  readonly title: string;
  readonly topics: readonly SourceTopic[];
}

export interface FeedView {
  readonly id: string;
  readonly chatId: string;
  readonly threadId: number | null;
  readonly title: string | null;
  readonly journalId: string;
  readonly defaultLots: number;
  readonly enabled: boolean;
  readonly connectedAt: string;
  readonly counts: { readonly applied: number; readonly review: number };
}

/** Rooms this person has posted a claim code in, with the topics seen there. */
export async function sourcesFor(supabase: SupabaseClient, userId: string): Promise<Source[]> {
  // RLS-scoped: only this person's claims.
  const { data: claims } = await supabase
    .from("telegram_chat_claims")
    .select("chat_id, chat_title")
    .eq("user_id", userId)
    .eq("purpose", "feed")
    .not("chat_id", "is", null)
    .not("claimed_at", "is", null);
  const chatIds = [...new Set((claims ?? []).map((c) => c.chat_id as string))];
  if (chatIds.length === 0) return [];

  const admin = createAdminClient();
  const [{ data: chats }, { data: topics }] = await Promise.all([
    admin.from("telegram_seen_chats").select("chat_id, title, chat_type").in("chat_id", chatIds),
    admin.from("telegram_seen_topics").select("chat_id, thread_id, name, sample, message_count").in("chat_id", chatIds).order("last_seen_at", { ascending: false }),
  ]);
  const titleByChat = new Map((claims ?? []).map((c) => [c.chat_id as string, (c.chat_title as string | null) ?? null]));
  return chatIds.map((chatId) => {
    const seen = (chats ?? []).find((c) => c.chat_id === chatId);
    return {
      chatId,
      chatType: (seen?.chat_type as string | undefined) ?? "group",
      title: (seen?.title as string | null) ?? titleByChat.get(chatId) ?? "Untitled room",
      topics: (topics ?? [])
        .filter((t) => t.chat_id === chatId)
        .map((t) => ({ threadId: Number(t.thread_id), name: (t.name as string | null) ?? null, sample: (t.sample as string | null) ?? null, messageCount: Number(t.message_count ?? 0) })),
    };
  });
}

/** Whether this person may write trades into the journal. */
export async function mayWriteJournal(supabase: SupabaseClient, userId: string, journalId: string): Promise<boolean> {
  const { data } = await supabase
    .from("journal_members")
    .select("role")
    .eq("journal_id", journalId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? canEditTrades(data.role as JournalRole) : false;
}

export async function feedsFor(supabase: SupabaseClient, userId: string): Promise<FeedView[]> {
  const { data: feeds } = await supabase
    .from("telegram_feeds")
    .select("id, chat_id, thread_id, title, journal_id, default_lots, enabled, connected_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (!feeds || feeds.length === 0) return [];
  const admin = createAdminClient();
  const { data: msgs } = await admin
    .from("telegram_feed_messages")
    .select("feed_id, status")
    .in("feed_id", feeds.map((f) => f.id as string))
    .in("status", ["applied", "review"]);
  return feeds.map((f) => ({
    id: f.id as string,
    chatId: f.chat_id as string,
    threadId: (f.thread_id as number | null) ?? null,
    title: (f.title as string | null) ?? null,
    journalId: f.journal_id as string,
    defaultLots: Number(f.default_lots),
    enabled: f.enabled === true,
    connectedAt: f.connected_at as string,
    counts: {
      applied: (msgs ?? []).filter((m) => m.feed_id === f.id && m.status === "applied").length,
      review: (msgs ?? []).filter((m) => m.feed_id === f.id && m.status === "review").length,
    },
  }));
}
