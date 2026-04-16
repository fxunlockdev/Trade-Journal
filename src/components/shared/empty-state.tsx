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
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted px-6 py-16 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>

      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>

      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>

      {action && (
        <Button
          onClick={action.onClick}
          className="mt-6 bg-primary text-white hover:bg-primary/100"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
