import { describe, expect, it } from "vitest";
import {
  combinedDisclaimerNote,
  contributingJournalCount,
  defaultGroupName,
  GROUP_NAME_MAX,
  groupStorageKey,
  lookbackCutoffIso,
  instrumentOptions,
  perJournalCounts,
  scopeByJournal,
  scopeTrades,
} from "@/lib/posters/scope";
import { computePosterStats } from "@/lib/posters/poster-data";
import { resolvePeriod } from "@/lib/posters/periods";
import type { Trade } from "@/types/database";

let n = 0;
const mk = (journalId: string, instrument: string, pips = 10): Trade =>
  ({
    id: `t${n++}`,
    journal_id: journalId,
    instrument,
    asset_type: "forex",
    direction: "buy",
    entry_price: 1.1,
    exit_price: 1.1 + pips * 0.0001,
    quantity: 10_000,
    fees: 0,
    stop_loss: 1.09,
    pnl_absolute: pips,
    r_multiple: 1,
    entry_time: "2026-08-25T12:00:00Z",
    exit_time: "2026-08-25T13:00:00Z",
  }) as unknown as Trade;

const YOHAN = "j-yohan";
const CHRIS = "j-chris";
const none = new Set<string>();

describe("scopeTrades", () => {
  const trades = [
    mk(YOHAN, "XAUUSD"),
    mk(YOHAN, "EURUSD"),
    mk(CHRIS, "XAUUSD"),
    mk(CHRIS, "GBPUSD"),
  ];

  it("an empty selection means EVERYTHING, not nothing", () => {
    // A filter you can't accidentally empty into a blank poster.
    expect(scopeTrades(trades, none, none)).toHaveLength(4);
  });

  it("narrows to the selected journals", () => {
    const out = scopeTrades(trades, new Set([YOHAN]), none);
    expect(out).toHaveLength(2);
    expect(out.every((t) => t.journal_id === YOHAN)).toBe(true);
  });

  it("combines several journals", () => {
    expect(scopeTrades(trades, new Set([YOHAN, CHRIS]), none)).toHaveLength(4);
  });

  it("narrows to the selected instruments", () => {
    const out = scopeTrades(trades, none, new Set(["XAUUSD"]));
    expect(out).toHaveLength(2);
    expect(out.every((t) => t.instrument === "XAUUSD")).toBe(true);
  });

  it("composes both — the Yohan + Chris on Gold case", () => {
    const out = scopeTrades(
      trades,
      new Set([YOHAN, CHRIS]),
      new Set(["XAUUSD"]),
    );
    expect(out).toHaveLength(2);
    expect(out.every((t) => t.instrument === "XAUUSD")).toBe(true);
    expect(new Set(out.map((t) => t.journal_id))).toEqual(
      new Set([YOHAN, CHRIS]),
    );
  });

  it("returns nothing when the two filters don't intersect", () => {
    expect(
      scopeTrades(trades, new Set([YOHAN]), new Set(["GBPUSD"])),
    ).toHaveLength(0);
  });

  it("scopeByJournal ignores the instrument filter", () => {
    expect(scopeByJournal(trades, new Set([CHRIS]))).toHaveLength(2);
  });
});

describe("instrumentOptions", () => {
  it("offers only what the scoped journals actually traded", () => {
    // Picking Yohan must not offer GBPUSD, which only Chris traded — a filter
    // that returns nothing is worse than no filter.
    const trades = [mk(YOHAN, "XAUUSD"), mk(YOHAN, "EURUSD"), mk(CHRIS, "GBPUSD")];
    const scoped = scopeByJournal(trades, new Set([YOHAN]));
    expect(instrumentOptions(scoped).map((o) => o.value)).toEqual([
      "EURUSD",
      "XAUUSD",
    ]);
  });

  it("de-duplicates and sorts", () => {
    const trades = [mk(YOHAN, "XAUUSD"), mk(CHRIS, "XAUUSD"), mk(YOHAN, "AUDUSD")];
    expect(instrumentOptions(trades).map((o) => o.value)).toEqual([
      "AUDUSD",
      "XAUUSD",
    ]);
  });

  it("is empty-set safe", () => {
    expect(instrumentOptions([])).toEqual([]);
  });
});

describe("groupStorageKey", () => {
  it("is identical to the pre-combining key for a single journal", () => {
    // Names saved before journals could be combined must survive the change.
    expect(groupStorageKey([YOHAN])).toBe(`trdr_poster_group:${YOHAN}`);
  });

  it("is stable however the journals were ticked", () => {
    expect(groupStorageKey([YOHAN, CHRIS])).toBe(groupStorageKey([CHRIS, YOHAN]));
  });

  it("distinguishes different combinations", () => {
    expect(groupStorageKey([YOHAN])).not.toBe(groupStorageKey([YOHAN, CHRIS]));
  });

  it("returns null for an empty selection rather than a keyless entry", () => {
    // "trdr_poster_group:" would be one global bucket shared by every such
    // state, so a name typed in one would leak into another.
    expect(groupStorageKey([])).toBeNull();
  });

  it("does not mutate the caller's array", () => {
    const ids = [CHRIS, YOHAN];
    groupStorageKey(ids);
    expect(ids).toEqual([CHRIS, YOHAN]);
  });
});

