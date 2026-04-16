import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import type { Signal, SignalEvent } from "@/types/database";
import { cn, formatDateTime } from "@/lib/utils";
import { getStatusColor } from "@/lib/constants/signal-status";
import { computePipsDifference } from "@/lib/signals/computations";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { SignalDetailClient } from "./signal-detail-client";

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function SignalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", user.id)
    .single();

  const { data: signal } = await supabase
    .from("signals")
    .select("*")
    .eq("id", id)
    .single();

  if (!signal) {
    notFound();
  }

  const typedSignal = signal as Signal;

  // Access check: must be the trader who created it, or admin
  const isAdmin = profile?.role === "admin";
  const isOwner = typedSignal.trader_id === user.id;

  if (!isAdmin && !isOwner) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
        <h2 className="text-lg font-semibold text-zinc-200">Access Denied</h2>
        <p className="mt-2 text-sm text-zinc-500">
          You do not have permission to view this signal.
        </p>
      </div>
    );
  }

  const { data: events } = await supabase
    .from("signal_events")
    .select("*")
    .eq("signal_id", id)
    .order("created_at", { ascending: true });

  const typedEvents = (events as readonly SignalEvent[]) ?? [];

  // Compute pips for display
  const tpLevels = [
    { label: "TP1", value: typedSignal.tp1 },
    { label: "TP2", value: typedSignal.tp2 },
    { label: "TP3", value: typedSignal.tp3 },
    { label: "TP4", value: typedSignal.tp4 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/signals"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ArrowLeft className="size-3.5" />
          Back to Signals
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
            {typedSignal.instrument}
          </h1>
          <Badge
            variant="outline"
            className={cn(
              "text-sm font-bold uppercase",
              typedSignal.direction === "buy"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-red-500/30 bg-red-500/10 text-red-400",
            )}
          >
            {typedSignal.direction}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-xs font-medium",
              getStatusColor(typedSignal.status),
            )}
          >
            {typedSignal.status.replace("_", " ")}
          </Badge>
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          {/* Signal info card */}
          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-zinc-400">
                Signal Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-2">
                  <span className="text-sm text-zinc-500">Entry Price</span>
                  <span className="font-mono text-sm font-semibold text-zinc-200">
                    {typedSignal.entry_price}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-red-500/5 px-3 py-2">
                  <span className="text-sm text-red-400">Stop Loss</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-red-400">
                      {typedSignal.stop_loss}
                    </span>
                    <Badge
                      variant="outline"
                      className="border-red-500/20 text-xs text-red-400"
                    >
                      {computePipsDifference(
                        typedSignal.entry_price,
                        typedSignal.stop_loss,
                        typedSignal.instrument,
                      )}{" "}
                      pips
                    </Badge>
                  </div>
                </div>

                {tpLevels.map(
                  (tp) =>
                    tp.value !== null && (
                      <div
                        key={tp.label}
                        className="flex items-center justify-between rounded-lg bg-emerald-500/5 px-3 py-2"
                      >
                        <span className="text-sm text-emerald-400">
                          {tp.label}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-emerald-400">
                            {tp.value}
                          </span>
                          <Badge
                            variant="outline"
                            className="border-emerald-500/20 text-xs text-emerald-400"
                          >
                            {computePipsDifference(
                              typedSignal.entry_price,
                              tp.value,
                              typedSignal.instrument,
                            )}{" "}
                            pips
                          </Badge>
                        </div>
                      </div>
                    ),
                )}

                <div className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-2">
                  <span className="text-sm text-zinc-500">Created</span>
                  <span className="text-sm text-zinc-400">
                    {formatDateTime(typedSignal.created_at)}
                  </span>
                </div>

                {typedSignal.notes && (
                  <div className="rounded-lg bg-zinc-950 px-3 py-2">
                    <span className="text-xs uppercase text-zinc-500">
                      Notes
                    </span>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-300">
                      {typedSignal.notes}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Lifecycle (client component) */}
          <SignalDetailClient signal={typedSignal} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Preview (client component rendered in the client wrapper) */}
          <SignalDetailClient signal={typedSignal} variant="preview" />

          {/* Event timeline */}
          {typedEvents.length > 0 && (
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader>
                <CardTitle className="text-sm font-medium uppercase tracking-wider text-zinc-400">
                  Event Timeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative space-y-0">
                  {typedEvents.map((event, idx) => (
                    <div key={event.id} className="relative flex gap-3 pb-4">
                      {/* Timeline connector */}
                      {idx < typedEvents.length - 1 && (
                        <div className="absolute left-[7px] top-5 h-full w-px bg-zinc-800" />
                      )}
                      {/* Dot */}
                      <div className="relative mt-1.5 size-[15px] shrink-0 rounded-full border-2 border-zinc-700 bg-zinc-900" />
                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              getStatusColor(event.event_type),
                            )}
                          >
                            {event.event_type.replace("_", " ")}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                          <Clock className="size-3" />
                          {formatDateTime(event.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
