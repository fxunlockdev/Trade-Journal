"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus, LinkIcon, Settings2 } from "lucide-react";
import { toast } from "sonner";

import type { JournalWithRole, JournalColor } from "@/types/database";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { CreateJournalDialog } from "@/components/journals/create-journal-dialog";

/**
 * Workspace-style journal switcher in the top nav. Lets the user:
 *   - See which journal is active (colour dot + name)
 *   - Switch to any journal they're a member of (with their role shown)
 *   - Create a new journal (opens CreateJournalDialog)
 *   - Jump to the active journal's settings page
 *
 * Switching POSTs to `/api/journals/[id]/activate` which verifies membership
 * server-side and writes the `trdr_active_journal` cookie. A router.refresh()
 * reloads all server components so the whole app re-scopes atomically.
 */

export const COLOR_CLASS: Record<JournalColor, string> = {
  slate: "bg-slate-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  orange: "bg-orange-500",
  cyan: "bg-cyan-500",
  rose: "bg-rose-500",
  lime: "bg-lime-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

interface JournalSwitcherProps {
  readonly journals: readonly JournalWithRole[];
  readonly activeJournalId: string;
}

export function JournalSwitcher({
  journals,
  activeJournalId,
}: JournalSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const active =
    journals.find((j) => j.id === activeJournalId) ?? journals[0] ?? null;

  const handleSelect = async (journalId: string): Promise<void> => {
    if (journalId === activeJournalId || switching) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const res = await fetch(`/api/journals/${journalId}/activate`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to switch journal");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error switching journal");
    } finally {
      setSwitching(false);
    }
  };

  if (!active) {
    // Defensive: shouldn't happen since every user has a Personal journal
    return null;
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2 px-2.5 text-sm font-medium"
              aria-label="Switch journal"
            />
          }
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              COLOR_CLASS[active.color],
            )}
          />
          <span className="max-w-[140px] truncate">{active.name}</span>
          <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Switch workspace..." />
            <CommandList>
              <CommandEmpty>No journal found.</CommandEmpty>
              <CommandGroup heading="Your Journals">
                {journals.map((j) => (
                  <CommandItem
                    key={j.id}
                    value={j.name}
                    onSelect={() => void handleSelect(j.id)}
                    className="gap-2"
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        COLOR_CLASS[j.color],
                      )}
                    />
                    <span className="flex-1 truncate">{j.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {j.my_role}
                    </span>
                    {j.id === activeJournalId && (
                      <Check className="ml-1 size-4 text-primary" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                  className="gap-2 text-sm"
                >
                  <Plus className="size-4" />
                  Create new journal
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    toast.info(
                      "Paste the invite link in your browser — e.g. /invite/abc123xyz",
                      { duration: 5000 },
                    );
                  }}
                  className="gap-2 text-sm text-muted-foreground"
                >
                  <LinkIcon className="size-4" />
                  Join via invite link
                </CommandItem>
                {active.my_role === "owner" && (
                  <CommandItem asChild className="gap-2 text-sm">
                    <Link
                      href="/journal/settings"
                      onClick={() => setOpen(false)}
                    >
                      <Settings2 className="size-4" />
                      {active.name} settings
                    </Link>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <CreateJournalDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(journal) => {
          void handleSelect(journal.id);
        }}
      />
    </>
  );
}
