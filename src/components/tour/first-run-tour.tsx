"use client";

import { useCallback, useEffect, useState } from "react";
import { TourOverlay } from "@/components/tour/tour-overlay";
import {
  hasSeenTour,
  markTourSeen,
  TOUR_STEPS,
  visibleSteps,
  type TourStep,
} from "@/lib/tour/steps";

/**
 * Decides whether a first-time trader sees the tour.
 *
 * Runs once per browser, gated on localStorage rather than a `users` column:
 * this is a UI preference, not account state, and adding a column would put the
 * feature behind a hand-applied migration for no benefit. The trade-off is that
 * it can run again on a new device, which is the harmless direction to fail.
 *
 * It never auto-starts for an established user — the tour explains how to log
 * a first trade, and interrupting someone mid-workflow with that is noise.
 * Replaying from Settings bypasses both gates.
 */
export function FirstRunTour({
  alreadyOnboarded,
}: {
  readonly alreadyOnboarded: boolean;
}) {
  const [steps, setSteps] = useState<readonly TourStep[] | null>(null);

  const start = useCallback(() => {
    // Targets are rendered by the app shell, which mounts alongside this — wait
    // a frame so the sidebar and topbar are measurable before deciding which
    // steps have somewhere to point.
    requestAnimationFrame(() => {
      const usable = visibleSteps(TOUR_STEPS, (t) =>
        Boolean(document.querySelector(`[data-tour="${t}"]`)),
      );
      // One lonely step isn't a tour; skip rather than show a stub.
      setSteps(usable.length >= 2 ? usable : null);
    });
  }, []);

  useEffect(() => {
    if (alreadyOnboarded) return;
    if (hasSeenTour(window.localStorage)) return;
    start();
  }, [alreadyOnboarded, start]);

  // Replay from anywhere: Settings dispatches this rather than importing state.
  useEffect(() => {
    const onReplay = () => start();
    window.addEventListener("trdr:start-tour", onReplay);
    return () => window.removeEventListener("trdr:start-tour", onReplay);
  }, [start]);

  const finish = useCallback(() => {
    markTourSeen(window.localStorage);
    setSteps(null);
  }, []);

  if (!steps) return null;
  return <TourOverlay steps={steps} onFinish={finish} />;
}
