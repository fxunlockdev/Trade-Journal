export type UserRole = "user" | "trader" | "admin";
export type AssetType =
  | "forex"
  | "crypto"
  | "metal"
  | "commodity"
  | "index";
export type TradeDirection = "buy" | "sell";
export type TradeSource = "manual" | "csv" | "mt5_webhook";
export type OrderType = "market" | "limit" | "stop";
/**
 * Per-TP outcome. Mirrors Postgres enum `tp_result`.
 * - `hit`: price reached this TP and that slice closed in profit
 * - `be` : moved to break-even at this TP (closed at entry)
 * - `sl` : stopped out before this TP was reached (closed at SL)
 */
export type TPResult = "hit" | "be" | "sl";

export type SignalStatus =
  | "CREATED"
  | "SENT"
  | "ACTIVE"
  | "TP_HIT"
  | "SL_HIT"
  | "CLOSED";

/**
 * Multi-journal + collaboration (see DB migration 2026-04-23).
 *
 * A journal is a shared workspace that holds trades. Every user auto-gets a
 * "Personal" journal on signup (they're the owner). Owners can invite others
 * via link-based invites; invitees join as `member` (can CRUD any trade in
 * the journal, tracked in `trade_audit_log`) or `viewer` (read-only).
 */
export type JournalRole = "owner" | "member" | "viewer";

export type JournalColor =
  | "slate"
  | "emerald"
  | "sky"
  | "violet"
  | "orange"
  | "cyan"
  | "rose"
  | "lime"
  | "amber"
  | "red";

export type TradeAuditAction = "created" | "updated" | "deleted";

