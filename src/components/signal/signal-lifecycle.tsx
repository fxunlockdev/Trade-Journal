"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  SIGNAL_STATUS_TRANSITIONS,
  getStatusColor,
} from "@/lib/constants/signal-status";
import type { Signal, SignalStatus } from "@/types/database";
import { Loader2, Target, ShieldX, XCircle } from "lucide-react";

interface SignalLifecycleProps {
  readonly signal: Signal;
  readonly onStatusChange?: (newStatus: string) => void;
}

const TP_OPTIONS = ["TP1", "TP2", "TP3", "TP4"] as const;

export function SignalLifecycle({
  signal,
  onStatusChange,
}: SignalLifecycleProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTp, setSelectedTp] = useState<string>("TP1");

  const allowedTransitions = SIGNAL_STATUS_TRANSITIONS[signal.status] ?? [];

  const updateStatus = useCallback(
    async (newStatus: SignalStatus, metadata?: Record<string, unknown>) => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/signals/${signal.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newStatus, metadata }),
        });

        const result = await response.json();

        if (!result.success) {
          setError(result.error ?? "Failed to update status");
          return;
        }

        onStatusChange?.(newStatus);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unexpected error";
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [signal.id, onStatusChange],
  );

  const handleTpHit = useCallback(() => {
    updateStatus("TP_HIT", { tp_level: selectedTp });
  }, [updateStatus, selectedTp]);

  const handleSlHit = useCallback(() => {
    updateStatus("SL_HIT");
  }, [updateStatus]);

  const handleClose = useCallback(() => {
    updateStatus("CLOSED");
  }, [updateStatus]);

  const isTerminal = allowedTransitions.length === 0;

  return (
    <Card className="border-zinc-800 bg-zinc-950">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-zinc-400">
          Signal Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current status */}
        <div className="flex items-center justify-center">
          <Badge
            variant="outline"
            className={cn(
              "px-4 py-2 text-base font-bold",
              getStatusColor(signal.status),
              "border-zinc-700",
            )}
          >
            {signal.status.replace("_", " ")}
          </Badge>
        </div>

        {isTerminal && (
          <p className="text-center text-sm text-zinc-500">
            This signal has reached its final state.
          </p>
        )}

        {!isTerminal && (
          <div className="space-y-3">
            {/* TP Hit */}
            {allowedTransitions.includes("TP_HIT") && (
              <div className="flex items-center gap-2">
                <Select value={selectedTp} onValueChange={(value) => { if (value !== null) setSelectedTp(value); }}>
                  <SelectTrigger className="w-24 border-zinc-700 bg-zinc-900 text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-900">
                    {TP_OPTIONS.map((tp) => (
                      <SelectItem key={tp} value={tp} className="text-zinc-200">
                        {tp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleTpHit}
                  disabled={loading}
                  className="flex-1 bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Target className="mr-2 h-4 w-4" />
                  )}
                  TP Hit
                </Button>
              </div>
            )}

            {/* SL Hit */}
            {allowedTransitions.includes("SL_HIT") && (
              <Button
                onClick={handleSlHit}
                disabled={loading}
                variant="outline"
                className="w-full border-red-900 bg-red-950/30 text-red-400 hover:bg-red-950/50 hover:text-red-300"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldX className="mr-2 h-4 w-4" />
                )}
                SL Hit
              </Button>
            )}

            {/* Close */}
            {allowedTransitions.includes("CLOSED") && (
              <Button
                onClick={handleClose}
                disabled={loading}
                variant="outline"
                className="w-full border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Close Signal
              </Button>
            )}

            {/* Other transitions (SENT, ACTIVE) */}
            {allowedTransitions
              .filter((t) => !["TP_HIT", "SL_HIT", "CLOSED"].includes(t))
              .map((transition) => (
                <Button
                  key={transition}
                  onClick={() => updateStatus(transition)}
                  disabled={loading}
                  variant="outline"
                  className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                >
                  {loading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Mark as {transition.replace("_", " ")}
                </Button>
              ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
