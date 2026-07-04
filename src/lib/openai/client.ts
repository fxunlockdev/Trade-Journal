import OpenAI from "openai";

/**
 * Single model for every AI surface (chat logging, insights, signal
 * formatting). Overridable via env so the model can be swapped (or rolled
 * back to a known-good one like `gpt-4o-mini`) without a code change.
 *
 * Two model families are supported transparently — see `modelTuning`:
 *  - Reasoning models (gpt-5.x, o1/o3/o4): use `reasoning.effort`, reject
 *    `temperature`, and need a larger `max_output_tokens` (reasoning tokens
 *    count against it).
 *  - Standard models (gpt-4o, gpt-4o-mini, gpt-4.1): use `temperature`,
 *    reject `reasoning`.
 */
export const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "o4-mini";

/**
 * The SDK default request timeout is 10 MINUTES with 2 automatic retries.
 * A slow or stuck reasoning call therefore hangs the caller (and the UI
 * skeleton) for minutes instead of failing fast. Cap it hard: one retry,
 * and a per-request timeout the individual calls can tighten further.
 */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;

/**
 * Reasoning models take `reasoning.effort` and reject `temperature`; standard
 * chat models are the opposite. Detect by id so the same call site works for
 * whatever `OPENAI_MODEL` is set to.
 */
export function isReasoningModel(model: string = OPENAI_MODEL): boolean {
  const m = model.toLowerCase();
  return (
    m.startsWith("gpt-5") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4")
  );
}

type ReasoningEffort = "low" | "medium" | "high";

/**
 * Returns the model-appropriate tuning params to spread into a
 * `responses.create` call. Send an `effort` (used by reasoning models) AND a
 * `temperature` (used by standard models); only the relevant one is emitted.
 */
export function modelTuning(opts: {
  readonly effort: ReasoningEffort;
  readonly temperature: number;
  readonly model?: string;
}): { reasoning: { effort: ReasoningEffort } } | { temperature: number } {
  if (isReasoningModel(opts.model)) {
    return { reasoning: { effort: opts.effort } };
  }
  return { temperature: opts.temperature };
}

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
