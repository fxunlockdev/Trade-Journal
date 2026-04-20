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
  readonly user_id: string;
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
   * read/write `tp1`..`tp4`. The DB migration copies `take_profit → tp1` for
   * existing rows and the form keeps them in sync when only one TP is set.
   */
  readonly take_profit: number | null;
  readonly tp1: number | null;
  readonly tp2: number | null;
  readonly tp3: number | null;
  readonly tp4: number | null;
  readonly sl_pips: number | null;
  readonly tp1_pips: number | null;
  readonly tp2_pips: number | null;
  readonly tp3_pips: number | null;
  readonly tp4_pips: number | null;
  readonly tp1_result: TPResult | null;
  readonly tp2_result: TPResult | null;
  readonly tp3_result: TPResult | null;
  readonly tp4_result: TPResult | null;
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
