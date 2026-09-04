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
  PENDING_TTL_MINUTES,
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
  /**
   * MERGE the patch into the stored conversation (answers one level deep)
   * and extend the draft's life to `expiresAt`. False when the draft is
   * gone or already finished, which the caller must say rather than show a
   * picker that can never be tapped.
   */
  saveConversation(id: string, patch: Conversation, expiresAt: string): Promise<boolean>;
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
  /** The draft cannot continue; the caller drops it. */
  readonly dropped?: boolean;
}

export const COULD_NOT_HOLD = "Couldn't hold that answer. Send it again.";

export function lifeFrom(now: Date): string {
  return new Date(now.getTime() + PENDING_TTL_MINUTES * 60_000).toISOString();
}

/**
 * Ask the next question, or, when nothing is left to ask, show the summary
 * and the journal picker. The picker is built from the journal ids stored
 * with the draft so the indexes on its buttons stay true; a journal lost
 * since then simply has no button, and a draft with no journal left is
 * dropped rather than shown as ready.
 */
export async function advance(store: FlowStore, d: OpenDraft, now: Date): Promise<FlowReply> {
  const quick = await store.isQuick(d.telegramUserId);
  const stage = nextStage(d.draft, d.conversation, quick);
  const expiresAt = lifeFrom(now);

  if (stage === "size") {
    // Not asked when this person has a size for the instrument already: the
    // last one is used and said, and "size 1" changes it.
    const recent = await store.recentLots(d.userId, d.draft.instrument);
    if (recent.length > 0) {
      const conversation: Conversation = {
        ...d.conversation,
        answers: { ...d.conversation.answers, lots: recent[0] },
        sized_from_history: true,
      };
      if (!(await store.saveConversation(d.id, { answers: { lots: recent[0] }, sized_from_history: true }, expiresAt))) {
        return { text: COULD_NOT_HOLD };
      }
      return advance(store, { ...d, conversation }, now);
    }
  }

  if (stage !== "journal") {
    const ctx = {
      recentLots: [] as readonly number[],
      topTags: stage === "tags" ? await store.topTags(d.userId) : [],
      tpPrices: [d.draft.tp1, d.draft.tp2, d.draft.tp3, d.draft.tp4, d.draft.tp5, d.draft.tp6, d.draft.tp7],
    };
    const { prompt, conversation } = promptFor(stage, d.id, d.conversation, ctx);
    // Only what this prompt offered is written; the answers travel separately.
    const patch: Conversation = {
      answers: {},
      ...(conversation.offeredLots ? { offeredLots: conversation.offeredLots } : {}),
      ...(conversation.offeredTags ? { offeredTags: conversation.offeredTags } : {}),
    };
    if (!(await store.saveConversation(d.id, patch, expiresAt))) return { text: COULD_NOT_HOLD };
    return { text: prompt.text, buttons: prompt.buttons, perRow: prompt.perRow };
  }

  const known = await store.editableJournals(d.userId);
  const buttons: InlineButton[] = [];
  d.journalIds.forEach((id, i) => {
    const j = known.find((k) => k.id === id);
    if (j) buttons.push({ text: j.name, callback_data: encodeTrade(d.id, i) });
  });
  if (buttons.length === 0) {
    return {
      text: "Your account can't write to any journal any more, so that trade has nowhere to go.",
      dropped: true,
    };
  }
  buttons.push({ text: "Cancel", callback_data: encodeTrade(d.id, null) });

  if (!(await store.saveConversation(d.id, { answers: {}, ready: true }, expiresAt))) {
    return { text: COULD_NOT_HOLD };
  }

  const openNote = draftIsClosed(d.draft)
    ? ""
    : "\n<i>Still open, so it won't appear on a poster until it's closed.</i>";
  return {
    text:
      `${escapeHtml(describeConversation(d.draft, d.conversation.answers, d.conversation))}${openNote}` +
      `\n\nWhich journal? (To change something first, type e.g. "size 0.5" or "date 28 aug".)`,
    buttons,
    perRow: 1,
  };
}

/** One message for "no such draft", "expired" and "somebody else's". */
export const NOT_YOURS = "That one isn't yours or has expired. Send the trade again.";

/**
 * Why a tap on a draft is refused, or null when it may proceed.
 *
 * The tapper must be the author, the tap must come from the chat the draft
 * was shown in (a forwarded picker satisfies neither for anyone else), and
 * the account link must still stand: unlinking is a revocation. A draft that
 * does not exist and a draft that belongs to someone else get the same
 * answer, so a crafted tap learns nothing about which ids exist.
 */
export function refuseTap(
  d: { readonly telegramUserId: number; readonly chatId: string; readonly userId: string; readonly expiresAt: string } | null,
  tap: { readonly tapperId: number; readonly chatId: string },
  linkedUserId: string | null,
  now: Date,
): string | null {
  if (!d || new Date(d.expiresAt).getTime() <= now.getTime() || d.telegramUserId !== tap.tapperId) {
    return NOT_YOURS;
  }
  if (d.chatId !== tap.chatId) return "Use the picker in your own chat with me.";
  if (!linkedUserId || linkedUserId !== d.userId) return "Your account is no longer linked.";
  return null;
}
