"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import type { Signal } from "@/types/database";

import { SignalLifecycle } from "@/components/signal/signal-lifecycle";
import { SignalPreview } from "@/components/signal/signal-preview";

interface SignalDetailClientProps {
  readonly signal: Signal;
  readonly variant?: "lifecycle" | "preview";
}

export function SignalDetailClient({
  signal,
  variant = "lifecycle",
}: SignalDetailClientProps) {
  const router = useRouter();

  const handleChange = useCallback(() => {
    router.refresh();
  }, [router]);

  if (variant === "preview") {
    return <SignalPreview signal={signal} onUpdate={handleChange} />;
  }

  return <SignalLifecycle signal={signal} onStatusChange={handleChange} />;
}
