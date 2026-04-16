import type { TradeDirection } from "@/types/database";

interface TradeForComputation {
  readonly entry_price: number;
  readonly exit_price: number | null;
  readonly quantity: number;
  readonly direction: TradeDirection;
  readonly fees: number;
  readonly stop_loss: number | null;
  readonly take_profit: number | null;
}

export function computePnlAbsolute(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  direction: TradeDirection,
  fees: number,
): number {
  const rawPnl =
    direction === "buy"
      ? (exitPrice - entryPrice) * quantity
      : (entryPrice - exitPrice) * quantity;
  return rawPnl - fees;
}

export function computePnlPercentage(
  entryPrice: number,
  exitPrice: number,
  direction: TradeDirection,
): number {
  if (entryPrice === 0) return 0;
  return direction === "buy"
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;
}

export function computeRiskRewardRatio(
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  direction: TradeDirection,
): number {
  const risk =
    direction === "buy"
      ? Math.abs(entryPrice - stopLoss)
      : Math.abs(stopLoss - entryPrice);

  if (risk === 0) return 0;

  const reward =
    direction === "buy"
      ? Math.abs(takeProfit - entryPrice)
      : Math.abs(entryPrice - takeProfit);

  return reward / risk;
}

export function computeRMultiple(
  entryPrice: number,
  exitPrice: number,
  stopLoss: number,
  direction: TradeDirection,
): number {
  const risk =
    direction === "buy"
      ? Math.abs(entryPrice - stopLoss)
      : Math.abs(stopLoss - entryPrice);

  if (risk === 0) return 0;

  const actualPnl =
    direction === "buy" ? exitPrice - entryPrice : entryPrice - exitPrice;

  return actualPnl / risk;
}

export function computeTradeFields<T extends TradeForComputation>(
  trade: T,
): T & {
  readonly pnl_absolute: number | null;
  readonly pnl_percentage: number | null;
  readonly risk_reward_ratio: number | null;
  readonly r_multiple: number | null;
} {
  if (trade.exit_price === null) {
    return {
      ...trade,
      pnl_absolute: null,
      pnl_percentage: null,
      risk_reward_ratio:
        trade.stop_loss !== null && trade.take_profit !== null
          ? computeRiskRewardRatio(
              trade.entry_price,
              trade.stop_loss,
              trade.take_profit,
              trade.direction,
            )
          : null,
      r_multiple: null,
    };
  }

  const pnlAbsolute = computePnlAbsolute(
    trade.entry_price,
    trade.exit_price,
    trade.quantity,
    trade.direction,
    trade.fees,
  );

  const pnlPercentage = computePnlPercentage(
    trade.entry_price,
    trade.exit_price,
    trade.direction,
  );

  const riskRewardRatio =
    trade.stop_loss !== null && trade.take_profit !== null
      ? computeRiskRewardRatio(
          trade.entry_price,
          trade.stop_loss,
          trade.take_profit,
          trade.direction,
        )
      : null;

  const rMultiple =
    trade.stop_loss !== null
      ? computeRMultiple(
          trade.entry_price,
          trade.exit_price,
          trade.stop_loss,
          trade.direction,
        )
      : null;

  return {
    ...trade,
    pnl_absolute: pnlAbsolute,
    pnl_percentage: pnlPercentage,
    risk_reward_ratio: riskRewardRatio,
    r_multiple: rMultiple,
  };
}