describe("perJournalCounts", () => {
  const journals = [
    { id: YOHAN, name: "YOHAN" },
    { id: CHRIS, name: "CHRIS" },
  ];

  it("counts each journal's contribution", () => {
    const trades = [mk(YOHAN, "XAUUSD"), mk(YOHAN, "EURUSD"), mk(CHRIS, "XAUUSD")];
    expect(perJournalCounts(trades, journals)).toEqual([
      { id: YOHAN, name: "YOHAN", count: 2 },
      { id: CHRIS, name: "CHRIS", count: 1 },
    ]);
  });

  it("omits journals that contributed nothing", () => {
    const trades = [mk(YOHAN, "XAUUSD")];
    expect(perJournalCounts(trades, journals).map((j) => j.id)).toEqual([YOHAN]);
  });

  it("the parts always sum to the whole", () => {
    const trades = [
      mk(YOHAN, "XAUUSD"),
      mk(CHRIS, "XAUUSD"),
      mk(CHRIS, "EURUSD"),
    ];
    const total = perJournalCounts(trades, journals).reduce(
      (a, j) => a + j.count,
      0,
    );
    expect(total).toBe(trades.length);
  });
});

describe("combined disclaimer", () => {
  it("says nothing for a single journal", () => {
    expect(combinedDisclaimerNote(1)).toBeNull();
    expect(combinedDisclaimerNote(0)).toBeNull();
  });

  it("states the count when combining", () => {
    expect(combinedDisclaimerNote(2)).toBe("Combined results across 2 journals.");
    expect(combinedDisclaimerNote(3)).toBe("Combined results across 3 journals.");
  });
});

describe("contributingJournalCount", () => {
  it("counts journals actually present, not journals selected", () => {
    // Ticking three journals where only two traded in the period must not
    // claim three on the poster.
    const trades = [mk(YOHAN, "XAUUSD"), mk(CHRIS, "XAUUSD"), mk(YOHAN, "EURUSD")];
    expect(contributingJournalCount(trades)).toBe(2);
    expect(contributingJournalCount([])).toBe(0);
  });
});

describe("combining is just a longer array — the property that makes this safe", () => {
  it("two journals combined equal one journal holding all the same trades", () => {
    const split = [
      mk(YOHAN, "XAUUSD", 30),
      mk(YOHAN, "XAUUSD", -10),
      mk(CHRIS, "XAUUSD", 20),
    ];
    // The same trades as though a single journal had recorded them.
    const merged = split.map(
      (t) => ({ ...t, journal_id: "one" }) as unknown as Trade,
    );

    const combined = computePosterStats(
      scopeTrades(split, new Set([YOHAN, CHRIS]), none),
    );
    const single = computePosterStats(merged);

    expect(combined.pips).toBeCloseTo(single.pips, 6);
    expect(combined.tradeCount).toBe(single.tradeCount);
    expect(combined.wins).toBe(single.wins);
    expect(combined.losses).toBe(single.losses);
    expect(combined.winRate).toBeCloseTo(single.winRate, 6);
    expect(combined.avgR).toBeCloseTo(single.avgR as number, 6);
  });

  it("scoping to one journal matches that journal computed alone", () => {
    const all = [mk(YOHAN, "XAUUSD", 30), mk(CHRIS, "XAUUSD", 999)];
    const scopedStats = computePosterStats(
      scopeTrades(all, new Set([YOHAN]), none),
    );
    const alone = computePosterStats([all[0]]);
    expect(scopedStats.pips).toBeCloseTo(alone.pips, 6);
    expect(scopedStats.tradeCount).toBe(1);
  });
});

describe("defaultGroupName", () => {
  const j = (name: string) => ({ name });

  it("uses the journal's own name when there is one", () => {
    expect(defaultGroupName([j("YOHAN")])).toBe("YOHAN");
  });

  it("joins a small combination, so nothing has to be typed", () => {
    // A placeholder dash would ship a poster that looks broken.
    expect(defaultGroupName([j("YOHAN"), j("CHRIS")])).toBe("YOHAN + CHRIS");
    expect(defaultGroupName([j("A"), j("B"), j("C")])).toBe("A + B + C");
  });

  it("becomes a count past three — the field is a headline, not a list", () => {
    expect(defaultGroupName([j("A"), j("B"), j("C"), j("D")])).toBe("4 journals");
  });

  it("falls back to a count when the joined names would overflow", () => {
    // Journal names are allowed 60 characters each, so a join of three can
    // reach ~186 — far past what the poster header can set.
    const long = defaultGroupName([
      j("Yohan — FTMO 200k Swing Challenge Phase 2"),
      j("Chris — MyForexFunds Rapid Account"),
    ]);
    expect(long).toBe("2 journals");
    expect(long.length).toBeLessThanOrEqual(GROUP_NAME_MAX);
  });

  it("still joins names that comfortably fit", () => {
    expect(defaultGroupName([j("YOHAN"), j("CHRIS")])).toBe("YOHAN + CHRIS");
  });

  it("is empty when nothing is selected", () => {
    expect(defaultGroupName([])).toBe("");
  });
});

describe("lookbackCutoffIso", () => {
  it("is exactly N days before the given moment", () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    expect(lookbackCutoffIso(120, now)).toBe("2026-04-27T12:00:00.000Z");
  });

  it("reaches back further than the earliest day any period can select", () => {
    // Tied to the real period maths rather than restating the arithmetic:
    // whatever "last month" resolves to must sit inside the read window, on
    // the worst-case date (the 1st, when last month is furthest away).
    for (const iso of [
      "2026-03-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-05-01T00:00:00.000Z",
    ]) {
      const now = new Date(iso);
      const cutoff = new Date(lookbackCutoffIso(75, now));
      const earliest = resolvePeriod("last-month", now).firstDay;
      expect(
        earliest.getTime(),
        `last month starts before the read window on ${iso}`,
      ).toBeGreaterThan(cutoff.getTime());
    }
  });
});