export interface Journal {
  readonly id: string;
  readonly owner_user_id: string;
  readonly name: string;
  readonly color: JournalColor;
  readonly description: string | null;
  readonly is_archived: boolean;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface JournalMember {
  readonly journal_id: string;
  readonly user_id: string;
  readonly role: JournalRole;
  readonly invited_by_user_id: string | null;
  readonly joined_at: string;
}

/** A journal annotated with the *current viewer's* role (server-resolved). */
export interface JournalWithRole extends Journal {
  readonly my_role: JournalRole;
}

export interface JournalInvite {
  readonly id: string;
  readonly journal_id: string;
  readonly token: string;
  /** Owner role cannot be invited — only member/viewer. */
  readonly role: Exclude<JournalRole, "owner">;
  readonly created_by_user_id: string;
  readonly expires_at: string;
  readonly accepted_at: string | null;
  readonly accepted_by_user_id: string | null;
  readonly revoked_at: string | null;
  readonly created_at: string;
}

/**
 * One row per trade create / update / delete. Written automatically by the
 * `log_trade_change` trigger. `actor_user_id` is NULL for system-driven
 * changes (e.g. the migration backfill); UI should hide those rows.
 */
export interface TradeAuditEntry {
  readonly id: string;
  readonly trade_id: string | null;
  readonly journal_id: string | null;
  readonly actor_user_id: string | null;
  readonly action: TradeAuditAction;
  readonly changed_fields: readonly string[];
  readonly before_data: Readonly<Record<string, unknown>> | null;
  readonly after_data: Readonly<Record<string, unknown>> | null;
  readonly created_at: string;
}

export interface User {
  readonly id: string;
  readonly email: string;
  readonly full_name: string | null;
  readonly avatar_url: string | null;
  readonly role: UserRole;
  readonly has_onboarded: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly user_id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

export interface Trade {
  readonly id: string;
  /**
   * Author (who created the trade). Nullable because the FK is `ON DELETE
   * SET NULL` — when a user deletes their account, their trades survive in
   * shared journals as "unknown author" rather than vanishing.
   */
  readonly user_id: string | null;
  /**
   * Which journal this trade belongs to. NOT NULL since the 2026-04-23
   * migration — every trade lives in exactly one workspace.
   */
  readonly journal_id: string;
  /** Last-edit metadata (populated by the `stamp_trade_edit_metadata` BEFORE UPDATE trigger). */
  readonly last_edited_by_user_id: string | null;
  readonly last_edited_at: string | null;
  readonly instrument: string;
  readonly asset_type: AssetType;
  readonly direction: TradeDirection;
  readonly entry_price: number;
  /** Optional upper bound for entry price range (signal-style "entry 1.2300–1.2310"). */
  readonly entry_price_high: number | null;
  readonly exit_price: number | null;
  readonly quantity: number;
  readonly lot_size: number | null;
  readonly stop_loss: number | null;
  /**
   * Legacy single-TP field. Kept for backward compatibility. New code should
   * read/write `tp1`..`tp7`. The DB migration copies `take_profit → tp1` for
   * existing rows and the form keeps them in sync when only one TP is set.
   */
  readonly take_profit: number | null;
  readonly tp1: number | null;
  readonly tp2: number | null;
  readonly tp3: number | null;
  readonly tp4: number | null;
  readonly tp5: number | null;
  readonly tp6: number | null;
  readonly tp7: number | null;
  readonly sl_pips: number | null;
  readonly tp1_pips: number | null;
  readonly tp2_pips: number | null;
  readonly tp3_pips: number | null;
  readonly tp4_pips: number | null;
  readonly tp5_pips: number | null;
  readonly tp6_pips: number | null;
  readonly tp7_pips: number | null;
  readonly tp1_result: TPResult | null;
  readonly tp2_result: TPResult | null;
  readonly tp3_result: TPResult | null;
  readonly tp4_result: TPResult | null;
  readonly tp5_result: TPResult | null;
  readonly tp6_result: TPResult | null;
  readonly tp7_result: TPResult | null;
  /** If true, TP4 is "let it run / trailing" rather than a fixed target. */
  readonly tp4_trailing: boolean;
  readonly order_type: OrderType;
  /** Number of positions the risk is split across (1..10). */
  readonly num_positions: number;
  /** If true, risk is split across positions; each TP closes 1/num_positions. */
  readonly split_risk: boolean;
  readonly fees: number;
  readonly notes: string | null;
  readonly tags: readonly string[];
  readonly entry_time: string;
  readonly exit_time: string | null;
  readonly pnl_absolute: number | null;
  readonly pnl_percentage: number | null;
  readonly risk_reward_ratio: number | null;
  readonly r_multiple: number | null;
  readonly source: TradeSource;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface Signal {
  readonly id: string;
  readonly trader_id: string;
  readonly instrument: string;
  readonly direction: TradeDirection;
  readonly entry_price: number;
  readonly stop_loss: number;
  readonly tp1: number | null;
  readonly tp2: number | null;
  readonly tp3: number | null;
  readonly tp4: number | null;
  readonly notes: string | null;
  readonly status: SignalStatus;
  readonly telegram_message_id: string | null;
  readonly formatted_message: string | null;
  readonly pips_to_sl: number | null;
  readonly pips_to_tp1: number | null;
  readonly risk_amount: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SignalEvent {
  readonly id: string;
  readonly signal_id: string;
  readonly event_type: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

export type CreateTrade = Omit<
  Trade,
  | "id"
  | "pnl_absolute"
  | "pnl_percentage"
  | "risk_reward_ratio"
  | "r_multiple"
  | "created_at"
  | "updated_at"
  // Journal context + edit metadata are populated server-side / via DB trigger
  | "journal_id"
  | "last_edited_by_user_id"
  | "last_edited_at"
>;

export type UpdateTrade = Partial<CreateTrade>;

export type CreateSignal = Omit<
  Signal,
  | "id"
  | "telegram_message_id"
  | "formatted_message"
  | "pips_to_sl"
  | "pips_to_tp1"
  | "created_at"
  | "updated_at"
>;

export type UpdateSignal = Partial<CreateSignal>;
