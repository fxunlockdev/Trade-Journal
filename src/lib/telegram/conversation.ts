/**
 * The questions the bot asks before it saves, and how it reads the answers.
 *
 * A message rarely carries everything the journal's form asks for. Rather than
 * fill the gaps with defaults -- which is how a gold trade got saved as one
 * ounce -- the bot asks, one question at a time, with buttons where the
 * answer is usually one of a few things. Size and date are required. Mood,
 * tags and notes are offered with Skip, and /quick turns them off for a
 * person who wants speed.
 *
 * Pure. The state is a small object stored with the draft; every transition
 * here is a unit test. Nothing here sends or writes.
 */

import { EMOTION_VALUES, type EmotionState } from "@/lib/constants/emotions";
import { parsePrice } from "@/lib/trades/parse-price";
import { parseTradeDate } from "@/lib/trades/trade-date";
import { describeDraft, type TradeDraft } from "@/lib/telegram/trade-intent";
import type { InlineButton } from "@/lib/telegram/chat";

export type Stage = "size" | "date" | "emotion" | "tags" | "notes" | "journal";

/** What has been answered. `undefined` = not asked yet; `null`/`[]` = skipped. */
export interface Answers {
  readonly lots?: number;
  readonly entry_time?: string;
  readonly date_label?: string | null;
  readonly emotion?: EmotionState | null;
  readonly tags?: readonly string[];
  readonly notes?: string | null;
}

export interface Conversation {
  readonly answers: Answers;
  /** Offered as buttons, so a tap can carry an index rather than the text. */
  readonly offeredLots?: readonly number[];
  readonly offeredTags?: readonly string[];
  /** Every question answered and the journal picker shown. Only then may a
   *  journal tap save; a picker from before the questions cannot. */
  readonly ready?: boolean;
}

export const EMPTY_CONVERSATION: Conversation = { answers: {} };

/** Buttons per row for each prompt; one per row is unreadable for twelve moods. */
const PER_ROW: Record<Stage, number> = {
  size: 3, date: 2, emotion: 3, tags: 2, notes: 1, journal: 1,
};

/** A skip, on a question that can be skipped. "no", "thanks" and "ok" are
 *  how people decline a question in chat; they are never a note or a tag. */
const SKIP_WORDS =
  /^(?:skip|none|no|nah|nope|-|nothing|n\/a|na|ok(?:ay)?|thanks?|thank you|thx|ty|cool|fine|nvm)[!. ]*$/i;
const MAX_LOTS = 1000;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;
/** Well under the row's 5000 and Telegram's 4096-character message, since the
 *  note is echoed back in the summary before the picker. */
const MAX_NOTES_LENGTH = 1000;
/** How much of a note the summary shows; the row keeps all of it. */
const NOTES_SHOWN = 300;
/** How long a draft stays alive, extended on every answer. */
export const PENDING_TTL_MINUTES = 30;
const DAY_MS = 24 * 3600 * 1000;

/** The next question, or "journal" when there is nothing left to ask. */
export function nextStage(draft: TradeDraft, c: Conversation, quick: boolean): Stage {
  const a = c.answers;
  if (draft.lots === null && a.lots === undefined) return "size";
  if (!draft.dated_from_text && a.entry_time === undefined) return "date";
  if (!quick) {
    if (a.emotion === undefined) return "emotion";
    if (a.tags === undefined) return "tags";
    if (a.notes === undefined) return "notes";
  }
  return "journal";
}

/* ────────────────────────── callback data ────────────────────────── */

export type AnswerField = "s" | "d" | "e" | "t" | "k";

export interface AnswerTap {
  readonly pendingId: string;
  readonly field: AnswerField;
  readonly value: string;
}

/**
 * "ans:<pending>:<field>:<value>". The longest is an emotion,
 * "ans:xxxxxxxx:e:overconfident" at 28 characters, inside Telegram's 64.
 */
export function encodeAnswer(pendingId: string, field: AnswerField, value = ""): string {
  return value ? `ans:${pendingId}:${field}:${value}` : `ans:${pendingId}:${field}`;
}

const PENDING_ID_RE = /^[A-Za-z0-9_-]{8}$/;

export function decodeAnswer(data: string | undefined): AnswerTap | null {
  if (!data) return null;
  const parts = data.split(":");
  if (parts.length < 3 || parts.length > 4 || parts[0] !== "ans") return null;
  const [, pendingId, field, value = ""] = parts;
  if (!PENDING_ID_RE.test(pendingId)) return null;
  if (!/^[sdetk]$/.test(field)) return null;
  if (!/^[A-Za-z0-9_.-]{0,20}$/.test(value)) return null;
  return { pendingId, field: field as AnswerField, value };
}

/* ────────────────────────── prompts ────────────────────────── */

export interface Prompt {
  readonly text: string;
  readonly buttons: readonly InlineButton[];
  readonly perRow: number;
}

