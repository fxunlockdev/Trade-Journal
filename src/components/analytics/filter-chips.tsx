"use client";

import { cn } from "@/lib/utils";

/**
 * Toggle chips. Nothing selected means "everything" — a filter you can't
 * accidentally empty into a blank screen.
 *
 * Shared by the Portfolio view and the poster generator so the two stay
 * identical: both let you pick a set of journals and a set of instruments, and
 * a control that behaved differently between them would be a papercut.
 */
export function FilterChips({
  options,
  selected,
  onToggle,
  onAll,
  renderDot,
  testIdPrefix,
}: {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (value: string) => void;
  readonly onAll: () => void;
  readonly renderDot?: (value: string) => string | null;
  /** When set, each chip gets `data-testid="{prefix}-{value}"`. */
  readonly testIdPrefix?: string;
}) {
  const allActive = selected.size === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onAll}
        data-testid={testIdPrefix ? `${testIdPrefix}-all` : undefined}
        className={cn(
          "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
          allActive
            ? "border-primary/40 bg-primary/15 text-primary"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        All
      </button>
      {options.map((o) => {
        const active = allActive || selected.has(o.value);
        const dot = renderDot?.(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              selected.has(o.value)
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
              allActive && !selected.has(o.value) && "opacity-70",
            )}
            aria-pressed={active}
          >
            {dot && <span className={cn("size-2 rounded-full", dot)} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
