"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Cadence } from "@/lib/telegram/commands";

/**
 * Publishing a desk's report to the connected group.
 *
 * Two steps behind one button. Freezing the numbers and sending them are
 * separate operations on purpose (the scheduler and the Telegram commands use
 * the same pair), but a person thinks of it as one action, so the UI does not
 * make them care.
 *
 * Confirmation is not decoration. This posts to a room of business partners and
 * cannot be taken back from here, so the button says WHERE it is about to post
 * before it does it.
 */

const CADENCES: readonly { readonly id: Cadence; readonly label: string }[] = [
  { id: "daily", label: "Yesterday" },
  { id: "weekly", label: "Last week" },
  { id: "monthly", label: "Last month" },
];

interface PublishToTelegramProps {
  /** Null when the current journal selection is not a saved desk. */
  readonly deskId: string | null;
  readonly deskName: string;
  /** Null when no group is connected. */
  readonly chatTitle: string | null;
}

export function PublishToTelegram({
  deskId,
  deskName,
  chatTitle,
}: PublishToTelegramProps) {
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Nothing to publish, or nowhere to publish it. The Telegram card directly
  // below explains how to connect, so this stays silent rather than repeating.
  if (!deskId || !chatTitle) return null;

  const run = async (): Promise<void> => {
    setBusy(true);
    setConfirming(false);
    try {
      // 1. Freeze the numbers. Returns the existing snapshot if this period was
      //    already computed, so the poster cannot change under a re-send.
      const snapRes = await fetch("/api/reports/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deskId, cadence }),
      });
      const snapJson = await snapRes.json();
      if (!snapRes.ok) {
        toast.error(snapJson.error ?? "Couldn't prepare that report.");
        return;
      }

      // An empty period is not an error worth a red toast: it means the desk
      // simply did not trade, and publishing a poster reading zero would be
      // worse than publishing nothing.
      if (snapJson.data.trade_count === 0) {
        toast.info("No closed trades in that period, so there is nothing to post.");
        return;
      }

      // 2. Render and send.
      const pubRes = await fetch(
        `/api/reports/${snapJson.data.id}/publish`,
        { method: "POST" },
      );
      const pubJson = await pubRes.json();

      if (!pubRes.ok) {
        // 409 is the double-post guard, not a fault. Said plainly so nobody
        // goes looking for a bug that is actually the feature working.
        toast[pubRes.status === 409 ? "info" : "error"](
          pubJson.error ?? "Couldn't post that report.",
        );
        return;
      }

      const skipped: readonly string[] = pubJson.data.skipped ?? [];
      toast.success(
        skipped.length > 0
          ? `Posted ${pubJson.data.posted} of 3 posters to ${pubJson.data.chat}. ${skipped.length} could not be drawn.`
          : `Posted 3 posters to ${pubJson.data.chat}.`,
      );
    } catch {
      // A dropped connection says nothing about whether the send happened, so
      // this deliberately does not claim it failed.
      toast.error(
        "Lost connection before the result came back. Check the group before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="poster-publish">
      <div className="flex gap-1.5">
        {CADENCES.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={busy}
            onClick={() => {
              setCadence(c.id);
              setConfirming(false);
            }}
            className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
              cadence === c.id
                ? "border-pos/40 bg-pos/10 text-pos"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`poster-publish-${c.id}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Button
        type="button"
        variant={confirming ? "default" : "outline"}
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={() => (confirming ? void run() : setConfirming(true))}
        data-testid="poster-publish-send"
      >
        {busy
          ? "Posting..."
          : confirming
            ? `Post to ${chatTitle}?`
            : "Post to Telegram"}
      </Button>

      {confirming && !busy && (
        <p className="text-xs text-muted-foreground">
          Sends all three posters for {deskName} as one album. This cannot be
          undone from here.
        </p>
      )}
    </div>
  );
}
