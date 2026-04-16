"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import type { Signal } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

import { SignalBuilder } from "@/components/signal/signal-builder";
import { SignalPreview } from "@/components/signal/signal-preview";

export default function NewSignalPage() {
  const [createdSignal, setCreatedSignal] = useState<Signal | null>(null);

  const handleSignalCreated = useCallback(async (signal: Signal) => {
    // Re-fetch to get computed fields from the server
    const supabase = createClient();
    const { data } = await supabase
      .from("signals")
      .select("*")
      .eq("id", signal.id)
      .single();

    setCreatedSignal((data as Signal) ?? signal);
  }, []);

  const handlePreviewUpdate = useCallback(async () => {
    if (!createdSignal) return;

    const supabase = createClient();
    const { data } = await supabase
      .from("signals")
      .select("*")
      .eq("id", createdSignal.id)
      .single();

    if (data) {
      setCreatedSignal(data as Signal);
    }
  }, [createdSignal]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/signals"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ArrowLeft className="size-3.5" />
          Back to Signals
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-100">
          New Signal
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Set up your trade signal with entry, targets, and stop loss.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SignalBuilder onSignalCreated={handleSignalCreated} />
        </div>
        <div>
          {createdSignal ? (
            <div className="lg:sticky lg:top-6">
              <SignalPreview
                signal={createdSignal}
                onUpdate={handlePreviewUpdate}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-24 text-center lg:sticky lg:top-6">
              <p className="text-sm text-zinc-600">
                Signal preview will appear here after creation.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
