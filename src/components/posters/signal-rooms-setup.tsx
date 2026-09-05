"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SETUP_STEPS, type SetupStage } from "@/lib/tour/signal-rooms-steps";

/**
 * The checklist that follows a person through connecting a room.
 *
 * It reads the card's live state rather than remembering clicks: the step
 * highlighted is always the next real thing to do, and finishing any step by
 * whatever route ticks it. Always rendered, compact once done, so the tour has
 * something to point at in every state.
 */
export function SignalRoomsSetup({ stage, botHandle }: { readonly stage: SetupStage; readonly botHandle: string }) {
  const done = stage === "done";
  return (
    <ol className={cn("space-y-1.5 rounded-md border border-border p-3", done && "opacity-80")} data-testid="signal-rooms-setup" aria-label="Setup steps">
      {SETUP_STEPS.map((step, i) => {
        const complete = done || (typeof stage === "number" && i < stage);
        // Nothing here can see the bot being added, so the first two steps
        // read as current together until a code is out.
        const current = !done && (i === stage || (stage === 0 && i === 1));
        return (
          <li key={step.id} data-tour={step.tour} className={cn("flex items-start gap-2.5 text-sm", complete && "text-muted-foreground", current && "font-medium text-foreground")}>
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                complete ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary text-primary" : "border-border text-muted-foreground",
              )}
            >
              {complete ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span>
              {step.title}
              {step.id === "bot" && !complete ? <span className="block text-xs font-normal text-muted-foreground">{botHandle}, from the room&apos;s members list. It stays silent there.</span> : null}
              {step.id === "journal" && !complete ? <span className="block text-xs font-normal text-muted-foreground">Every trade from the room is logged at that size.</span> : null}
            </span>
          </li>
        );
      })}
      {done ? <li className="pl-7 text-xs text-muted-foreground">Connected. Connect another room any time; each one maps to its own journal.</li> : null}
    </ol>
  );
}
