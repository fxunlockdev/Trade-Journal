import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-zinc-800/50 text-zinc-400">
        {icon}
      </div>

      <h3 className="mt-4 text-base font-semibold text-zinc-200">{title}</h3>

      <p className="mt-1.5 max-w-sm text-sm text-zinc-500">{description}</p>

      {action && (
        <Button
          onClick={action.onClick}
          className="mt-6 bg-emerald-600 text-white hover:bg-emerald-500"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
