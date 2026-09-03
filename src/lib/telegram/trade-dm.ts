/**
 * A message typed in a private chat with the bot.
 *
 * Either the start of a trade, or the answer to the question the bot last
 * asked about one. Pure over a small store interface, so every branch --
 * help, unlinked, incomplete, no journals, rate-limited, an answer, a new
 * trade replacing an old draft, /cancel, /quick -- is a unit test rather
 * than a production incident. The route implements the store over the
 * admin client.
 */

import { parseCommand } from "@/lib/telegram/commands";
import { parseTradeIntent, type TradeDraft } from "@/lib/telegram/trade-intent";
import { applyText, nextStage, EMPTY_CONVERSATION, type Conversation } from "@/lib/telegram/conversation";
import { advance, type FlowStore, type OpenDraft, type FlowReply } from "@/lib/telegram/trade-flow";
import { escapeHtml } from "@/lib/reports/caption";

/** How long a shown draft stays tappable. */
export const PENDING_TTL_MINUTES = 30;

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
  /** False when the draft could not be stored. */
  holdDraft(draft: DraftToHold): Promise<boolean>;
  /** The draft this person is still answering questions about, if any. */
  openDraft(telegramUserId: number): Promise<OpenDraft | null>;
  cancelDraft(id: string): Promise<void>;
  setQuick(telegramUserId: number, quick: boolean): Promise<void>;
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

function helpText(linked: boolean, quick: boolean): string {
  const how =
    `Send me a trade in plain words, for example:\n<code>${EXAMPLE}</code>\n\n` +
    `Say what happened: an exit price ("closed 3348"), "tp1 hit", "sl", "be", or "still open". ` +
    `Add a date like "28 aug" for a past trade and "0.5 lots" for the size, or I'll ask. ` +
    (quick
      ? `Quick mode is on, so I only ask for size and date. /quick turns it off.`
      : `I'll also ask how it felt, for tags and for notes; each can be skipped, and /quick turns those three off.`) +
    ` /cancel drops the trade I'm asking about.`;
  if (linked) return how;
  return `First, link this chat to your Trade Journal account: ${LINK_HINT}\n\n${how}`;
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
 * Reply to a DM, or null to stay silent.
 *
 * Silence is deliberate for anything that is neither a trade nor an answer:
 * "thanks" must not get a parse error, and a stranger who was never linked
 * must not be able to make the bot talk by sending it words.
 */
export async function handleTradeMessage(
  store: TradeDmStore,
  msg: DmMessage,
  now: Date,
): Promise<BotReply | null> {
  const text = msg.text.trim();
  const first = text.split(/\s+/)[0]?.toLowerCase() ?? "";

  if (first === "/start" || first === "/help" || GREETING_RE.test(text)) {
    const userId = await store.linkedUser(msg.telegramUserId);
    const quick = userId ? await store.isQuick(msg.telegramUserId) : false;
    return { text: helpText(userId !== null, quick) };
  }

  if (first === "/cancel") {
    const open = await store.openDraft(msg.telegramUserId);
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

  const intent = parseTradeIntent(text, now);

  // An answer to the open question, unless the message is itself a trade,
  // which replaces the draft being asked about.
  const open = await store.openDraft(msg.telegramUserId);
  if (open && intent.kind === "not_a_trade") {
    if (!(await store.allow(msg.telegramUserId))) return null;
    const linked = await store.linkedUser(msg.telegramUserId);
    if (linked !== open.userId) return null;
    const quick = await store.isQuick(msg.telegramUserId);
    const stage = nextStage(open.draft, open.conversation, quick);
    const applied = applyText(stage, text, open.conversation, now);
    if (!applied.ok) {
      const again = await advance(store, open, now);
      return { ...again, text: `${escapeHtml(applied.hint)}\n\n${again.text}` };
    }
    await store.saveConversation(open.id, applied.conversation);
    return advance(store, { ...open, conversation: applied.conversation }, now);
  }

  if (intent.kind === "not_a_trade") return null;

  // Before any reply and before any write: a message that looks like a trade
  // is the cheapest way to make the bot do work.
  if (!(await store.allow(msg.telegramUserId))) return null;

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

  // A new trade replaces whatever was still being asked about.
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
    conversation: EMPTY_CONVERSATION,
    expiresAt: new Date(now.getTime() + PENDING_TTL_MINUTES * 60_000).toISOString(),
  };
  if (!(await store.holdDraft(held))) return { text: "Couldn't hold that trade. Try again." };

  const reply = await advance(store, asOpenDraft(held), now);
  // The first question comes with what was understood, so a person can see
  // straight away if the trade itself was misread.
  const stage = nextStage(held.draft, held.conversation, await store.isQuick(msg.telegramUserId));
  if (stage === "journal") return reply;
  return { ...reply, text: `${escapeHtml(intent.summary)}\n\n${reply.text}` };
}
