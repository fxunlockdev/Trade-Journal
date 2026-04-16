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
    <Card className="relative border-indigo-200 bg-gradient-to-r from-indigo-50 to-white">
      <button
        onClick={handleDismiss}
        className="absolute right-3 top-3 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold text-slate-900">
          Welcome to TRDR!
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Ready to log your first trade? Choose how you want to get started.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/ai-chat">
            <Button className="gap-2 bg-indigo-600 text-white hover:bg-indigo-500">
              <MessageSquare className="h-4 w-4" />
              Log with AI Chat
            </Button>
          </Link>
          <Link href="/journal/new">
            <Button
              variant="outline"
              className="gap-2 border-slate-200 text-slate-700 hover:bg-slate-50"
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
