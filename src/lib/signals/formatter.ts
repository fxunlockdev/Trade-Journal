import type { Signal } from "@/types/database";
import { getOpenAIClient, OPENAI_MODEL } from "@/lib/openai/client";
import { generateSignalMessage } from "./templates";

// Reasoning models need headroom over pure-text models; low effort keeps
// this well under the timeout in practice.
const AI_TIMEOUT_MS = 15_000;

const FORMATTER_SYSTEM_PROMPT = [
  "You polish trading signal messages for a Telegram channel.",
  "You receive a baseline message (already correct) plus the raw signal data.",
  "Rewrite the baseline into a clean, professional, emoji-enhanced Telegram signal.",
  "",
  "Hard rules:",
  "- Every price level and pip value from the baseline MUST appear unchanged. Never invent, round, or drop numbers.",
  "- Keep the order: direction + instrument, entry, SL, TPs, then notes.",
  "- Plain text only (no markdown, no code fences). Short lines, blank lines between sections.",
  "- If notes are present, condense them to one punchy line at the end.",
  "- Output ONLY the final message — no commentary.",
].join("\n");

export async function formatSignalWithAI(signal: Signal): Promise<string> {
  // Deterministic baseline: guaranteed correct numbers and pip math. The AI
  // pass only polishes presentation, so a failure/timeout degrades gracefully.
  const baseline = generateSignalMessage(signal);

  try {
    const client = getOpenAIClient();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    const response = await client.responses.create(
      {
        model: OPENAI_MODEL,
        instructions: FORMATTER_SYSTEM_PROMPT,
        input: [
          "BASELINE MESSAGE:",
          baseline,
          "",
          "RAW SIGNAL DATA:",
          JSON.stringify({
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
          }),
        ].join("\n"),
        reasoning: { effort: "low" },
        max_output_tokens: 1200,
      },
      { signal: controller.signal },
    );

    clearTimeout(timeoutId);

    const message = response.output_text?.trim();

    if (!message) {
      return baseline;
    }

    return message;
  } catch {
    return baseline;
  }
}
