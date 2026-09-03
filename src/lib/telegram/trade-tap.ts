/**
 * A tapped journal button: the one place a Telegram message becomes a row in
 * `trades`, the most consequential table in the app.
 *
 * Everything in callback data is client-chosen, so nothing in it is trusted:
 * the draft is re-read, the tapper must be its author, the tap must come from
 * the chat the draft was shown in, the account link must still stand, and
 * membership of the chosen journal is checked NOW against the database. Then
 * the draft is consumed with a conditional update so a double-tap cannot
 * save twice, and the insert is keyed on the pending id so a retry after a
 * crash or a lost reply cannot save twice either.
 *
 * Pure over a store interface. Every refusal below is a unit test.
 */

import { buildTradeRow } from "@/lib/trades/build-trade";
import { outcomeFields } from "@/lib/trades/outcome-parser";
import { escapeHtml } from "@/lib/reports/caption";
import type { TradeChoice } from "@/lib/telegram/commands";
import type { TradeDraft } from "@/lib/telegram/trade-intent";
import { effectiveDraft, type Conversation } from "@/lib/telegram/conversation";
import { getInstrumentSpec } from "@/lib/trading/instrument-specs";

/**
 * A draft consumed this long ago with no trade recorded was taken by a tap
 * that never finished (a crash between consume and insert). It may be taken
 * again; the unique key on the insert makes that safe.
 */
export const STALE_CONSUME_SECONDS = 30;

export interface PendingTrade {
  readonly id: string;
  readonly telegramUserId: number;
  readonly userId: string;
  readonly chatId: string;
  readonly draft: TradeDraft;
  readonly journalIds: readonly string[];
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly tradeId: string | null;
  /** The questions asked and answered since the draft was held. */
  readonly conversation: Conversation;
}

export interface LastSize {
  /** Units, as stored in trades.quantity. */
  readonly quantity: number;
  /** Standard lots, when the earlier trade recorded them. */
  readonly lots: number | null;
}

export interface Membership {
  readonly name: string;
  readonly canEdit: boolean;
  readonly archived: boolean;
}

export type InsertOutcome =
  | { readonly id: string }
  | { readonly duplicate: true }
  | { readonly error: string };

export interface TradeTapStore {
  /** The draft in whatever state it is in, or null if it never existed. */
  loadPending(id: string): Promise<PendingTrade | null>;
  linkedUser(telegramUserId: number): Promise<string | null>;
  membership(journalId: string, userId: string): Promise<Membership | null>;
  /** Set consumed_at, only if it was null. True when this call did it. */
  consume(id: string, now: Date): Promise<boolean>;
  /** Re-take a draft consumed before `staleBefore` with no trade recorded. */
  retake(id: string, now: Date, staleBefore: Date): Promise<boolean>;
  /** The size this person last used for this instrument in this journal. */
  lastSize(userId: string, journalId: string, instrument: string): Promise<LastSize | null>;
  insertTrade(row: Record<string, unknown>): Promise<InsertOutcome>;
  /** The trade already saved for this draft, if the insert was refused as a duplicate. */
  savedTradeFor(pendingId: string): Promise<string | null>;
  markSaved(id: string, tradeId: string): Promise<void>;
}

export interface Tap {
  readonly choice: TradeChoice;
  readonly tapperId: number;
  /** The chat the tap arrived from. */
  readonly chatId: string;
}

export interface TapResult {
  /** Shown on the button (a toast, or a dialog when `alert`). */
  readonly answer: string;
  readonly alert: boolean;
  /** Remove the picker's buttons. */
  readonly clearPicker: boolean;
  /** A message to send to the draft's chat, if any. */
  readonly message?: string;
}

function refuse(answer: string): TapResult {
  return { answer, alert: true, clearPicker: false };
}