export interface PromptContext {
  /** Sizes this person used before, most recent first. */
  readonly recentLots: readonly number[];
  /** Tags this person uses most. */
  readonly topTags: readonly string[];
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The question for a stage, with its buttons, and what to remember about them. */
export function promptFor(
  stage: Exclude<Stage, "journal">,
  pendingId: string,
  c: Conversation,
  ctx: PromptContext,
): { prompt: Prompt; conversation: Conversation } {
  // The stage rides on the Skip button: three consecutive prompts carry one,
  // and a Skip tapped on an earlier prompt must not skip the current question.
  const skip = { text: "Skip", callback_data: encodeAnswer(pendingId, "k", stage) };
  switch (stage) {
    case "size": {
      const lots = ctx.recentLots.slice(0, 3);
      return {
        prompt: {
          text: lots.length > 0
            ? "Size in lots? Tap one, or type a number like 0.5."
            : "Size in lots? Type a number like 0.5.",
          buttons: lots.map((l) => ({ text: `${l} ${l === 1 ? "lot" : "lots"}`, callback_data: encodeAnswer(pendingId, "s", String(l)) })),
          perRow: PER_ROW.size,
        },
        conversation: { ...c, offeredLots: lots },
      };
    }
    case "date":
      return {
        prompt: {
          text: "When was it? Tap, or type a date like 28 aug.",
          buttons: [
            { text: "Today", callback_data: encodeAnswer(pendingId, "d", "today") },
            { text: "Yesterday", callback_data: encodeAnswer(pendingId, "d", "yesterday") },
          ],
          perRow: PER_ROW.date,
        },
        conversation: c,
      };
    case "emotion":
      return {
        prompt: {
          text: "How did it feel taking it?",
          buttons: [
            ...EMOTION_VALUES.map((e) => ({ text: cap(e), callback_data: encodeAnswer(pendingId, "e", e) })),
            skip,
          ],
          perRow: PER_ROW.emotion,
        },
        conversation: c,
      };
    case "tags": {
      const tags = ctx.topTags.slice(0, 6);
      return {
        prompt: {
          text: tags.length > 0
            ? "Tags? Tap one, or type several separated by commas."
            : "Tags? Type them separated by commas, like scalp, london.",
          buttons: [
            ...tags.map((t, i) => ({ text: t, callback_data: encodeAnswer(pendingId, "t", String(i)) })),
            skip,
          ],
          perRow: PER_ROW.tags,
        },
        conversation: { ...c, offeredTags: tags },
      };
    }
    case "notes":
      return {
        prompt: { text: "Any notes? Type them, or skip.", buttons: [skip], perRow: PER_ROW.notes },
        conversation: c,
      };
  }
}

/* ────────────────────────── answers ────────────────────────── */

export type Applied =
  | { readonly ok: true; readonly conversation: Conversation }
  | { readonly ok: false; readonly hint: string };

function withAnswers(c: Conversation, patch: Answers): Applied {
  return { ok: true, conversation: { ...c, answers: { ...c.answers, ...patch } } };
}

function readLots(text: string): number | null {
  const n = parsePrice(text.replace(/\b(?:lots?|lt)\b/i, "").trim());
  return n !== null && n <= MAX_LOTS ? n : null;
}

function readEmotion(text: string): EmotionState | null | undefined {
  const t = text.trim().toLowerCase();
  if (SKIP_WORDS.test(t)) return null;
  // "calm", "felt calm", "a bit anxious tbh": the mood word anywhere in a
  // short reply. The longest match first so "overconfident" beats "confident".
  const byLength = [...EMOTION_VALUES].sort((a, b) => b.length - a.length);
  return byLength.find((e) => new RegExp(`\\b${e}\\b`, "i").test(t));
}

function readTags(text: string): readonly string[] | null {
  const t = text.trim();
  if (SKIP_WORDS.test(t)) return [];
  // "scalp, london" or "#scalp #london": commas, or hashtags on whitespace.
  const parts = t.includes("#") ? t.split(/[\s,]+/) : t.split(",");
  const tags = parts.map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
  if (tags.length === 0 || tags.length > MAX_TAGS) return null;
  if (tags.some((s) => s.length > MAX_TAG_LENGTH)) return null;
  // "Scalp" and "scalp" are one tag, spelled the way it was typed first.
  const seen = new Set<string>();
  return tags.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const FIELD_WORDS: Record<string, Exclude<Stage, "journal">> = {
  size: "size", lot: "size", lots: "size",
  date: "date", when: "date", day: "date",
  mood: "emotion", feel: "emotion", feeling: "emotion", emotion: "emotion",
  tag: "tags", tags: "tags",
  note: "notes", notes: "notes",
};

/**
 * "size 0.5", "date 28 aug", "mood calm", "tags scalp, london", "notes ...":
 * a person changing an answer, at any point before the trade is saved.
 * Without this there was no way back once a question had been answered.
 */
export function parseFieldEdit(text: string): { stage: Exclude<Stage, "journal">; value: string } | null {
  const m = /^([a-z]+)\s*[:=]?\s+([\s\S]+)$/i.exec(text.trim());
  if (!m) return null;
  const stage = FIELD_WORDS[m[1].toLowerCase()];
  return stage ? { stage, value: m[2].trim() } : null;
}

/** A typed reply to the open question. */
export function applyText(stage: Stage, text: string, c: Conversation, now: Date): Applied {
  const t = text.trim();
  switch (stage) {
    case "size": {
      const lots = readLots(t);
      return lots === null
        ? { ok: false, hint: "A number of lots, like 0.5 or 2." }
        : withAnswers(c, { lots });
    }
    case "date": {
      const d = parseTradeDate(t, now);
      if (!d) return { ok: false, hint: "Something like 28 aug, 28/08, today or yesterday." };
      if (d.kind === "future") return { ok: false, hint: `${d.label} is in the future. When was it?` };
      const relative = d.label === "today" || d.label === "yesterday";
      return withAnswers(c, { entry_time: d.iso, date_label: relative ? d.label : null });
    }
    case "emotion": {
      const e = readEmotion(t);
      return e === undefined
        ? { ok: false, hint: `One of: ${EMOTION_VALUES.join(", ")}. Or skip.` }
        : withAnswers(c, { emotion: e });
    }
    case "tags": {
      const tags = readTags(t);
      return tags === null
        ? { ok: false, hint: `Up to ${MAX_TAGS} tags of ${MAX_TAG_LENGTH} characters, separated by commas. Or skip.` }
        : withAnswers(c, { tags });
    }
    case "notes":
      if (SKIP_WORDS.test(t)) return withAnswers(c, { notes: null });
      return t.length > MAX_NOTES_LENGTH
        ? { ok: false, hint: `Notes can be ${MAX_NOTES_LENGTH} characters at most.` }
        : withAnswers(c, { notes: t });
    case "journal":
      return { ok: false, hint: "Pick a journal with the buttons on my last message." };
  }
}

/** A tapped button on the open question. */
export function applyButton(stage: Stage, tap: AnswerTap, c: Conversation, now: Date): Applied {
  if (tap.field === "k") {
    // Only the Skip of the question that is open. An older prompt's Skip is
    // a button from a question that has moved on.
    if (tap.value !== stage) return { ok: false, hint: "" };
    if (stage === "emotion") return withAnswers(c, { emotion: null });
    if (stage === "tags") return withAnswers(c, { tags: [] });
    if (stage === "notes") return withAnswers(c, { notes: null });
    return { ok: false, hint: "That one can't be skipped." };
  }
  if (stage === "size" && tap.field === "s") {
    if (!/^\d+(?:\.\d+)?$/.test(tap.value)) return { ok: false, hint: "Type the size in lots, like 0.5." };
    const lots = readLots(tap.value);
    // Only a size that was offered, so a crafted button cannot pick a number
    // this person never used.
    if (lots === null || !(c.offeredLots ?? []).includes(lots)) {
      return { ok: false, hint: "Type the size in lots, like 0.5." };
    }
    return withAnswers(c, { lots });
  }
  if (stage === "date" && tap.field === "d") {
    if (tap.value === "today") return withAnswers(c, { entry_time: now.toISOString(), date_label: "today" });
    if (tap.value === "yesterday") {
      return withAnswers(c, { entry_time: new Date(now.getTime() - DAY_MS).toISOString(), date_label: "yesterday" });
    }
    return { ok: false, hint: "Type a date like 28 aug." };
  }
  if (stage === "emotion" && tap.field === "e") {
    const e = readEmotion(tap.value);
    return e ? withAnswers(c, { emotion: e }) : { ok: false, hint: "Tap one of the moods, or skip." };
  }
  if (stage === "tags" && tap.field === "t") {
    const tag = /^\d{1,2}$/.test(tap.value) ? (c.offeredTags ?? [])[Number(tap.value)] : undefined;
    return tag ? withAnswers(c, { tags: [tag] }) : { ok: false, hint: "Type the tags separated by commas, or skip." };
  }
  // A button from an earlier question, tapped again after the conversation
  // moved on. Nothing to apply; the caller re-sends the open question.
  return { ok: false, hint: "" };
}

/* ────────────────────────── the result ────────────────────────── */

/** The draft with the answers folded in: what gets summarised and saved. */
export function effectiveDraft(draft: TradeDraft, a: Answers): TradeDraft {
  return {
    ...draft,
    lots: a.lots ?? draft.lots,
    entry_time: a.entry_time ?? draft.entry_time,
    dated_from_text: draft.dated_from_text || a.entry_time !== undefined,
    date_label: a.entry_time !== undefined ? (a.date_label ?? null) : draft.date_label,
  };
}

/** The full summary a person confirms before picking a journal. */
export function describeConversation(draft: TradeDraft, a: Answers): string {
  const lines = [describeDraft(effectiveDraft(draft, a))];
  if (a.emotion) lines.push(`Mood: ${a.emotion}`);
  if (a.tags && a.tags.length > 0) lines.push(`Tags: ${a.tags.join(", ")}`);
  if (a.notes) {
    lines.push(`Notes: ${a.notes.length > NOTES_SHOWN ? `${a.notes.slice(0, NOTES_SHOWN)}…` : a.notes}`);
  }
  return lines.join("\n");
}
