/**
 * A message typed in a private chat with the bot.
 *
 * Either the start of a trade, an answer to the question the bot last asked
 * about one, a change to an earlier answer ("date 28 aug"), a correction to
 * the trade itself ("sl", "closed 1.0820"), or a command. Pure over a small
 * store interface, so every branch is a unit test rather than a production
 * incident. The route implements the store over the admin client.
 */

import { parseCommand } from "@/lib/telegram/commands";
import { parseTradeIntent, type TradeIntent, type TradeDraft } from "@/lib/telegram/trade-intent";
import { looksLikeProseTrade, readExtraction } from "@/lib/telegram/prose";
import type { Answers } from "@/lib/telegram/conversation";
import { parseOutcome } from "@/lib/trades/outcome-parser";
import {
  applyText,
  nextStage,
  parseFieldEdit,
  describeConversation,
  EMPTY_CONVERSATION,
  PENDING_TTL_MINUTES,
  type Conversation,
} from "@/lib/telegram/conversation";
import { advance, lifeFrom, type FlowStore, type OpenDraft, type FlowReply } from "@/lib/telegram/trade-flow";
import { escapeHtml } from "@/lib/reports/caption";

export { PENDING_TTL_MINUTES };

export interface DraftToHold {
  readonly id: string;
  readonly telegramUserId: number;
  readonly userId: string;
  readonly chatId: string;
  readonly draft: TradeDraft;
  readonly journalIds: readonly string[];
  readonly conversation: Conversation;
  readonly expiresAt: string;
}

export interface TradeDmStore extends FlowStore {
  /** Within this sender's allowance. Keyed on the Telegram user, never the text. */
  allow(telegramUserId: number): Promise<boolean>;
  linkedUser(telegramUserId: number): Promise<string | null>;
  newPendingId(): string;
  /** False when the draft could not be stored (including a second open draft). */
  holdDraft(draft: DraftToHold): Promise<boolean>;
  /** This person's unfinished draft, expired or not, ready or not. */
  openDraft(telegramUserId: number): Promise<OpenDraft | null>;
  cancelDraft(id: string): Promise<void>;
  /** The trade itself changed (an outcome correction). */
  saveDraft(id: string, draft: TradeDraft): Promise<boolean>;
  setQuick(telegramUserId: number, quick: boolean): Promise<void>;
  /**
   * The model's reading of a message written in plain words, or null when
   * the model is unavailable or this person has used their allowance. Absent
   * entirely when prose reading is not configured.
   */
  readProse?(telegramUserId: number, text: string): Promise<unknown | null>;
}

export interface DmMessage {
  readonly text: string;
  readonly telegramUserId: number;
  readonly chatId: string;
}

export type BotReply = FlowReply;

const EXAMPLE = "XAUUSD buy 3340 sl 3335 tp1 3350 closed 3348";
const GREETING_RE = /^(?:hi|hello|hey|yo|start|help|hola)\b[!. ]*$/i;
const LINK_HINT =
  "open <b>Settings → Telegram</b> in the app, get a link code, and send it to me here.";
const EDIT_HINT = 'To change an earlier answer, type e.g. "date 28 aug" or "size 0.5".';

function helpText(linked: boolean, quick: boolean): string {
  const how =
    `Send me a trade, for example:\n<code>${EXAMPLE}</code>\nor just describe it: "bought gold at 3340 this morning, stop 3335, out at 3348".\n\n` +
    `Say what happened: an exit price ("closed 3348"), "tp1 hit", "sl", "be", or "still open". ` +
    `Add a date like "28 aug" for a past trade and "0.5 lots" for the size, or I'll ask. ` +
    (quick
      ? `Quick mode is on, so I only ask for size and date. /quick turns it off.`
      : `I'll also ask how it felt, for tags and for notes; each can be skipped, and /quick turns those three off.`) +
    ` ${EDIT_HINT} /cancel drops the trade I'm asking about.`;
  if (linked) return how;
  return `First, link this chat to your Trade Journal account: ${LINK_HINT}\n\n${how}`;
}

/**
 * The grammar first; the model only for what it could not read and only
 * when the message looks like a trade in words. A model reading that is not
 * a trade falls back to the grammar's own verdict.
 */
async function readTrade(
  store: TradeDmStore,
  telegramUserId: number,
  text: string,
  now: Date,
): Promise<{ intent: TradeIntent; prefill: Answers }> {
  const strict = parseTradeIntent(text, now);
  if (strict.kind === "ready" || !store.readProse || !looksLikeProseTrade(text)) {
    return { intent: strict, prefill: {} };
  }
  const raw = await store.readProse(telegramUserId, text);
  const read = raw === null ? null : readExtraction(raw, text, now);
  return read ?? { intent: strict, prefill: {} };
}

function asOpenDraft(held: DraftToHold): OpenDraft {
  return {
    id: held.id,
    telegramUserId: held.telegramUserId,
    userId: held.userId,
    chatId: held.chatId,
    draft: held.draft,
    journalIds: held.journalIds,
    conversation: held.conversation,
    expiresAt: held.expiresAt,
  };
}

