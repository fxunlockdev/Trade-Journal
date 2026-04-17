"use client";

import { HelpCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FieldLabelProps {
  readonly htmlFor?: string;
  readonly children: React.ReactNode;
  /** Tooltip body — plain text or JSX for richer explanations. */
  readonly help: React.ReactNode;
  /** Mark the field as required with a subtle asterisk. */
  readonly required?: boolean;
}

/**
 * Label paired with a small help-icon that pops a tooltip on hover/focus.
 *
 * Usage intent is to demystify every trade-form field for new users who
 * don't yet know what "lot size" vs "quantity" means, or why Take Profit
 * must sit on the opposite side of entry from Stop Loss. The tooltip text
 * lives at the call site so each field can explain itself in context.
 */
export function FieldLabel({
  htmlFor,
  children,
  help,
  required,
}: FieldLabelProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {children}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      <Tooltip>
        <TooltipTrigger
          // Render as a <button> so the trigger is keyboard-focusable and
          // screen-reader-announced. type="button" avoids accidentally
          // submitting the surrounding form when someone hits Enter on it.
          render={
            <button
              type="button"
              aria-label="Field info"
              className="text-muted-foreground transition-colors hover:text-foreground focus:text-foreground focus:outline-none"
            />
          }
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {help}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
