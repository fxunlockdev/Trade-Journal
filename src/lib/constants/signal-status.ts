import type { SignalStatus } from "@/types/database";

export const SIGNAL_STATUSES: readonly SignalStatus[] = [
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
  CREATED: ["SENT", "CLOSED"],
  SENT: ["ACTIVE", "CLOSED"],
  ACTIVE: ["TP_HIT", "SL_HIT", "CLOSED"],
  TP_HIT: [],
  SL_HIT: [],
  CLOSED: [],
};

export function getStatusColor(status: SignalStatus): string {
  const colors: Record<SignalStatus, string> = {
    CREATED: "text-gray-500",
    SENT: "text-blue-500",
    ACTIVE: "text-yellow-500",
    TP_HIT: "text-green-500",
    SL_HIT: "text-red-500",
    CLOSED: "text-gray-400",
  };
  return colors[status];
}
