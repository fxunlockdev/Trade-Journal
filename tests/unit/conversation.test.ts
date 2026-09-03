import { describe, expect, it } from "vitest";
import {
  nextStage,
  promptFor,
  applyText,
  applyButton,
  encodeAnswer,
  decodeAnswer,
  effectiveDraft,
  describeConversation,
  parseFieldEdit,
  EMPTY_CONVERSATION,
  type Conversation,
} from "@/lib/telegram/conversation";
import type { TradeDraft } from "@/lib/telegram/trade-intent";

const NOW = new Date("2026-09-04T09:00:00Z");
const ID = "aB3_x-9Q";

const draft = (o: Partial<TradeDraft> = {}): TradeDraft => ({
  instrument: "XAUUSD",
  asset_type: "metal",
  direction: "buy",
  entry_price: 3340,
  entry_price_high: null,
  stop_loss: 3335,
  tp1: 3350, tp2: null, tp3: null, tp4: null, tp5: null, tp6: null, tp7: null,
  tp4_trailing: false,
  outcome: { kind: "closed_at", exit_price: 3348 },
  entry_time: NOW.toISOString(),
  dated_from_text: false,
  date_label: null,
  lots: null,
  message: "XAUUSD buy 3340 sl 3335 tp1 3350 closed 3348",
  ...o,
});

const ctx = { recentLots: [0.5, 1, 0.1], topTags: ["scalp", "london"] };

describe("which question comes next", () => {
  it("asks for size, then date, then the optional three, then the journal", () => {
    const c: Conversation = { answers: {} };
    expect(nextStage(draft(), c, false)).toBe("size");
    expect(nextStage(draft(), { answers: { lots: 0.5 } }, false)).toBe("date");
    expect(nextStage(draft(), { answers: { lots: 0.5, entry_time: "x" } }, false)).toBe("emotion");
    expect(nextStage(draft(), { answers: { lots: 0.5, entry_time: "x", emotion: null } }, false)).toBe("tags");
    expect(nextStage(draft(), { answers: { lots: 0.5, entry_time: "x", emotion: null, tags: [] } }, false)).toBe("notes");
    expect(
      nextStage(draft(), { answers: { lots: 0.5, entry_time: "x", emotion: null, tags: [], notes: null } }, false),
    ).toBe("journal");
  });

  it("skips what the message already carried", () => {
    expect(nextStage(draft({ lots: 0.5 }), EMPTY_CONVERSATION, false)).toBe("date");
    expect(nextStage(draft({ lots: 0.5, dated_from_text: true }), EMPTY_CONVERSATION, false)).toBe("emotion");
  });

  it("in quick mode only the required two are asked", () => {
    expect(nextStage(draft(), EMPTY_CONVERSATION, true)).toBe("size");
    expect(nextStage(draft({ lots: 0.5, dated_from_text: true }), EMPTY_CONVERSATION, true)).toBe("journal");
  });
});

describe("prompts", () => {
  it("offers the sizes this person used, and remembers what it offered", () => {
    const { prompt, conversation } = promptFor("size", ID, EMPTY_CONVERSATION, ctx);
    expect(prompt.buttons.map((b) => b.text)).toEqual(["0.5 lots", "1 lot", "0.1 lots"]);
    expect(conversation.offeredLots).toEqual([0.5, 1, 0.1]);
    expect(prompt.perRow).toBe(3);
  });

  it("asks for a size in words when there is no history", () => {
    const { prompt } = promptFor("size", ID, EMPTY_CONVERSATION, { recentLots: [], topTags: [] });
    expect(prompt.buttons).toHaveLength(0);
    expect(prompt.text).toMatch(/0\.5/);
  });

  it("offers every mood plus Skip, three to a row", () => {
    const { prompt } = promptFor("emotion", ID, EMPTY_CONVERSATION, ctx);
    expect(prompt.buttons).toHaveLength(13);
    expect(prompt.buttons.at(-1)?.text).toBe("Skip");
    expect(prompt.perRow).toBe(3);
    expect(prompt.buttons.every((b) => b.callback_data.length <= 64)).toBe(true);
  });

  it("offers the person's top tags by index", () => {
    const { prompt, conversation } = promptFor("tags", ID, EMPTY_CONVERSATION, ctx);
    expect(prompt.buttons.map((b) => b.text)).toEqual(["scalp", "london", "Skip"]);
    expect(decodeAnswer(prompt.buttons[1].callback_data)).toEqual({ pendingId: ID, field: "t", value: "1" });
    expect(conversation.offeredTags).toEqual(["scalp", "london"]);
  });
});

