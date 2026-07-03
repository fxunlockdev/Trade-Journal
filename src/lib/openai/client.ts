import OpenAI from "openai";

/**
 * Single model for every AI surface (chat logging, insights, signal
 * formatting). GPT-5.4-mini is a reasoning model on the Responses API:
 * it does NOT accept `temperature` / `top_p` — send `reasoning.effort`
 * instead, and budget `max_output_tokens` to cover reasoning + output.
 *
 * Overridable via env so the model can be swapped (or rolled back to a
 * known-good one like `gpt-4o-mini`) without a code change / redeploy.
 */
export const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";

/**
 * The SDK default request timeout is 10 MINUTES with 2 automatic retries.
 * A slow or stuck reasoning call therefore hangs the caller (and the UI
 * skeleton) for minutes instead of failing fast. Cap it hard: one retry,
 * and a per-request timeout the individual calls can tighten further.
 */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Add it to your environment variables.",
    );
  }

  return new OpenAI({
    apiKey,
    timeout: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
  });
}
