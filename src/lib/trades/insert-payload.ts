/**
 * The one place a trade INSERT payload is assembled.
 *
 * There were two, and they differed in a way that mattered: `/api/trades`
 * re-applied `user_id` and `journal_id` after the computation, and `/api/chat`
 * omitted `journal_id` entirely. Since the column is NOT NULL, every trade the
 * AI chat ever tried to create failed on a null violation -- silently, for two
 * months, because the error became a chat reply rather than a report.
 *
 * A test could have caught that. A type makes it unrepresentable, which is
 * better: `journal_id` is a required argument here, so a caller that forgets it
 * does not compile.
 */

export interface TradeOwnership {
  /** From the verified session, never from the request body. */
  readonly userId: string;
  /** Resolved and membership-checked by the caller, never from the body. */
  readonly journalId: string;
}

/**
 * Stamp ownership and provenance onto computed trade fields.
 *
 * Applied AFTER `computeTradeFields` on purpose. These three are what RLS and
 * the P&L guard read, so a stray key earlier in a spread chain must not be able
 * to reach them.
 *
 * `source` is forced to "manual". Broker provenance ("csv", "mt5_webhook") is
 * written only by the import and sync paths; letting a caller claim it would
 * disarm the P&L recompute guard in `/api/trades/[id]` on every later edit.
 */
export function tradeInsertPayload<T extends object>(
  computed: T,
  ownership: TradeOwnership,
): T & { user_id: string; journal_id: string; source: "manual" } {
  return {
    ...computed,
    user_id: ownership.userId,
    journal_id: ownership.journalId,
    source: "manual" as const,
  };
}