describe("typed answers", () => {
  it("reads a size in lots, with or without the word", () => {
    expect(applyText("size", "0.5", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { lots: 0.5 } } });
    expect(applyText("size", "2 lots", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { lots: 2 } } });
    expect(applyText("size", "half", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false });
    expect(applyText("size", "-1", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false });
    expect(applyText("size", "5000", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false });
  });

  it("reads a date, refuses the future, keeps the relative word", () => {
    const r = applyText("date", "28 aug", EMPTY_CONVERSATION, NOW);
    expect(r.ok && r.conversation.answers.entry_time?.slice(0, 10)).toBe("2026-08-28");
    expect(r.ok && r.conversation.answers.date_label).toBeNull();
    const y = applyText("date", "yesterday", EMPTY_CONVERSATION, NOW);
    expect(y.ok && y.conversation.answers.date_label).toBe("yesterday");
    expect(applyText("date", "on 06/09", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false });
    expect(applyText("date", "dunno", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false });
  });

  it("reads a mood or a skip", () => {
    expect(applyText("emotion", "Calm", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { emotion: "calm" } } });
    expect(applyText("emotion", "skip", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { emotion: null } } });
    expect(applyText("emotion", "meh", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false });
  });

  it("reads comma-separated tags, de-duplicated, or a skip", () => {
    expect(applyText("tags", "scalp, London , scalp", EMPTY_CONVERSATION, NOW)).toMatchObject({
      ok: true,
      conversation: { answers: { tags: ["scalp", "London"] } },
    });
    expect(applyText("tags", "none", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { tags: [] } } });
    expect(applyText("tags", "a".repeat(31), EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false });
  });

  it("reads notes or a skip", () => {
    expect(applyText("notes", "held through news", EMPTY_CONVERSATION, NOW)).toMatchObject({
      ok: true,
      conversation: { answers: { notes: "held through news" } },
    });
    expect(applyText("notes", "-", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { notes: null } } });
  });
});

describe("tapped answers", () => {
  const offered: Conversation = { answers: {}, offeredLots: [0.5, 1], offeredTags: ["scalp"] };

  it("accepts only a size that was offered", () => {
    expect(applyButton("size", { pendingId: ID, field: "s", value: "0.5" }, offered, NOW)).toMatchObject({ ok: true });
    // A crafted button naming a size never offered is refused.
    expect(applyButton("size", { pendingId: ID, field: "s", value: "50" }, offered, NOW)).toMatchObject({ ok: false });
  });

  it("resolves today and yesterday against now", () => {
    const y = applyButton("date", { pendingId: ID, field: "d", value: "yesterday" }, offered, NOW);
    expect(y.ok && y.conversation.answers.entry_time).toBe(new Date(NOW.getTime() - 86_400_000).toISOString());
  });

  it("cannot skip a required question", () => {
    expect(applyButton("size", { pendingId: ID, field: "k", value: "size" }, offered, NOW)).toMatchObject({ ok: false });
    expect(applyButton("emotion", { pendingId: ID, field: "k", value: "emotion" }, offered, NOW)).toMatchObject({
      ok: true,
      conversation: { answers: { emotion: null } },
    });
  });

  it("ignores a Skip from an earlier question", () => {
    // The mood prompt's Skip, tapped after the tags question opened, must not
    // skip the tags.
    const r = applyButton("tags", { pendingId: ID, field: "k", value: "emotion" }, offered, NOW);
    expect(r).toMatchObject({ ok: false, hint: "" });
    const { prompt } = promptFor("emotion", ID, EMPTY_CONVERSATION, ctx);
    expect(decodeAnswer(prompt.buttons.at(-1)?.callback_data)).toEqual({ pendingId: ID, field: "k", value: "emotion" });
  });

  it("de-duplicates tags regardless of case and shows a long note cut short", () => {
    expect(applyText("tags", "Scalp, scalp, SCALP, london", EMPTY_CONVERSATION, NOW)).toMatchObject({
      ok: true,
      conversation: { answers: { tags: ["Scalp", "london"] } },
    });
    const long = "x".repeat(400);
    const text = describeConversation(draft(), { lots: 1, notes: long });
    expect(text).toContain("x".repeat(300) + "…");
    expect(text).not.toContain("x".repeat(301));
    expect(applyText("notes", "y".repeat(1001), EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false });
  });

  it("says 1 lot, not 1 lots", () => {
    const { prompt } = promptFor("size", ID, EMPTY_CONVERSATION, { recentLots: [1, 0.5], topTags: [] });
    expect(prompt.buttons.map((b) => b.text)).toEqual(["1 lot", "0.5 lots"]);
  });

  it("reads a named field edit", () => {
    expect(parseFieldEdit("date 28 aug")).toEqual({ stage: "date", value: "28 aug" });
    expect(parseFieldEdit("Size: 0.5")).toEqual({ stage: "size", value: "0.5" });
    expect(parseFieldEdit("mood calm")).toEqual({ stage: "emotion", value: "calm" });
    expect(parseFieldEdit("tags scalp, london")).toEqual({ stage: "tags", value: "scalp, london" });
    expect(parseFieldEdit("notes held it")).toEqual({ stage: "notes", value: "held it" });
    expect(parseFieldEdit("thanks a lot")).toBeNull();
    expect(parseFieldEdit("0.5")).toBeNull();
  });

  it("resolves a tag by the index it was offered at", () => {
    expect(applyButton("tags", { pendingId: ID, field: "t", value: "0" }, offered, NOW)).toMatchObject({
      ok: true,
      conversation: { answers: { tags: ["scalp"] } },
    });
    expect(applyButton("tags", { pendingId: ID, field: "t", value: "7" }, offered, NOW)).toMatchObject({ ok: false });
  });

  it("ignores a button from a question that has moved on", () => {
    const r = applyButton("notes", { pendingId: ID, field: "e", value: "calm" }, offered, NOW);
    expect(r).toMatchObject({ ok: false, hint: "" });
  });
});

