/**
 * Per-trade emotion vocabulary — shared by the trade form, display chips,
 * filters, and the AI-insights analyzer. Single source of truth so the Zod
 * enum, the dropdowns, and the chip colors never drift apart.
 *
 * Option set + ordering (positive → neutral → warning → negative) is derived
 * from cross-journal research (TraderSync's dropdown + the shared
 * Edgewonk / TradeZella / TradesViz vocabulary).
 */

export type EmotionTone = "pos" | "warn" | "neg" | "muted";

/**
 * Canonical, order-preserving list of emotion values. Kept as a `readonly`
 * tuple so it can back a `z.enum(...)` directly.
 */
export const EMOTION_VALUES = [
  "calm",
  "confident",
  "disciplined",
  "neutral",
  "excited",
  "overconfident",
  "anxious",
  "fearful",
  "greedy",
  "fomo",
  "revenge",
  "frustrated",
] as const;

export type EmotionState = (typeof EMOTION_VALUES)[number];

export interface EmotionOption {
  readonly value: EmotionState;
  readonly label: string;
  readonly emoji: string;
  readonly tone: EmotionTone;
}

/** Display metadata (emoji + label + chip tone) for each emotion, in picker order. */
export const EMOTIONS: readonly EmotionOption[] = [
  { value: "calm", label: "Calm", emoji: "😌", tone: "pos" },
  { value: "confident", label: "Confident", emoji: "😎", tone: "pos" },
  { value: "disciplined", label: "Disciplined", emoji: "🧘", tone: "pos" },
  { value: "neutral", label: "Neutral", emoji: "😐", tone: "muted" },
  { value: "excited", label: "Excited", emoji: "🤩", tone: "warn" },
  { value: "overconfident", label: "Overconfident", emoji: "😏", tone: "warn" },
  { value: "anxious", label: "Anxious", emoji: "😟", tone: "neg" },
  { value: "fearful", label: "Fearful", emoji: "😨", tone: "neg" },
  { value: "greedy", label: "Greedy", emoji: "🤑", tone: "neg" },
  { value: "fomo", label: "FOMO", emoji: "🏃", tone: "neg" },
  { value: "revenge", label: "Revenge", emoji: "😡", tone: "neg" },
  { value: "frustrated", label: "Frustrated", emoji: "😤", tone: "neg" },
] as const;

/** value → option lookup for O(1) label/tone resolution when rendering. */
export const EMOTION_MAP: Readonly<Record<EmotionState, EmotionOption>> =
  Object.fromEntries(EMOTIONS.map((e) => [e.value, e])) as Record<
    EmotionState,
    EmotionOption
  >;

/**
 * Maps an emotion tone to a `Badge` variant so chips are colored consistently
 * with the brand functional palette (pos/warn/neg tokens).
 */
export const EMOTION_TONE_BADGE: Readonly<
  Record<EmotionTone, "success" | "warning" | "destructive" | "secondary">
> = {
  pos: "success",
  warn: "warning",
  neg: "destructive",
  muted: "secondary",
};

/** Human label for a stored emotion value, or null when unset/unknown. */
export function emotionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return EMOTION_MAP[value as EmotionState]?.label ?? null;
}
