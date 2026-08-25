"use client";

import { useState } from "react";
import { toast } from "sonner";

import type { Journal, JournalColor } from "@/types/database";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "+ Create new journal" dialog.
 *
 * Minimal surface for MVP: just name + colour. Description/avatar come later
 * from the settings page. On success, calls `onCreated` with the new journal
 * (including `my_role: "owner"`) so the caller can auto-switch to it.
 */

const COLORS: ReadonlyArray<{
  readonly value: JournalColor;
  readonly swatch: string;
  readonly label: string;
}> = [
  { value: "slate", swatch: "bg-slate-500", label: "Slate" },
  { value: "emerald", swatch: "bg-emerald-500", label: "Emerald" },
  { value: "sky", swatch: "bg-sky-500", label: "Sky" },
  { value: "violet", swatch: "bg-violet-500", label: "Violet" },
  { value: "orange", swatch: "bg-orange-500", label: "Orange" },
  { value: "cyan", swatch: "bg-cyan-500", label: "Cyan" },
  { value: "rose", swatch: "bg-rose-500", label: "Rose" },
  { value: "lime", swatch: "bg-lime-500", label: "Lime" },
  { value: "amber", swatch: "bg-amber-500", label: "Amber" },
  { value: "red", swatch: "bg-red-500", label: "Red" },
];

type CreatedJournal = Journal & { readonly my_role: "owner" };

interface CreateJournalDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated?: (journal: CreatedJournal) => void;
}

export function CreateJournalDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateJournalDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<JournalColor>("slate");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0 || submitting) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, color }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: CreatedJournal;
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? "Failed to create journal");
        return;
      }
      toast.success(`Created "${trimmed}"`);
      setName("");
      setColor("slate");
      onOpenChange(false);
      if (body.data) onCreated?.(body.data);
    } catch {
      toast.error("Network error creating journal");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create a new journal</DialogTitle>
            <DialogDescription>
              A journal is a workspace for organising trades. Use separate
              journals for different accounts, strategies, or groups, and invite
              colleagues later from journal settings.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="journal-name">Name</Label>
              <Input
                id="journal-name"
                autoFocus
                placeholder="e.g. BTC Group, FTMO $100k, 2026 Swings"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
              />
              <p className="text-xs text-muted-foreground">
                Up to 60 characters. You can rename it later.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => setColor(c.value)}
                    className={cn(
                      "size-7 rounded-full transition-all",
                      c.swatch,
                      color === c.value
                        ? "scale-110 ring-2 ring-foreground/40 ring-offset-2 ring-offset-background"
                        : "opacity-80 hover:opacity-100",
                    )}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || name.trim().length === 0}
            >
              {submitting ? "Creating…" : "Create Journal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
