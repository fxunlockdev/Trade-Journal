import type { Signal } from "@/types/database";
import { generateSignalMessage } from "./templates";

export async function formatSignalWithAI(
  signal: Signal,
  openaiApiKey?: string,
): Promise<string> {
  const apiKey = openaiApiKey ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return generateSignalMessage(signal);
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a trading signal formatter for Telegram. Format the signal data into a clean, professional Telegram message using Markdown. Include emojis for visual clarity. Keep it concise.",
          },
          {
            role: "user",
            content: `Format this trading signal for Telegram:\n${JSON.stringify(signal, null, 2)}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.3,
      },
      { signal: controller.signal },
    );

    clearTimeout(timeout);

    const content = response.choices[0]?.message?.content;
    return content ?? generateSignalMessage(signal);
  } catch {
    return generateSignalMessage(signal);
  }
}
