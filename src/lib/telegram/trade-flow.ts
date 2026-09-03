/**
 * What the DM handler and the answer handler share: deciding whether to ask
 * the next question or show the journal picker, and checking that a tap on
 * a draft comes from the person the draft belongs to.
 *
 * Pure over a store interface, like its callers.
 */

import { encodeTrade } from "@/lib/telegram/commands";
import { draftIsClosed, type TradeDraft } from "@/lib/telegram/trade-intent";
import {
  nextStage,
  promptFor,
  describeConversation,
  type Conversation,
} from "@/lib/telegram/conversation";
import { escapeHtml } from "@/lib/reports/caption";
import type { InlineButton } from "@/lib/telegram/chat";
import type { JournalChoice } from "@/lib/telegram/accounts";

export interface OpenDraft {
  readonly id: string;
  readonly telegramUserId: number;
  readonly userId: string;
  readonly chatId: string;
  readonly draft: TradeDraft;
  /** The journals offered, in the order the picker's indexes refer to. */
  readonly journalIds: readonly string[];
  readonly conversation: Conversation;
  readonly expiresAt: string;
}

export interface FlowStore {
  editableJournals(userId: string): Promise<readonly JournalChoice[]>;
  saveConversation(id: string, conversation: Conversation): Promise<void>;
  /** Sizes this person used before for this instrument, most recent first, distinct. */
  recentLots(userId: string, instrument: string): Promise<readonly number[]>;
  /** Tags this person uses most. */
  topTags(userId: string): Promise<readonly string[]>;
  /** Whether this person turned the optional questions off with /quick. */
  isQuick(telegramUserId: number): Promise<boolean>;
}

export interface FlowReply {
  readonly text: string;
  readonly buttons?: readonly InlineButton[];
  readonly perRow?: number;
}

/**
 * Ask the next question, or, when nothing is left to ask, show the summary
 * and the journal picker. The picker is built from the journal ids stored
 * with the draft so the indexes on its buttons stay true; a journal lost
 * since then simply has no button.
 */
export async function advance(store: FlowStore, d: OpenDraft, now: Date): Promise<FlowReply> {
  void now;
  const quick = await store.isQuick(d.telegramUserId);
  const stage = nextStage(d.draft, d.conversation, quick);

  if (stage !== "journal") {
    const { prompt, conversation } = await (async () => {
      const ctx = {
        recentLots: stage === "size" ? await store.recentLots(d.userId, d.draft.instrument) : [],
        topTags: stage === "tags" ? await store.topTags(d.userId) : [],
      };
      return promptFor(stage, d.id, d.conversation, ctx);
    })();
    await store.saveConversation(d.id, conversation);
    return { text: prompt.text, buttons: prompt.buttons, perRow: prompt.perRow };
  }

  await store.saveConversation(d.id, { ...d.conversation, ready: true });
  const known = await store.editableJournals(d.userId);
  const buttons: InlineButton[] = [];
  d.journalIds.forEach((id, i) => {
    const j = known.find((k) => k.id === id);
    if (j) buttons.push({ text: j.name, callback_data: encodeTrade(d.id, i) });
  });
  buttons.push({ text: "Cancel", callback_data: encodeTrade(d.id, null) });

  const openNote = draftIsClosed(d.draft)
    ? ""
    : "\n<i>Still open, so it won't appear on a poster until it's closed.</i>";
  return {
    text: `${escapeHtml(describeConversation(d.draft, d.conversation.answers))}${openNote}\n\nWhich journal?`,
    buttons,
    perRow: 1,
  };
}

/**
 * Why a tap on a draft is refused, or null when it may proceed.
 *
 * The tapper must be the author, the tap must come from the chat the draft
 * was shown in (a forwarded picker satisfies neither for anyone else), and
 * the account link must still stand: unlinking is a revocation.
 */
export function refuseTap(
  d: { readonly telegramUserId: number; readonly chatId: string; readonly userId: string; readonly expiresAt: string } | null,
  tap: { readonly tapperId: number; readonly chatId: string },
  linkedUserId: string | null,
  now: Date,
): string | null {
  if (!d || new Date(d.expiresAt).getTime() <= now.getTime()) {
    return "That one has expired. Send the trade again.";
  }
  if (d.telegramUserId !== tap.tapperId) return "That isn't your trade to save.";
  if (d.chatId !== tap.chatId) return "Use the picker in your own chat with me.";
  if (!linkedUserId || linkedUserId !== d.userId) return "Your account is no longer linked.";
  return null;
}
