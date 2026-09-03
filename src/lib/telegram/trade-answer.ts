/**
 * A tapped button on one of the bot's questions about a draft.
 *
 * Behind the sender's allowance, then verified like a journal tap -- author,
 * chat, link -- then the answer is applied and the next question (or the
 * picker) follows. Pure over the same store interfaces as the DM handler.
 */

import { applyButton, nextStage, type AnswerTap } from "@/lib/telegram/conversation";
import { advance, refuseTap, lifeFrom, type FlowStore, type OpenDraft, type FlowReply } from "@/lib/telegram/trade-flow";

/** Telegram's cap on the text of an answerCallbackQuery. */
const CALLBACK_TEXT_MAX = 200;

export interface TradeAnswerStore extends FlowStore {
  allow(telegramUserId: number): Promise<boolean>;
  /** The draft in whatever state it is in, or null if it never existed. */
  loadOpen(id: string): Promise<(OpenDraft & { readonly consumedAt: string | null }) | null>;
  linkedUser(telegramUserId: number): Promise<string | null>;
  cancelDraft(id: string): Promise<void>;
}

export interface AnswerResult {
  /** Shown on the button, plain text; empty for a plain acknowledgement. */
  readonly answer: string;
  readonly alert: boolean;
  /** Remove the answered question's buttons. */
  readonly clearPicker: boolean;
  readonly reply?: FlowReply;
}

const quiet: AnswerResult = { answer: "", alert: false, clearPicker: false };

export async function handleTradeAnswer(
  store: TradeAnswerStore,
  tap: AnswerTap & { readonly tapperId: number; readonly chatId: string },
  now: Date,
): Promise<AnswerResult> {
  if (!(await store.allow(tap.tapperId))) return quiet;

  const d = await store.loadOpen(tap.pendingId);
  const linked = d ? await store.linkedUser(tap.tapperId) : null;
  const why = refuseTap(d, tap, linked, now);
  if (why || !d) return { answer: why ?? "", alert: true, clearPicker: false };
  if (d.consumedAt) return { answer: "That one is finished.", alert: false, clearPicker: true };
  if (d.conversation.ready) {
    return { answer: "Pick a journal with the buttons on my last message.", alert: false, clearPicker: false };
  }

  const quick = await store.isQuick(tap.tapperId);
  const stage = nextStage(d.draft, d.conversation, quick);
  const applied = applyButton(stage, tap, d.conversation, now);
  if (!applied.ok) {
    if (applied.cancel) {
      await store.cancelDraft(d.id);
      return {
        answer: "Cancelled.",
        alert: false,
        clearPicker: true,
        reply: { text: "Cancelled. Send it again with what I got wrong." },
      };
    }
    // A button from a question that has moved on: re-send the open one.
    if (applied.hint === "") {
      const reply = await advance(store, d, now);
      if (reply.dropped) await store.cancelDraft(d.id);
      return { answer: "", alert: false, clearPicker: true, reply };
    }
    return { answer: applied.hint.slice(0, CALLBACK_TEXT_MAX), alert: true, clearPicker: false };
  }

  const patch = {
    answers: applied.conversation.answers,
    ...(applied.conversation.confirmed ? { confirmed: true } : {}),
  };
  if (!(await store.saveConversation(d.id, patch, lifeFrom(now)))) {
    return { answer: "Couldn't hold that answer. Tap again.", alert: true, clearPicker: false };
  }
  const reply = await advance(store, { ...d, conversation: applied.conversation }, now);
  if (reply.dropped) await store.cancelDraft(d.id);
  return { answer: "", alert: false, clearPicker: true, reply };
}
