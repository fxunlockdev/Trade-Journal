import type { Signal } from "@/types/database";
import { computePipsDifference } from "./computations";

function formatPrice(price: number): string {
  return price.toString();
}

export function generateSignalMessage(signal: Signal): string {
  const directionEmoji = signal.direction === "buy" ? "\u{1F7E2}" : "\u{1F534}";
  const directionLabel = signal.direction === "buy" ? "BUY NOW" : "SELL NOW";

  const lines: string[] = [
    `${directionEmoji} ${directionLabel} ${signal.instrument}`,
    "",
    `\u{1F4CD} ENTRY: ${formatPrice(signal.entry_price)}`,
    "",
  ];

  const slPips = computePipsDifference(
    signal.entry_price,
    signal.stop_loss,
    signal.instrument,
  );
  lines.push(`\u{1F6D1} SL \u2013 ${formatPrice(signal.stop_loss)} (${slPips} pips)`);
  lines.push("");

  const tpLevels = [
    { label: "TP1", value: signal.tp1 },
    { label: "TP2", value: signal.tp2 },
    { label: "TP3", value: signal.tp3 },
    { label: "TP4", value: signal.tp4 },
  ] as const;

  for (const tp of tpLevels) {
    if (tp.value !== null) {
      const pips = computePipsDifference(
        signal.entry_price,
        tp.value,
        signal.instrument,
      );
      lines.push(`\u{1F3AF} ${tp.label} ${formatPrice(tp.value)} (${pips} pips)`);
    }
  }

  const hasAnyTp = tpLevels.some((tp) => tp.value !== null);
  const lastTpWithValue = [...tpLevels]
    .reverse()
    .find((tp) => tp.value !== null);
  const lastTpIndex = lastTpWithValue
    ? tpLevels.indexOf(lastTpWithValue)
    : -1;

  if (lastTpIndex < 3) {
    lines.push(`\u{1F3AF} TP${lastTpIndex + 2 > 4 ? 4 : lastTpIndex + 2} (Open)`);
  }

  if (hasAnyTp) {
    lines.push("");
  }

  if (signal.notes) {
    lines.push(`\u{1F4DD} ${signal.notes}`);
    lines.push("");
  }

  lines.push("\u26A1 Trade Management:");
  lines.push("Take multiple entries, secure profits at each TP.");

  return lines.join("\n");
}
