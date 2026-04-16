"use client";

import { cn } from "@/lib/utils";
import type { Period } from "@/lib/trades/analytics";

interface TimeFilterProps {
  readonly value: Period;
  readonly onChange: (period: Period) => void;
}

const OPTIONS: readonly { readonly label: string; readonly value: Period }[] = [
  { label: "Daily", value: "day" },
  { label: "Weekly", value: "week" },
  { label: "Monthly", value: "month" },
];

export function TimeFilter({ value, onChange }: TimeFilterProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
            value === option.value
              ? "bg-zinc-700 text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-300",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
