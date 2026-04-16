"use client";

import { useCallback, useState } from "react";
import { SignalBuilder } from "@/components/signal/signal-builder";
import { SignalPreview } from "@/components/signal/signal-preview";
import type { Signal } from "@/types/database";

export default function NewSignalPage() {
  const [createdSignal, setCreatedSignal] = useState<Signal | null>(null);

  const handleSignalCreated = useCallback((signal: Signal) => {
    setCreatedSignal(signal);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">New Signal</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Build and send a trading signal to your channel
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SignalBuilder onSignalCreated={handleSignalCreated} />

        {createdSignal ? (
          <SignalPreview signal={createdSignal} />
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/50 p-12">
            <p className="text-sm text-zinc-600">
              Create a signal to preview the Telegram message
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
