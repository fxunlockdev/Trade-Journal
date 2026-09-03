/**
 * A message typed in a private chat with the bot.
 *
 * Pure over a small store interface, so every branch -- help, unlinked,
 * incomplete, no journals, rate-limited, ready -- is a unit test rather than
 * a production incident. The route implements the store over the admin client.
 */

import { encodeTrade, parseCommand, MAX_JOURNAL_BUTTONS } from "@/lib/telegram/commands";
import { parseTradeIntent, draftIsClosed, type TradeDraft } from "@/lib/telegram/trade-intent";
import { escapeHtml } from "@/lib/reports/caption";
import type { InlineButton } from "@/lib/telegram/chat";
import type { JournalChoice } from "@/lib/telegram/accounts";

/** How long a shown draft stays tappable. */
export const PENDING_TTL_MINUTES = 30;

export interface DraftToHold {
  readonly id: string;
  readonly telegramUserId: number;
  readonly userId: string;
  readonly chatId: string;
  readonly draft: TradeDraft;
  readonly journalIds: readonly string[];
  readonly expiresAt: string;
}

export interface TradeDmStore {
  /** Within this sender's allowance. Keyed on the Telegram user, never the text. */
  allow(telegramUserId: number): Promise<boolean>;
  linkedUser(telegramUserId: number): Promise<string | null>;
  editableJournals(userId: string): Promise<readonly JournalChoice[]>;
  newPendingId(): string;
  /** False when the draft could not be stored. */
  holdDraft(draft: DraftToHold): Promise<boolean>;
}

export interface DmMessage {
  readonly text: string;
  readonly telegramUserId: number;
  readonly chatId: string;
}

export interface BotReply {
  readonly text: string;
  readonly buttons?: readonly InlineButton[];
}

const EXAMPLE = "XAUUSD buy 3340 sl 3335 tp1 3350 closed 3348";

function helpText(linked: boolean): string {
  const how =
    `Send me a trade in plain words, for example:\n<code>${EXAMPLE}</code>\n\n` +
    `Say what happened: an exit price ("closed 3348"), "tp1 hit", "sl", "be", or "still open". ` +
    `Add a date like "28 aug" for a past trade and "0.5 lots" for the size. ` +
    `I'll show you what I understood and ask which journal before saving anything.`;
  if (linked) return how;
  return (
    "First, link this chat to your Trade Journal account: open <b>Settings → Telegram</b> in the app, " +
    "get a link code, and send it to me here.\n\n" + how
  );
}

/**
 * Reply to a DM, or null to stay silent.
 *
 * Silence is deliberate for anything that is not a trade: "thanks" and
 * "morning" must not get a parse error, and a stranger who was never linked
 * must not be able to make the bot talk by sending it words.
 */
export async function handleTradeMessage(
  store: TradeDmStore,
  msg: DmMessage,
  now: Date,
): Promise<BotReply | null> {
  const text = msg.text.trim();
  const first = text.split(/\s+/)[0]?.toLowerCase() ?? "";

  if (first === "/start" || first === "/help") {
    const userId = await store.linkedUser(msg.telegramUserId);
    return { text: helpText(userId !== null) };
  }

  if (parseCommand(text)) {
    return {
      text: "Reports publish to a connected group or channel, not to this chat. Run that command in the group, or use <b>Post to Telegram</b> on the Posters page.",
    };
  }

  const intent = parseTradeIntent(text, now);
  if (intent.kind === "not_a_trade") return null;

  // Before any reply and before any write: a message that looks like a trade
  // is the cheapest way to make the bot do work.
  if (!(await store.allow(msg.telegramUserId))) return null;

  const userId = await store.linkedUser(msg.telegramUserId);
  if (!userId) {
    return {
      text: "I don't know which Trade Journal account you are yet. Open <b>Settings → Telegram</b> in the app, get a link code, and send it to me here.",
    };
  }

  if (intent.kind === "incomplete") {
    return {
      text: `Not yet. Fix these and send it again:\n• ${intent.missing.map(escapeHtml).join("\n• ")}`,
    };
  }

  const journals = (await store.editableJournals(userId)).slice(0, MAX_JOURNAL_BUTTONS);
  if (journals.length === 0) {
    return {
      text: "Your account can't write to any journal, so there's nowhere to put that trade.",
    };
  }

  // The draft outlives this request: it has to survive until the tap, and
  // callback data is 64 bytes. Stored with the journals offered, so the
  // button only has to carry an index.
  const id = store.newPendingId();
  const held = await store.holdDraft({
    id,
    telegramUserId: msg.telegramUserId,
    userId,
    chatId: msg.chatId,
    draft: intent.draft,
    journalIds: journals.map((j) => j.id),
    expiresAt: new Date(now.getTime() + PENDING_TTL_MINUTES * 60_000).toISOString(),
  });
  if (!held) return { text: "Couldn't hold that trade. Try again." };

  const openNote = draftIsClosed(intent.draft)
    ? ""
    : "\n<i>Still open, so it won't appear on a poster until it's closed.</i>";

  return {
    text: `${escapeHtml(intent.summary)}${openNote}\n\nWhich journal?`,
    buttons: [
      ...journals.map((j, i) => ({ text: j.name, callback_data: encodeTrade(id, i) })),
      { text: "Cancel", callback_data: encodeTrade(id, null) },
    ],
  };
}