export async function handleTradeTap(store: TradeTapStore, tap: Tap, now: Date): Promise<TapResult> {
  const pending = await store.loadPending(tap.choice.pendingId);
  if (!pending || new Date(pending.expiresAt).getTime() <= now.getTime()) {
    return refuse("That one has expired. Send the trade again.");
  }

  // The tapper must be the person who typed it, and the tap must come from
  // the chat the picker was shown in. A forwarded picker satisfies neither
  // for anyone else and would otherwise answer -- with the journal name --
  // wherever it was forwarded to.
  if (pending.telegramUserId !== tap.tapperId) {
    return refuse("That isn't your trade to save.");
  }
  if (pending.chatId !== tap.chatId) {
    return refuse("Use the picker in your own chat with me.");
  }

  // Their link must still stand: unlinking is a revocation.
  const userId = await store.linkedUser(tap.tapperId);
  if (!userId || userId !== pending.userId) {
    return refuse("Your account is no longer linked.");
  }

  if (tap.choice.journalIndex === null) {
    if (await store.consume(pending.id, now)) {
      return { answer: "Cancelled.", alert: false, clearPicker: true };
    }
    return { answer: pending.tradeId ? "Already saved." : "Already handled.", alert: false, clearPicker: true };
  }

  const journalId = pending.journalIds[tap.choice.journalIndex];
  if (!journalId) return refuse("That option isn't valid.");

  // A picker is only shown once every question is answered. Anything else
  // carrying a journal index is stale or crafted.
  if (!pending.conversation.ready) return refuse("Answer the question above first.");

  // Membership is checked NOW, against the database, not against the list
  // stored half an hour ago. Access can be revoked between the two.
  const m = await store.membership(journalId, userId);
  if (!m || m.archived || !m.canEdit) {
    return refuse("You can't write to that journal.");
  }

  // CONSUME FIRST, conditionally, so a double-tap cannot save twice. A draft
  // consumed a while ago with nothing saved was taken by a tap that died;
  // that one may be taken again.
  const taken =
    (await store.consume(pending.id, now)) ||
    (pending.tradeId === null &&
      (await store.retake(pending.id, now, new Date(now.getTime() - STALE_CONSUME_SECONDS * 1000))));
  if (!taken) {
    return {
      answer: pending.tradeId ? "Already saved." : "Saving that one already.",
      alert: false,
      clearPicker: pending.tradeId !== null,
    };
  }

  const answers = pending.conversation.answers;
  const d = effectiveDraft(pending.draft, answers);

  // SIZE. The row's `quantity` is UNITS (P&L is price move x quantity); what a
  // person types is LOTS. The conversion is the instrument's contract size,
  // the same one the form and the lot-size calculator use. A typed size wins;
  // then what this person last used here; then one unit, said out loud, because
  // a silent default is how a gold trade ends up worth eight dollars.
  const { contractSize } = getInstrumentSpec(d.instrument);
  let quantity: number;
  let lotSize: number | null;
  let sizeNote: string;
  if (d.lots !== null) {
    quantity = d.lots * contractSize;
    lotSize = d.lots;
    sizeNote = "";
  } else {
    const last = await store.lastSize(userId, journalId, d.instrument);
    if (last) {
      quantity = last.quantity;
      lotSize = last.lots;
      sizeNote = ` (size ${last.lots !== null ? `${last.lots} lots` : `${last.quantity} units`}, as last time)`;
    } else {
      quantity = 1;
      lotSize = null;
      sizeNote = ' (size 1 unit: add "0.5 lots" to the message to set it)';
    }
  }

  const built = buildTradeRow(
    {
      instrument: d.instrument,
      asset_type: d.asset_type,
      direction: d.direction,
      entry_price: d.entry_price,
      entry_price_high: d.entry_price_high,
      quantity,
      lot_size: lotSize,
      entry_time: d.entry_time,
      stop_loss: d.stop_loss,
      tp1: d.tp1, tp2: d.tp2, tp3: d.tp3, tp4: d.tp4, tp5: d.tp5, tp6: d.tp6, tp7: d.tp7,
      tp4_trailing: d.tp4_trailing,
      take_profit: d.tp1,
      emotion: answers.emotion ?? null,
      tags: answers.tags ?? [],
      // The typed message stays with the row whatever else was said, so a
      // wrong figure can be traced to what was typed.
      notes: answers.notes
        ? `${answers.notes}\n\nLogged from Telegram: ${d.message}`
        : `Logged from Telegram: ${d.message}`,
      ...outcomeFields(d.outcome),
    },
    { userId, journalId },
  );

  if (!built.ok) {
    // The draft stays consumed: the same draft would fail the same way. The
    // picker is cleared so it cannot be re-tapped into the same message.
    return {
      answer: "Couldn't save that.",
      alert: false,
      clearPicker: true,
      message: `Couldn't save that: ${escapeHtml(built.issues.join("; "))}. Send it again with that fixed.`,
    };
  }

  const inserted = await store.insertTrade({ ...built.row, telegram_pending_id: pending.id });

  let tradeId: string | null = null;
  if ("id" in inserted) {
    tradeId = inserted.id;
  } else if ("duplicate" in inserted) {
    // A previous attempt DID commit and its reply was lost. Not an error.
    tradeId = await store.savedTradeFor(pending.id);
  }

  if (!tradeId) {
    // Left consumed. After STALE_CONSUME_SECONDS a tap may take it again, and
    // the unique key on the insert makes that retry safe.
    return {
      answer: "Couldn't save that.",
      alert: false,
      clearPicker: false,
      message: "Couldn't save that trade. Nothing was written. Tap the journal again in a minute, or send the trade again.",
    };
  }

  await store.markSaved(pending.id, tradeId);
  return {
    answer: "Saved.",
    alert: false,
    clearPicker: true,
    message: `Saved to <b>${escapeHtml(m.name)}</b>${escapeHtml(sizeNote)}.`,
  };
}
