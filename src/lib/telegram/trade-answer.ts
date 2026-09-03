/**
 * A tapped button on one of the bot's questions about a draft.
 *
 * Verified like a journal tap -- author, chat, link -- then the answer is
 * applied and the next question (or the picker) follows. Pure over the same
 * store interfaces as the DM handler.
 */

import { applyButton, nextStage, type AnswerTap } from "@/lib/telegram/conversation";
import { advance, refuseTap, type FlowStore, type OpenDraft, type FlowReply } from "@/lib/telegram/trade-flow";
import { escapeHtml } from "@/lib/reports/caption";

export interface TradeAnswerStore extends FlowStore {
  /** The draft in whatever state it is in, or null if it never existed. */
  loadOpen(id: string): Promise<(OpenDraft & { readonly consumedAt: string | null }) | null>;
  linkedUser(telegramUserId: number): Promise<string | null>;
}

export interface AnswerResult {
  /** Shown on the button; empty for a plain acknowledgement. */
  readonly answer: string;
  readonly alert: boolean;
  /** Remove the answered question's buttons. */
  readonly clearPicker: boolean;
  readonly reply?: FlowReply;
}

export async function handleTradeAnswer(
  store: TradeAnswerStore,
  tap: AnswerTap & { readonly tapperId: number; readonly chatId: string },
  now: Date,
): Promise<AnswerResult> {
  const d = await store.loadOpen(tap.pendingId);
  const linked = d ? await store.linkedUser(tap.tapperId) : null;
  const why = refuseTap(d, tap, linked, now);
  if (why || !d) return { answer: why ?? "That one has expired.", alert: true, clearPicker: false };
  if (d.consumedAt) return { answer: "That one is finished.", alert: false, clearPicker: true };
  if (d.conversation.ready) {
    return { answer: "Pick a journal with the buttons below.", alert: false, clearPicker: false };
  }

  const quick = await store.isQuick(tap.tapperId);
  const stage = nextStage(d.draft, d.conversation, quick);
  const applied = applyButton(stage, tap, d.conversation, now);
  if (!applied.ok) {
    // A button from a question that has moved on: re-send the open one.
    if (applied.hint === "") {
      return { answer: "", alert: false, clearPicker: true, reply: await advance(store, d, now) };
    }
    return { answer: escapeHtml(applied.hint), alert: true, clearPicker: false };
  }

  await store.saveConversation(d.id, applied.conversation);
  const reply = await advance(store, { ...d, conversation: applied.conversation }, now);
  return { answer: "", alert: false, clearPicker: true, reply };
}
