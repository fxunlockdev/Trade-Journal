import type { SignalStatus } from "@/types/database";

export const SIGNAL_STATUSES = [
  "CREATED",
  "SENT",
  "ACTIVE",
  "TP_HIT",
  "SL_HIT",
  "CLOSED",
] as const;

export const SIGNAL_STATUS_TRANSITIONS: Readonly<
  Record<SignalStatus, readonly SignalStatus[]>
> = {
  CREATED: ["SENT"],
  SENT: ["ACTIVE"],
  ACTIVE: ["TP_HIT", "SL_HIT", "CLOSED"],
  TP_HIT: ["CLOSED"],
  SL_HIT: ["CLOSED"],
  CLOSED: [],
};

// TradLabs status system — forest/lime/functional palette, theme-aware tokens.
const STATUS_COLORS: Readonly<Record<SignalStatus, string>> = {
  CREATED: "bg-muted text-muted-foreground border-border",
  SENT: "bg-primary/10 text-primary border-primary/20",
  ACTIVE: "bg-warn/15 text-warn border-warn/25",
  TP_HIT: "bg-pos/15 text-pos border-pos/25",
  SL_HIT: "bg-neg/15 text-neg border-neg/25",
  CLOSED: "bg-secondary text-secondary-foreground border-border",
};

export function getStatusColor(status: string): string {
  return (
    STATUS_COLORS[status as SignalStatus] ??
    "bg-muted text-muted-foreground border-border"
  );
}

export function isValidTransition(
  from: SignalStatus,
  to: SignalStatus,
): boolean {
  const allowed = SIGNAL_STATUS_TRANSITIONS[from];
  return allowed.includes(to);
}
