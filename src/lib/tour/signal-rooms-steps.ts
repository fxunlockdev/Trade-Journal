/**
 * The Signal rooms tour: how a room becomes a journal the bot fills.
 *
 * Two layers share this file. The spotlight steps, shown once and replayable,
 * explain the idea; the setup stage drives a checklist inside the card that
 * follows what the person has actually done, so the next thing to do is
 * always the highlighted one. Both are plain data or pure functions so the
 * copy, the order and the stage logic are unit-tested without a browser.
 */

import type { TourStep } from "@/lib/tour/steps";

export function signalRoomsTourSteps(botHandle: string): readonly TourStep[] {
  return [
    {
      id: "what",
      target: "signal-rooms",
      title: "Trades logged straight from Telegram",
      body: "Connect a signal room to a journal and the bot logs every signal posted there as a trade, applies the result replies, and marks each message it logged with ✍. Traders change nothing.",
      placement: "left",
    },
    {
      id: "bot",
      target: "signal-rooms-step-bot",
      title: "Put the bot in the room",
      body: `In Telegram, add ${botHandle} to the room and make it an admin. Without admin rights it only hears commands. It never speaks in a room it listens to.`,
      placement: "left",
    },
    {
      id: "code",
      target: "signal-rooms-connect",
      title: "Prove you are in the room",
      body: "Click Connect a room to get a code, then post the code in the room. The bot confirms silently and the room appears here within a few seconds. An admin can delete the code message afterwards.",
      placement: "left",
    },
    {
      id: "journal",
      target: "signal-rooms-step-journal",
      title: "Choose the journal and the size",
      body: "Pick the journal this room's trades belong to, and the lot size to log them at. Signals never say a size, so every trade from the room uses this one. Pips and R do not depend on it; the money does.",
      placement: "left",
    },
    {
      id: "watch",
      target: "signal-rooms-list",
      title: "Then leave it alone",
      body: "Each connected room shows what it logged and what needs a look. Pause stops the listening; Disconnect removes the room and keeps its trades. Anything the bot would not guess at waits in the review list with a reason.",
      placement: "left",
    },
  ];
}

/** The card's own setup checklist, in the order a person does it. */
export const SETUP_STEPS = [
  { id: "bot", title: "Add the bot to the room as an admin", tour: "signal-rooms-step-bot" },
  { id: "code", title: "Get a code and post it in the room", tour: "signal-rooms-step-code" },
  { id: "room", title: "Pick the room once it appears here", tour: "signal-rooms-step-room" },
  { id: "journal", title: "Choose the journal and lot size, then start listening", tour: "signal-rooms-step-journal" },
] as const;

export type SetupStage = 0 | 1 | 2 | 3 | "done";

export interface SetupState {
  readonly hasFeeds: boolean;
  readonly codeOut: boolean;
  readonly hasCandidates: boolean;
  readonly drafting: boolean;
}

/**
 * Which checklist step is the next thing to do, as an index into SETUP_STEPS.
 *
 * The app cannot see the bot being added to a room, so the first two steps
 * are current together until a code is out. A room already connected and no
 * flow in progress is done; starting another connection re-opens the list.
 */
export function setupStage(s: SetupState): SetupStage {
  if (s.drafting) return 3;
  if (s.hasCandidates) return 2;
  if (s.codeOut) return 1;
  return s.hasFeeds ? "done" : 0;
}

/** localStorage key. Versioned so a reworked tour can run again. */
export const SIGNAL_ROOMS_TOUR_SEEN_KEY = "trdr_signal_rooms_tour_seen_v1";

export function hasSeenSignalRoomsTour(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(SIGNAL_ROOMS_TOUR_SEEN_KEY) === "1";
  } catch {
    // Storage that throws must not trap anyone in a tour that re-offers itself.
    return true;
  }
}

export function markSignalRoomsTourSeen(storage: Pick<Storage, "setItem">): void {
  try {
    storage.setItem(SIGNAL_ROOMS_TOUR_SEEN_KEY, "1");
  } catch {
    // Non-critical: worst case it offers itself again next visit.
  }
}
