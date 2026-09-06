/**
 * What the bot says in private when a room gave it something it could not
 * use. The room itself never hears a word; the people who keep the journal
 * do, in their own chat with the bot: everyone who can write to the feed's
 * journal and has linked their Telegram account, the owner included.
 */

import type { Admin } from "@/lib/telegram/accounts";
import { sendChatMessage } from "@/lib/telegram/chat";
import { allowRequest, LIMITS } from "@/lib/rate-limit";
import { canEditTrades } from "@/lib/journals/active-journal";
import { escapeHtml } from "@/lib/reports/caption";
import type { JournalRole } from "@/types/database";

const EXCERPT_LENGTH = 280;

export interface ReviewNoticeInput {
  readonly room: string;
  readonly journal: string;
  readonly sender: string | null;
  readonly text: string;
  readonly reason: string;
  readonly appUrl: string;
}

/** The private note about a room message kept for a person. HTML for Telegram. */
export function reviewNotice(n: ReviewNoticeInput): string {
  const excerpt = n.text.length > EXCERPT_LENGTH ? `${n.text.slice(0, EXCERPT_LENGTH)}…` : n.text;
  return [
    `👀 <b>${escapeHtml(n.room)}</b> → ${escapeHtml(n.journal)}: needs a look`,
    `${n.sender ? `<i>${escapeHtml(n.sender)}</i>: ` : ""}${escapeHtml(excerpt)}`,
    "",
    `Why: ${escapeHtml(n.reason)}`,
    `Retry or ignore it on the Posters page: ${n.appUrl}/posters`,
  ].join("\n");
}

export interface ModelReadNoticeInput {
  readonly room: string;
  readonly journal: string;
  readonly sender: string | null;
  readonly text: string;
  readonly summary: string;
  readonly appUrl: string;
}

/** The private note about a signal the rules could not read and the model did. */
export function modelReadNotice(n: ModelReadNoticeInput): string {
  const excerpt = n.text.length > EXCERPT_LENGTH ? `${n.text.slice(0, EXCERPT_LENGTH)}…` : n.text;
  return [
    `🤖 <b>${escapeHtml(n.room)}</b> → ${escapeHtml(n.journal)}: logged by the model, please check`,
    `${n.sender ? `<i>${escapeHtml(n.sender)}</i>: ` : ""}${escapeHtml(excerpt)}`,
    "",
    `Read as: ${escapeHtml(n.summary)}`,
    `The template was new to the rules. If the reading is wrong, fix the trade in the journal: ${n.appUrl}/journal`,
  ].join("\n");
}

/** Telegram user ids to tell about this feed's journal. */
export async function recipientsForFeed(admin: Admin, feed: { readonly journalId: string; readonly userId: string }): Promise<readonly number[]> {
  const { data: members } = await admin.from("journal_members").select("user_id, role").eq("journal_id", feed.journalId);
  const userIds = new Set<string>([feed.userId]);
  for (const m of (members ?? []) as { user_id: string; role: JournalRole }[]) {
    if (canEditTrades(m.role)) userIds.add(m.user_id);
  }
  const { data: accounts } = await admin.from("telegram_accounts").select("telegram_user_id").in("user_id", [...userIds]);
  return ((accounts ?? []) as { telegram_user_id: number }[]).map((a) => Number(a.telegram_user_id));
}

interface FeedPeople { readonly room: string; readonly journal: string; readonly journalId: string; readonly userId: string }

async function feedPeople(admin: Admin, feedId: string): Promise<FeedPeople | null> {
  const { data } = await admin
    .from("telegram_feeds")
    .select("title, chat_id, journal_id, user_id, journals!inner(name)")
    .eq("id", feedId)
    .maybeSingle();
  if (!data) return null;
  type Row = { title: string | null; chat_id: string; journal_id: string; user_id: string; journals: { name: string } };
  const f = data as unknown as Row;
  return { room: f.title ?? f.chat_id, journal: f.journals.name, journalId: f.journal_id, userId: f.user_id };
}

/**
 * Tell the journal's people, privately. Best effort and bounded per feed,
 * so a room in a bad mood cannot turn into a hundred private messages an
 * hour; a missed note is an item still on the Posters page, a thrown one
 * would fail the webhook and lose the message entirely.
 */
async function tellFeedPeople(admin: Admin, botToken: string, feedId: string, limit: (typeof LIMITS)[keyof typeof LIMITS], compose: (f: FeedPeople) => string): Promise<void> {
  try {
    const f = await feedPeople(admin, feedId);
    if (!f) return;
    if (!(await allowRequest(admin, limit, feedId))) return;
    const text = compose(f);
    const people = await recipientsForFeed(admin, f);
    await Promise.all(people.map((id) => sendChatMessage(botToken, String(id), text)));
  } catch (err: unknown) {
    console.error("[telegram/notify] failed", { feedId, message: err instanceof Error ? err.message : String(err) });
  }
}

/** A room message kept for review. */
export function notifyReview(admin: Admin, botToken: string, appUrl: string, feedId: string, msg: { readonly sender: string | null; readonly text: string }, reason: string): Promise<void> {
  return tellFeedPeople(admin, botToken, feedId, LIMITS.telegramFeedNotify, (f) => reviewNotice({ room: f.room, journal: f.journal, sender: msg.sender, text: msg.text, reason, appUrl }));
}

/** A signal the rules could not read and the model logged. */
export function notifyModelRead(admin: Admin, botToken: string, appUrl: string, feedId: string, msg: { readonly sender: string | null; readonly text: string }, summary: string): Promise<void> {
  return tellFeedPeople(admin, botToken, feedId, LIMITS.telegramFeedModelNotify, (f) => modelReadNotice({ room: f.room, journal: f.journal, sender: msg.sender, text: msg.text, summary, appUrl }));
}
