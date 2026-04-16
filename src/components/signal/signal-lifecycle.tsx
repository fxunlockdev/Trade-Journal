"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Send,
  Zap,
  Target,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import type { Signal, SignalStatus } from "@/types/database";
import { SIGNAL_STATUS_TRANSITIONS, getStatusColor } from "@/lib/constants/signal-status";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SignalLifecycleProps {
  readonly signal: Signal;
  readonly onStatusChange?: () => void;
}

const STATUS_BUTTON_CONFIG: Readonly<
  Record<string, { icon: React.ReactNode; color: string; label: string }>
> = {
  SENT: {
    icon: <Send className="size-3.5" />,
    color: "bg-blue-600 text-white hover:bg-blue-500",
    label: "Mark as Sent",
  },
  ACTIVE: {
    icon: <Zap className="size-3.5" />,
    color: "bg-amber-600 text-white hover:bg-amber-500",
    label: "Mark Active",
  },
  SL_HIT: {
    icon: <ShieldAlert className="size-3.5" />,
    color: "bg-red-600 text-white hover:bg-red-500",
    label: "Stop Loss Hit",
  },
  CLOSED: {
    icon: <XCircle className="size-3.5" />,
    color: "bg-slate-300 text-white hover:bg-slate-200",
    label: "Close Signal",
  },
};

export function SignalLifecycle({ signal, onStatusChange }: SignalLifecycleProps) {
  const [updating, setUpdating] = useState(false);
  const [selectedTp, setSelectedTp] = useState<string>("");

  const availableTransitions = SIGNAL_STATUS_TRANSITIONS[signal.status] ?? [];

  const availableTps = [
    signal.tp1 !== null ? "TP1" : null,
    signal.tp2 !== null ? "TP2" : null,
    signal.tp3 !== null ? "TP3" : null,
    signal.tp4 !== null ? "TP4" : null,
  ].filter(Boolean) as readonly string[];

  const hasTPHitTransition = availableTransitions.includes("TP_HIT");
  const nonTPTransitions = availableTransitions.filter(
    (s) => s !== "TP_HIT",
  );

  const handleStatusChange = useCallback(
    async (newStatus: SignalStatus, metadata?: Record<string, unknown>) => {
      setUpdating(true);
      try {
        const res = await fetch(`/api/signals/${signal.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: newStatus,
            event_metadata: metadata ?? {},
          }),
        });

        if (!res.ok) {
          const body = await res.json();
          toast.error(body.error ?? "Failed to update status");
          return;
        }

        toast.success(`Signal status updated to ${newStatus.replace("_", " ")}`);
        onStatusChange?.();
      } catch {
        toast.error("Failed to update status");
      } finally {
        setUpdating(false);
      }
    },
    [signal.id, onStatusChange],
  );

  const handleTPHit = useCallback(() => {
    if (!selectedTp) {
      toast.error("Select which take profit was hit");
      return;
    }
    handleStatusChange("TP_HIT", { tp_level: selectedTp });
  }, [selectedTp, handleStatusChange]);

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-slate-500">
          Signal Lifecycle
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current status */}
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase text-slate-500">Current</span>
          <Badge
            variant="outline"
            className={cn(
              "px-3 py-1.5 text-sm font-semibold",
              getStatusColor(signal.status),
            )}
          >
            {signal.status.replace("_", " ")}
          </Badge>
        </div>

        {/* Available transitions */}
        {availableTransitions.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs uppercase text-slate-500">
              Available Actions
            </p>

            {/* TP Hit with dropdown */}
            {hasTPHitTransition && availableTps.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={selectedTp} onValueChange={(v) => { if (v) setSelectedTp(v); }}>
                  <SelectTrigger className="w-[120px] border-slate-200 bg-slate-200 text-slate-700">
                    <SelectValue placeholder="TP Level" />
                  </SelectTrigger>
                  <SelectContent className="border-slate-200 bg-slate-200">
                    {availableTps.map((tp) => (
                      <SelectItem
                        key={tp}
                        value={tp}
                        className="text-slate-700 focus:bg-slate-200 focus:text-slate-900"
                      >
                        {tp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={updating || !selectedTp}
                  onClick={handleTPHit}
                  className="gap-1.5 bg-indigo-600 text-white hover:bg-indigo-500"
                >
                  {updating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Target className="size-3.5" />
                  )}
                  TP Hit
                </Button>
              </div>
            )}

            {/* Other transition buttons */}
            <div className="flex flex-wrap gap-2">
              {nonTPTransitions.map((status) => {
                const config = STATUS_BUTTON_CONFIG[status];
                if (!config) return null;

                return (
                  <Button
                    key={status}
                    size="sm"
                    disabled={updating}
                    onClick={() => handleStatusChange(status)}
                    className={cn("gap-1.5", config.color)}
                  >
                    {updating ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      config.icon
                    )}
                    {config.label}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">
            This signal has reached its final state.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
