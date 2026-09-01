"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Cadence } from "@/lib/telegram/commands";
import { POSTER_TEMPLATES } from "@/lib/posters/templates";
import { useRouter } from "next/navigation";

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
  /** Null when the current journal selection has not been saved yet. */
  readonly deskId: string | null;
  readonly deskName: string;
  /** Null when no group is connected. */
  readonly chatTitle: string | null;
  /** Which styles this setup publishes, from the saved row. */
  readonly templateIds: readonly string[];
}

export function PublishToTelegram({
  deskId,
  deskName,
  chatTitle,
  templateIds,
}: PublishToTelegramProps) {
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [savingStyles, setSavingStyles] = useState(false);
  const router = useRouter();

  // Nothing to publish, or nowhere to publish it. The Telegram card directly
  // below explains how to connect, so this stays silent rather than repeating.
  if (!deskId || !chatTitle) return null;

  /**
   * Turn one style on or off for this setup.
   *
   * Saved immediately rather than behind another button: this is a preference,
   * not a transaction, and a "save your save" step is how a setting ends up
   * silently not applying. The last one cannot be removed, because a setup that
   * publishes nothing would sit in the scheduler doing nothing every morning
   * with no way to tell it was misconfigured.
   */
  const toggleStyle = async (id: string): Promise<void> => {
    if (!deskId) return;
    const next = templateIds.includes(id)
      ? templateIds.filter((t) => t !== id)
      : [...templateIds, id];

    if (next.length === 0) {
      toast.info("Keep at least one style, or there is nothing to publish.");
      return;
    }

    setSavingStyles(true);
    try {
      const res = await fetch(`/api/desks/${deskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_ids: next }),
      });
      if (!res.ok) {
        const json: { error?: string } = await res.json().catch(() => ({}));
        toast.error(json.error ?? "Couldn't save that.");
        return;
      }
      await router.refresh();
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSavingStyles(false);
    }
  };

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
      const posted: number = pubJson.data.posted ?? 0;
      toast.success(
        skipped.length > 0
          ? `Posted ${posted} to ${pubJson.data.chat}. ${skipped.length} could not be drawn.`
          : `Posted ${posted} ${posted === 1 ? "poster" : "posters"} to ${pubJson.data.chat}.`,
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
    <div className="space-y-3" data-testid="poster-publish">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          Styles sent to {chatTitle}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {POSTER_TEMPLATES.map((t) => {
            const on = templateIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                disabled={savingStyles || busy}
                onClick={() => void toggleStyle(t.id)}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                  on
                    ? "border-pos/40 bg-pos/10 text-pos"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`poster-style-${t.id}`}
                aria-pressed={on}
              >
                {on ? "\u2713 " : ""}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

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
