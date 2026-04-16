export type UserRole = "user" | "trader" | "admin";
export type AssetType = "forex" | "crypto" | "metal";
export type TradeDirection = "buy" | "sell";
export type TradeSource = "manual" | "csv" | "mt5_webhook";

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
  readonly created_at: string;
  readonly updated_at: string;
}

export interface Trade {
  readonly id: string;
  readonly user_id: string;
  readonly instrument: string;
  readonly asset_type: AssetType;
  readonly direction: TradeDirection;
  readonly entry_price: number;
  readonly exit_price: number | null;
  readonly quantity: number;
  readonly lot_size: number | null;
  readonly stop_loss: number | null;
  readonly take_profit: number | null;
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
