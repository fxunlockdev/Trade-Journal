"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, PenLine, X } from "lucide-react";

interface OnboardingPromptProps {
  readonly userId: string;
}

export function OnboardingPrompt({ userId }: OnboardingPromptProps) {
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(async () => {
    setDismissed(true);

    try {
      await fetch("/api/chat/onboard", { method: "POST" });
    } catch {
      // Non-critical, user can still use the app
    }
  }, []);

  if (dismissed) {
    return null;
  }

  return (
    <Card className="relative border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 to-zinc-900">
      <button
        onClick={handleDismiss}
        className="absolute right-3 top-3 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold text-zinc-100">
          Welcome to TRDR!
        </h3>
        <p className="mt-1 text-sm text-zinc-400">
          Ready to log your first trade? Choose how you want to get started.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/ai-chat">
            <Button className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500">
              <MessageSquare className="h-4 w-4" />
              Log with AI Chat
            </Button>
          </Link>
          <Link href="/journal/new">
            <Button
              variant="outline"
              className="gap-2 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <PenLine className="h-4 w-4" />
              Manual Entry
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
