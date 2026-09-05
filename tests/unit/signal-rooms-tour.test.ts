import { describe, expect, it } from "vitest";
import {
  SETUP_STEPS, SIGNAL_ROOMS_TOUR_SEEN_KEY, hasSeenSignalRoomsTour, markSignalRoomsTourSeen, setupStage, signalRoomsTourSteps,
} from "@/lib/tour/signal-rooms-steps";
import { visibleSteps } from "@/lib/tour/steps";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}
const hostileStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

describe("the signal rooms tour", () => {
  it("tells the story in the order a person does it", () => {
    expect(signalRoomsTourSteps("@bot").map((s) => s.id)).toEqual(["what", "bot", "code", "journal", "watch"]);
  });

  it("names the bot to add, and points only at the card's own parts", () => {
    const steps = signalRoomsTourSteps("@TradingJournalImageBot");
    expect(steps.find((s) => s.id === "bot")?.body).toContain("@TradingJournalImageBot");
    for (const s of steps) expect(s.target.startsWith("signal-rooms")).toBe(true);
  });

  it("drops the step about connected rooms when none is connected yet", () => {
    const onPage = new Set(["signal-rooms", "signal-rooms-step-bot", "signal-rooms-connect", "signal-rooms-step-journal"]);
    expect(visibleSteps(signalRoomsTourSteps("@bot"), (t) => onPage.has(t)).map((s) => s.id)).toEqual(["what", "bot", "code", "journal"]);
  });

  it("is offered once per browser, and never re-offers itself when storage is broken", () => {
    const store = fakeStorage();
    expect(hasSeenSignalRoomsTour(store)).toBe(false);
    markSignalRoomsTourSeen(store);
    expect(store.getItem(SIGNAL_ROOMS_TOUR_SEEN_KEY)).toBe("1");
    expect(hasSeenSignalRoomsTour(store)).toBe(true);
    expect(hasSeenSignalRoomsTour(hostileStorage)).toBe(true);
    expect(() => markSignalRoomsTourSeen(hostileStorage)).not.toThrow();
  });
});

describe("the setup checklist", () => {
  it("has a step for each thing a person does, each with a place for the tour to point", () => {
    expect(SETUP_STEPS.map((s) => s.id)).toEqual(["bot", "code", "room", "journal"]);
    expect(SETUP_STEPS.every((s) => s.tour.startsWith("signal-rooms-step-"))).toBe(true);
  });

  it("highlights the next real thing to do", () => {
    const base = { hasFeeds: false, codeOut: false, hasCandidates: false, drafting: false };
    expect(setupStage(base)).toBe(0);
    expect(setupStage({ ...base, codeOut: true })).toBe(1);
    expect(setupStage({ ...base, codeOut: true, hasCandidates: true })).toBe(2);
    expect(setupStage({ ...base, hasCandidates: true, drafting: true })).toBe(3);
  });

  it("is done once a room is connected, and reopens for the next one", () => {
    expect(setupStage({ hasFeeds: true, codeOut: false, hasCandidates: false, drafting: false })).toBe("done");
    expect(setupStage({ hasFeeds: true, codeOut: true, hasCandidates: false, drafting: false })).toBe(1);
    expect(setupStage({ hasFeeds: true, codeOut: false, hasCandidates: true, drafting: false })).toBe(2);
  });
});