describe("callback data", () => {
  it("round-trips and stays inside the cap", () => {
    for (const [f, v] of [["s", "0.5"], ["d", "today"], ["e", "overconfident"], ["t", "3"], ["k", "emotion"]] as const) {
      const data = encodeAnswer(ID, f, v);
      expect(data.length).toBeLessThanOrEqual(64);
      expect(decodeAnswer(data)).toEqual({ pendingId: ID, field: f, value: v });
    }
  });

  it("rejects what it never emits", () => {
    expect(decodeAnswer("trd:aB3_x-9Q:0")).toBeNull();
    expect(decodeAnswer("ans:short:s:1")).toBeNull();
    expect(decodeAnswer("ans:aB3_x-9Q:z:1")).toBeNull();
    expect(decodeAnswer("ans:aB3_x-9Q:e:<b>x</b>")).toBeNull();
  });
});

describe("the result", () => {
  it("folds the answers into the draft and the summary", () => {
    const a = { lots: 0.5, entry_time: "2026-08-28T12:00:00.000Z", date_label: null, emotion: "calm" as const, tags: ["scalp"], notes: "clean" };
    const d = effectiveDraft(draft(), a);
    expect(d.lots).toBe(0.5);
    expect(d.entry_time).toBe("2026-08-28T12:00:00.000Z");
    expect(d.dated_from_text).toBe(true);
    const text = describeConversation(draft(), a);
    expect(text).toContain("0.5 lots");
    expect(text).toContain("2026-08-28");
    expect(text).toContain("Mood: calm");
    expect(text).toContain("Tags: scalp");
    expect(text).toContain("Notes: clean");
  });

  it("leaves a typed date alone when no date was answered", () => {
    const d = effectiveDraft(draft({ dated_from_text: true, entry_time: "2026-08-20T12:00:00.000Z" }), { lots: 1 });
    expect(d.entry_time).toBe("2026-08-20T12:00:00.000Z");
  });
});

describe("how people actually answer", () => {
  it("finds the mood inside a short sentence, longest word first", () => {
    expect(applyText("emotion", "felt calm", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { emotion: "calm" } } });
    expect(applyText("emotion", "a bit anxious tbh", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { emotion: "anxious" } } });
    expect(applyText("emotion", "was overconfident", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { emotion: "overconfident" } } });
  });

  it("reads hashtags as tags", () => {
    expect(applyText("tags", "#scalp #london", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { tags: ["scalp", "london"] } } });
  });

  it("treats a decline in chat as a skip on a skippable question, never as the answer", () => {
    for (const t of ["no", "thanks", "ok", "nah!", "nothing"]) {
      expect(applyText("notes", t, EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { notes: null } } });
      expect(applyText("tags", t, EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { answers: { tags: [] } } });
    }
    expect(applyText("size", "no", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false });
  });
});

describe("confirming a trade read from plain words", () => {
  it("comes before every other question, and only for prose", () => {
    expect(nextStage(draft({ read_from_prose: true, lots: 0.5, dated_from_text: true }), EMPTY_CONVERSATION, true)).toBe("confirm");
    expect(nextStage(draft({ read_from_prose: true }), { answers: {}, confirmed: true }, false)).toBe("size");
    expect(nextStage(draft(), EMPTY_CONVERSATION, false)).toBe("size");
  });

  it("offers yes and no", () => {
    const { prompt } = promptFor("confirm", ID, EMPTY_CONVERSATION, ctx);
    expect(prompt.buttons.map((b) => b.text)).toEqual(["Yes, that's right", "No, cancel"]);
    expect(decodeAnswer(prompt.buttons[1].callback_data)).toEqual({ pendingId: ID, field: "c", value: "no" });
  });

  it("reads yes, no and anything else", () => {
    expect(applyText("confirm", "yep", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { confirmed: true } });
    expect(applyText("confirm", "no", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false, cancel: true });
    expect(applyText("confirm", "maybe", EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false });
    expect(applyButton("confirm", { pendingId: ID, field: "c", value: "yes" }, EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: true, conversation: { confirmed: true } });
    expect(applyButton("size", { pendingId: ID, field: "c", value: "yes" }, EMPTY_CONVERSATION, NOW)).toMatchObject({ ok: false, hint: "" });
  });
});
