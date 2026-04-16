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

const STATUS_COLORS: Readonly<Record<SignalStatus, string>> = {
  CREATED: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  SENT: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  ACTIVE: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  TP_HIT: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  SL_HIT: "bg-red-500/10 text-red-400 border-red-500/20",
  CLOSED: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20",
};

export function getStatusColor(status: string): string {
  return (
    STATUS_COLORS[status as SignalStatus] ??
    "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
  );
}

export function isValidTransition(
  from: SignalStatus,
  to: SignalStatus,
): boolean {
  const allowed = SIGNAL_STATUS_TRANSITIONS[from];
  return allowed.includes(to);
}
