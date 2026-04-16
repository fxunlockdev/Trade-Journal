"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn, formatDateTime } from "@/lib/utils";
import { getStatusColor } from "@/lib/constants/signal-status";
import { SignalPreview } from "@/components/signal/signal-preview";
import { SignalLifecycle } from "@/components/signal/signal-lifecycle";
import type { Signal, SignalEvent } from "@/types/database";
import { ArrowLeft, Clock, TrendingUp, TrendingDown, Trash2 } from "lucide-react";

interface SignalDetailClientProps {
  readonly signal: Signal;
  readonly events: readonly SignalEvent[];
}

function formatPrice(price: number): string {
  return price.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function EventTimeline({
  events,
}: {
  readonly events: readonly SignalEvent[];
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-950">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-zinc-400">
          Event Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="flex items-start gap-3">
              <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                <Clock className="h-3 w-3 text-zinc-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">
                    {event.event_type.replace("_", " ")}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {formatDateTime(event.created_at)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function SignalDetailClient({
  signal: initialSignal,
  events,
}: SignalDetailClientProps) {
  const router = useRouter();
  const [signal, setSignal] = useState<Signal>(initialSignal);

  const handleStatusChange = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleDelete = useCallback(async () => {
    const response = await fetch(`/api/signals/${signal.id}`, {
      method: "DELETE",
    });

    const result = await response.json();

    if (result.success) {
      router.push("/signals");
    }
  }, [signal.id, router]);

  const isBuy = signal.direction === "buy";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/signals">
            <Button
              variant="ghost"
              size="icon"
              className="text-zinc-400 hover:text-zinc-200"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl",
                isBuy ? "bg-emerald-500/10" : "bg-red-500/10",
              )}
            >
              {isBuy ? (
                <TrendingUp className="h-5 w-5 text-emerald-400" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-400" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-zinc-100">
                {signal.instrument}
              </h1>
              <p className="text-sm text-zinc-500">
                {signal.direction.toUpperCase()} Signal
              </p>
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          className="text-zinc-500 hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Signal info + Preview */}
        <div className="space-y-6 lg:col-span-2">
          {/* Signal details card */}
          <Card className="border-zinc-800 bg-zinc-950">
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <div>
                  <p className="text-xs font-medium text-zinc-500">Entry</p>
                  <p className="mt-1 font-mono text-lg text-zinc-100">
                    {formatPrice(signal.entry_price)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Stop Loss</p>
                  <p className="mt-1 font-mono text-lg text-red-400">
                    {formatPrice(signal.stop_loss)}
                  </p>
                  {signal.pips_to_sl !== null && (
                    <p className="text-xs text-zinc-600">
                      {signal.pips_to_sl.toFixed(1)} pips
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">TP1</p>
                  <p className="mt-1 font-mono text-lg text-emerald-400">
                    {signal.tp1 !== null ? formatPrice(signal.tp1) : "-"}
                  </p>
                  {signal.pips_to_tp1 !== null && (
                    <p className="text-xs text-zinc-600">
                      {signal.pips_to_tp1.toFixed(1)} pips
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Status</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "mt-1 font-medium",
                      getStatusColor(signal.status),
                      "border-zinc-700",
                    )}
                  >
                    {signal.status.replace("_", " ")}
                  </Badge>
                </div>
              </div>

              {/* Additional TPs */}
              {(signal.tp2 !== null ||
                signal.tp3 !== null ||
                signal.tp4 !== null) && (
                <>
                  <Separator className="my-4 bg-zinc-800" />
                  <div className="flex gap-6">
                    {signal.tp2 !== null && (
                      <div>
                        <p className="text-xs text-zinc-500">TP2</p>
                        <p className="font-mono text-sm text-emerald-400">
                          {formatPrice(signal.tp2)}
                        </p>
                      </div>
                    )}
                    {signal.tp3 !== null && (
                      <div>
                        <p className="text-xs text-zinc-500">TP3</p>
                        <p className="font-mono text-sm text-emerald-400">
                          {formatPrice(signal.tp3)}
                        </p>
                      </div>
                    )}
                    {signal.tp4 !== null && (
                      <div>
                        <p className="text-xs text-zinc-500">TP4</p>
                        <p className="font-mono text-sm text-emerald-400">
                          {formatPrice(signal.tp4)}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {signal.notes && (
                <>
                  <Separator className="my-4 bg-zinc-800" />
                  <div>
                    <p className="text-xs font-medium text-zinc-500">Notes</p>
                    <p className="mt-1 text-sm text-zinc-300">
                      {signal.notes}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Message preview */}
          <SignalPreview signal={signal} />
        </div>

        {/* Right: Lifecycle + Timeline */}
        <div className="space-y-6">
          <SignalLifecycle
            signal={signal}
            onStatusChange={handleStatusChange}
          />
          <EventTimeline events={events} />
        </div>
      </div>
    </div>
  );
}
