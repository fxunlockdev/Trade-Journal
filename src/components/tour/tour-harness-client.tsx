"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TourOverlay } from "@/components/tour/tour-overlay";
import { TOUR_STEPS, visibleSteps } from "@/lib/tour/steps";

/**
 * Stand-in chrome carrying the same `data-tour` anchors as the real sidebar and
 * topbar, so the overlay can be exercised without a session. Development only.
 */
export function TourHarnessClient() {
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(0);

  const steps = visibleSteps(TOUR_STEPS, () => true);

  return (
    <div className="flex h-screen bg-background">
      {/* Fake sidebar */}
      <aside className="w-56 shrink-0 border-r border-border bg-sidebar p-3">
        <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-leaf">
          Main
        </p>
        {[
          ["nav-dashboard", "Dashboard"],
          ["nav-journal", "Journal"],
          ["nav-journal-new", "Add Trade"],
          ["nav-import", "Import"],
        ].map(([tour, label]) => (
          <div
            key={tour}
            data-tour={tour}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground"
          >
            {label}
          </div>
        ))}
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Fake topbar */}
        <header className="flex h-16 items-center gap-3 border-b border-border px-4">
          <button
            type="button"
            data-tour="journal-switcher"
            className="h-8 rounded-md px-2.5 text-sm font-medium text-foreground"
          >
            TTC GOLD | YOHAN
          </button>
          <span className="h-4 w-px bg-border" />
          <h1 className="text-base font-semibold text-foreground">Dashboard</h1>
        </header>

        <main className="flex-1 p-6">
          <h2 className="text-xl font-bold text-foreground">Tour harness</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Development-only. Drives the real overlay against stand-in anchors.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Button
              onClick={() => setRunning(true)}
              disabled={running}
              data-testid="harness-start"
            >
              Start tour
            </Button>
            <span
              className="text-sm text-muted-foreground"
              data-testid="harness-finished"
            >
              finished: {finished}
            </span>
          </div>
        </main>
      </div>

      {running && (
        <TourOverlay
          steps={steps}
          onFinish={() => {
            setRunning(false);
            setFinished((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
