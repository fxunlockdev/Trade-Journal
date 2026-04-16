"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { generateSignalMessage } from "@/lib/signals/templates";
import type { Signal } from "@/types/database";
import { Sparkles, Send, Loader2, Info } from "lucide-react";

interface SignalPreviewProps {
  readonly signal: Signal;
}

export function SignalPreview({ signal }: SignalPreviewProps) {
  const [message, setMessage] = useState<string>(
    signal.formatted_message ?? generateSignalMessage(signal),
  );
  const [formatting, setFormatting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleFormatWithAI = useCallback(async () => {
    setFormatting(true);
    try {
      const response = await fetch("/api/signals/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signal),
      });

      const result = await response.json();

      if (result.success && result.data?.message) {
        setMessage(result.data.message);
      }
    } catch {
      // Silently fall back to current message
    } finally {
      setFormatting(false);
    }
  }, [signal]);

  const handleSend = useCallback(async () => {
    setSending(true);
    setSendError(null);
    setSendSuccess(false);

    try {
      const response = await fetch("/api/signals/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal_id: signal.id }),
      });

      const result = await response.json();

      if (!result.success) {
        setSendError(result.error ?? "Failed to send");
        return;
      }

      setSendSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setSendError(msg);
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  }, [signal.id]);

  const isTelegramConfigured =
    typeof window !== "undefined";

  return (
    <Card className="border-zinc-800 bg-zinc-950">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-zinc-100">
            Message Preview
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFormatWithAI}
            disabled={formatting}
            className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          >
            {formatting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Format with AI
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Telegram-style preview */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-zinc-200">
            {message}
          </pre>
        </div>

        {/* Editable textarea */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500">
            Edit message before sending
          </label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-[120px] resize-y border-zinc-800 bg-zinc-900 font-mono text-sm text-zinc-100"
          />
        </div>

        {/* Status messages */}
        {sendError && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
            {sendError}
          </div>
        )}

        {sendSuccess && (
          <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-400">
            Signal sent to Telegram successfully.
          </div>
        )}

        {/* Telegram info badge */}
        {!sendSuccess && (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-zinc-700 text-zinc-400"
            >
              <Info className="mr-1 h-3 w-3" />
              Sends via Telegram bot
            </Badge>
          </div>
        )}

        {/* Send button with confirmation */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger
            render={
              <Button
                className="w-full bg-blue-600 text-white hover:bg-blue-500"
                disabled={sending || sendSuccess}
              />
            }
          >
            <Send className="mr-2 h-4 w-4" />
            Send to Telegram
          </DialogTrigger>
          <DialogContent className="border-zinc-800 bg-zinc-950">
            <DialogHeader>
              <DialogTitle className="text-zinc-100">
                Send Signal to Telegram
              </DialogTitle>
              <DialogDescription className="text-zinc-400">
                This will send the signal message to your configured Telegram
                channel. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                className="border-zinc-700 text-zinc-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSend}
                disabled={sending}
                className="bg-blue-600 text-white hover:bg-blue-500"
              >
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Confirm Send"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
