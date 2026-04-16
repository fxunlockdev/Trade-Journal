import type { Signal } from "@/types/database";
import { getOpenAIClient } from "@/lib/openai/client";
import { generateSignalMessage } from "./templates";

const AI_TIMEOUT_MS = 10_000;

export async function formatSignalWithAI(signal: Signal): Promise<string> {
  try {
    const client = getOpenAIClient();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    const signalData = JSON.stringify(
      {
        instrument: signal.instrument,
        direction: signal.direction,
        entry_price: signal.entry_price,
        stop_loss: signal.stop_loss,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        tp4: signal.tp4,
        pips_to_sl: signal.pips_to_sl,
        pips_to_tp1: signal.pips_to_tp1,
        notes: signal.notes,
      },
      null,
      2,
    );

    const completion = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Format this trading signal for a Telegram channel. Use emojis, be concise and professional. Include all price levels with pip calculations.",
          },
          {
            role: "user",
            content: signalData,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      },
      { signal: controller.signal },
    );

    clearTimeout(timeoutId);

    const message = completion.choices[0]?.message?.content;

    if (!message) {
      return generateSignalMessage(signal);
    }

    return message;
  } catch {
    return generateSignalMessage(signal);
  }
}