/**
 * A change to the trade's result, typed while a draft is open: "sl", "be",
 * "closed 1.0820", "tp1 hit", "still open". Returns the corrected draft, a
 * reason it cannot be applied, or null when the text is not a result.
 */
function correctOutcome(draft: TradeDraft, text: string): TradeDraft | string | null {
  const outcome = parseOutcome(text);
  // "unknown" is not a correction, whatever the parser's reason: "half a lot"
  // at the size question is an answer, not a partial close.
  if (outcome.kind === "unknown") return null;
  if (outcome.kind === "result" && outcome.result === "hit") {
    const slot = outcome.tpIndex ?? 1;
    const tpPrice = (draft as unknown as Record<string, unknown>)[`tp${slot}`];
    if (tpPrice == null) return `the TP${slot} price is missing, so TP${slot} hit can't be worked out`;
  }
  if (outcome.kind === "result" && outcome.result === "sl" && draft.stop_loss === null) {
    return "the stop loss price is missing, so a stop-out can't be worked out";
  }
  return { ...draft, outcome };
}

async function continueDraft(
  store: TradeDmStore,
  open: OpenDraft,
  now: Date,
  prefix?: string,
): Promise<BotReply> {
  const reply = await advance(store, open, now);
  if (reply.dropped) await store.cancelDraft(open.id);
  return prefix ? { ...reply, text: `${prefix}\n\n${reply.text}` } : reply;
}

/**
 * Reply to a DM, or null to stay silent.
 *
 * Silence is deliberate for anything that is neither a trade nor an answer:
 * "thanks" must not get a parse error, and a stranger who was never linked
 * must not be able to make the bot talk by sending it words. Everything
 * that makes the bot do work sits behind the sender's allowance first.
 */
