import type { Signal, TradeDirection } from "@/types/database";
import { computePipsDifference } from "./computations";

function getDirectionEmoji(direction: TradeDirection): string {
  return direction === "buy" ? "\u{1F7E2}" : "\u{1F534}";
}

function formatPrice(price: number): string {
  return price.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

export function generateSignalMessage(signal: Signal): string {
  const emoji = getDirectionEmoji(signal.direction);
  const direction = signal.direction.toUpperCase();
  const pipsToSl = computePipsDifference(
    signal.entry_price,
    signal.stop_loss,
    signal.instrument,
  ).toFixed(1);

  const lines: string[] = [
    `${emoji} *${signal.instrument}* | ${direction}`,
    "",
    `\u{1F4CD} Entry: \`${formatPrice(signal.entry_price)}\``,
    `\u{1F6D1} Stop Loss: \`${formatPrice(signal.stop_loss)}\` (${pipsToSl} pips)`,
  ];

  if (signal.tp1 !== null) {
    const pips = computePipsDifference(
      signal.entry_price,
      signal.tp1,
      signal.instrument,
    ).toFixed(1);
    lines.push(`\u{1F3AF} TP1: \`${formatPrice(signal.tp1)}\` (${pips} pips)`);
  }

  if (signal.tp2 !== null) {
    lines.push(`\u{1F3AF} TP2: \`${formatPrice(signal.tp2)}\``);
  }

  if (signal.tp3 !== null) {
    lines.push(`\u{1F3AF} TP3: \`${formatPrice(signal.tp3)}\``);
  }

  if (signal.tp4 !== null) {
    lines.push(`\u{1F3AF} TP4: \`${formatPrice(signal.tp4)}\``);
  }

  if (signal.notes) {
    lines.push("", `\u{1F4DD} ${signal.notes}`);
  }

  lines.push("", `\u{23F0} ${new Date(signal.created_at).toUTCString()}`);

  return lines.join("\n");
}
