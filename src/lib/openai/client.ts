import OpenAI from "openai";

/**
 * Single model for every AI surface (chat logging, insights, signal
 * formatting). GPT-5.4-mini is a reasoning model on the Responses API:
 * it does NOT accept `temperature` / `top_p` — send `reasoning.effort`
 * instead, and budget `max_output_tokens` to cover reasoning + output.
 */
export const OPENAI_MODEL = "gpt-5.4-mini";

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Add it to your environment variables.",
    );
  }

  return new OpenAI({ apiKey });
}