export async function handleTradeMessage(
  store: TradeDmStore,
  msg: DmMessage,
  now: Date,
): Promise<BotReply | null> {
  const text = msg.text.trim();
  // A sticker, a photo with no caption, a voice note: nothing to read, and
  // not an answer to anything either.
  if (!text) return null;
  const first = text.split(/\s+/)[0]?.toLowerCase() ?? "";
  const isCommand = first.startsWith("/") || GREETING_RE.test(text);
  const strict = isCommand ? null : parseTradeIntent(text, now);
  const mightBeProse = !isCommand && strict?.kind !== "ready" && looksLikeProseTrade(text);

  // Plain chat with nothing waiting on it is not counted at all.
  const open = await store.openDraft(msg.telegramUserId);
  if (!isCommand && strict?.kind === "not_a_trade" && !open && !mightBeProse) return null;

  if (!(await store.allow(msg.telegramUserId))) return null;

  // The model is consulted only for a linked person: a stranger's words must
  // not cost a call. Mid-conversation, a message that reads like a whole
  // trade in words is a new trade, not an answer.
  let intent = strict;
  let prefill: Answers = {};
  if (mightBeProse && (await store.linkedUser(msg.telegramUserId))) {
    const read = await readTrade(store, msg.telegramUserId, text, now);
    intent = read.intent;
    prefill = read.prefill;
    // It described a trade and nothing could read it: say so rather than
    // stay silent, and show the short form that always works.
    if (intent.kind === "not_a_trade" && !open) {
      return {
        text: `I couldn't read that one. Try the short form: <code>${EXAMPLE}</code>, or say the prices and what happened, e.g. "bought gold at 3340, stop 3335, closed at 3348".`,
      };
    }
  }

  if (first === "/start" || first === "/help" || GREETING_RE.test(text)) {
    const userId = await store.linkedUser(msg.telegramUserId);
    const quick = userId ? await store.isQuick(msg.telegramUserId) : false;
    return { text: helpText(userId !== null, quick) };
  }

  if (first === "/cancel") {
    if (!open) return { text: "Nothing to cancel." };
    await store.cancelDraft(open.id);
    return { text: "Cancelled. Send the trade again whenever you like." };
  }

  if (first === "/quick") {
    const userId = await store.linkedUser(msg.telegramUserId);
    if (!userId) return { text: `I don't know which Trade Journal account you are yet: ${LINK_HINT}` };
    const quick = !(await store.isQuick(msg.telegramUserId));
    await store.setQuick(msg.telegramUserId, quick);
    return {
      text: quick
        ? "Quick mode on: I'll only ask for size and date. Send /quick again to turn it off."
        : "Quick mode off: I'll ask how it felt, for tags and for notes again. Each can be skipped.",
    };
  }

  if (parseCommand(text)) {
    return {
      text: "Reports publish to a connected group or channel, not to this chat. Run that command in the group, or use <b>Post to Telegram</b> on the Posters page.",
    };
  }
  if (isCommand || !intent) return null;

  /* ── something typed while a draft is waiting ─────────────────── */
  if (open && intent.kind !== "ready") {
    // Bound to the person AND the chat, the same invariant the tap path holds.
    if (open.chatId !== msg.chatId) return null;
    const linked = await store.linkedUser(msg.telegramUserId);
    if (linked !== open.userId) return null;

    if (new Date(open.expiresAt).getTime() <= now.getTime()) {
      await store.cancelDraft(open.id);
      return { text: "That trade waited too long and has expired. Send it again." };
    }

    // A half-typed NEW trade: say what is missing, and that the old one waits.
    if (intent.kind === "incomplete") {
      return {
        text:
          `Not yet. Fix these and send it again:\n• ${intent.missing.map(escapeHtml).join("\n• ")}` +
          `\n\nYour earlier ${escapeHtml(open.draft.instrument)} trade is still waiting; answer its question, or /cancel it.`,
      };
    }

    // "date 28 aug", "size 0.5", "mood calm", "tags ...", "notes ...": an
    // answer to a NAMED question, at any point, including after the picker.
    const quick = await store.isQuick(msg.telegramUserId);
    const stage = nextStage(open.draft, open.conversation, quick);
    const edit = parseFieldEdit(text);
    // "note to self: ..." typed AT the notes question is the note, whole.
    if (edit && !(edit.stage === "notes" && stage === "notes")) {
      const applied = applyText(edit.stage, edit.value, open.conversation, now);
      if (!applied.ok) return { text: escapeHtml(applied.hint) };
      if (!(await store.saveConversation(open.id, { answers: applied.conversation.answers }, lifeFrom(now)))) {
        return { text: "Couldn't hold that answer. Send it again." };
      }
      // Changed after the picker: the answers are re-read at save time, so
      // the picker already shown still works; show the new summary anyway.
      const updated = { ...open, conversation: { ...applied.conversation, ready: undefined } };
      return continueDraft(store, updated, now);
    }

    // "sl", "be", "closed 1.0820", "tp1 hit", "still open": the result changed.
    const corrected = correctOutcome(open.draft, text);
    if (typeof corrected === "string") return { text: `Can't apply that: ${escapeHtml(corrected)}.` };
    if (corrected) {
      if (!(await store.saveDraft(open.id, corrected))) return { text: "Couldn't hold that change. Send it again." };
      const updated = { ...open, draft: corrected, conversation: { ...open.conversation, ready: undefined } };
      return continueDraft(
        store,
        updated,
        now,
        escapeHtml(describeConversation(corrected, open.conversation.answers)),
      );
    }

    if (open.conversation.ready) {
      return { text: `Pick a journal with the buttons on my last message, or /cancel. ${EDIT_HINT}` };
    }

    const applied = applyText(stage, text, open.conversation, now);
    if (!applied.ok) {
      if (applied.cancel) {
        await store.cancelDraft(open.id);
        return { text: "Cancelled. Send it again with what I got wrong." };
      }
      const again = await continueDraft(store, open, now);
      return { ...again, text: `${escapeHtml(applied.hint)} ${EDIT_HINT}\n\n${again.text}` };
    }
    const patch: Conversation = {
      answers: applied.conversation.answers,
      ...(applied.conversation.confirmed ? { confirmed: true } : {}),
    };
    if (!(await store.saveConversation(open.id, patch, lifeFrom(now)))) {
      return { text: "Couldn't hold that answer. Send it again." };
    }
    return continueDraft(store, { ...open, conversation: applied.conversation }, now);
  }

  if (intent.kind === "not_a_trade") return null;

  const userId = await store.linkedUser(msg.telegramUserId);
  if (!userId) {
    return { text: `I don't know which Trade Journal account you are yet: ${LINK_HINT}` };
  }

  if (intent.kind === "incomplete") {
    return {
      text: `Not yet. Fix these and send it again:\n• ${intent.missing.map(escapeHtml).join("\n• ")}`,
    };
  }

  const journals = (await store.editableJournals(userId)).slice(0, 20);
  if (journals.length === 0) {
    return { text: "Your account can't write to any journal, so there's nowhere to put that trade." };
  }

  // A new trade replaces whatever was still waiting, picker or not.
  if (open) await store.cancelDraft(open.id);

  // The draft outlives this request: it has to survive the questions and the
  // tap, and callback data is 64 bytes. Stored with the journals offered, so
  // a button only has to carry an index.
  const held: DraftToHold = {
    id: store.newPendingId(),
    telegramUserId: msg.telegramUserId,
    userId,
    chatId: msg.chatId,
    draft: intent.draft,
    journalIds: journals.map((j) => j.id),
    conversation: { ...EMPTY_CONVERSATION, answers: prefill },
    expiresAt: lifeFrom(now),
  };
  if (!(await store.holdDraft(held))) return { text: "Couldn't hold that trade. Try again." };

  // The first question comes with what was understood, so a person can see
  // straight away if the trade itself was misread. A reading from plain
  // words says so, because it is the one most worth checking.
  const quick = await store.isQuick(msg.telegramUserId);
  const stage = nextStage(held.draft, held.conversation, quick);
  const heading = intent.draft.read_from_prose ? "I read that as:\n" : "";
  return continueDraft(store, asOpenDraft(held), now, stage === "journal" ? undefined : `${heading}${escapeHtml(intent.summary)}`);
}
