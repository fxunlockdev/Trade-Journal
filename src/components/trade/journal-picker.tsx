"use client";

import { useMemo } from "react";
import type { JournalWithRole } from "@/types/database";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COLOR_CLASS } from "@/components/journals/journal-switcher";

interface JournalPickerProps {
  readonly journals: readonly JournalWithRole[];
  readonly value: string | undefined;
  readonly onChange: (journalId: string) => void;
  readonly disabled?: boolean;
}

/**
 * Journal selector for the trade form. Only shows journals where the caller
 * has owner/member role (viewers can't log trades). If the user has exactly
 * one writable journal the picker is still rendered but not interactive,
 * so it doubles as a visual "this trade will land in X" indicator.
 */
export function JournalPicker({
  journals,
  value,
  onChange,
  disabled = false,
}: JournalPickerProps) {
  const writable = useMemo(
    () => journals.filter((j) => j.my_role !== "viewer" && !j.is_archived),
    [journals],
  );

  const selected = writable.find((j) => j.id === value);

  if (writable.length === 0) {
    return (
      <p className="text-xs text-amber-400">
        You don&apos;t have edit rights in any active journal. Ask an owner to
        promote you, or create a new journal of your own.
      </p>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
      disabled={disabled || writable.length === 1}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a journal…">
          {selected && (
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  COLOR_CLASS[selected.color],
                )}
              />
              <span className="truncate">{selected.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {selected.my_role}
              </span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {writable.map((j) => (
          <SelectItem key={j.id} value={j.id}>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  COLOR_CLASS[j.color],
                )}
              />
              <span className="truncate">{j.name}</span>
              <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {j.my_role}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
