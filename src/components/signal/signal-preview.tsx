"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Send, Sparkles, Pencil, Check, X, Info, Loader2 } from "lucide-react";

import type { Signal } from "@/types/database";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface SignalPreviewProps {
  readonly signal: Signal;
  readonly onUpdate?: () => void;
}

export function SignalPreview({ signal, onUpdate }: SignalPreviewProps) {
  const [message, setMessage] = useState(signal.formatted_message ?? "");
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [formatting, setFormatting] = useState(false);
  const [sending, setSending] = useState(false);

  const handleFormat = useCallback(async () => {
    setFormatting(true);
    try {
      const res = await fetch("/api/signals/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal_id: signal.id }),
      });

      if (!res.ok) {
        const body = await res.json();
        toast.error(body.error ?? "Failed to format signal");
        return;
      }

      const { data } = await res.json();
      setMessage(data.formatted_message);
      toast.success("Signal formatted");
      onUpdate?.();
    } catch {
      toast.error("Failed to format signal");
    } finally {
      setFormatting(false);
    }
  }, [signal.id, onUpdate]);

  const handleSend = useCallback(async () => {
    setSending(true);
    try {
      const res = await fetch("/api/signals/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal_id: signal.id }),
      });

      if (!res.ok) {
        const body = await res.json();
        toast.error(body.error ?? "Failed to send signal");
        return;
      }

      toast.success("Signal sent to Telegram");
      onUpdate?.();
    } catch {
      toast.error("Failed to send signal");
    } finally {
      setSending(false);
    }
  }, [signal.id, onUpdate]);

  const startEditing = useCallback(() => {
    setEditDraft(message);
    setEditing(true);
  }, [message]);

  const saveEdit = useCallback(async () => {
    try {
      const res = await fetch(`/api/signals/${signal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formatted_message: editDraft }),
      });

      if (!res.ok) {
        const body = await res.json();
        toast.error(body.error ?? "Failed to update message");
        return;
      }

      setMessage(editDraft);
      setEditing(false);
      toast.success("Message updated");
      onUpdate?.();
    } catch {
      toast.error("Failed to update message");
    }
  }, [signal.id, editDraft, onUpdate]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditDraft("");
  }, []);

  const hasTelegramConfig =
    typeof window !== "undefined" || true; // server can't check env, shown as info

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-slate-500">
          Signal Preview
        </CardTitle>
        <div className="flex items-center gap-2">
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={startEditing}
              className="h-7 gap-1.5 text-xs text-slate-500 hover:text-slate-800"
            >
              <Pencil className="size-3" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Telegram-style message card */}
        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-inner">
          {editing ? (
            <div className="space-y-3">
              <Textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                className="min-h-[120px] border-slate-200 bg-white font-mono text-sm text-slate-800 placeholder:text-slate-400"
                placeholder="Edit your signal message..."
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelEdit}
                  className="h-7 gap-1 text-xs text-slate-500"
                >
                  <X className="size-3" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={saveEdit}
                  className="h-7 gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                >
                  <Check className="size-3" />
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">
              {message || (
                <span className="text-slate-400 italic">
                  No message generated yet. Click &quot;Format with AI&quot; to generate.
                </span>
              )}
            </pre>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleFormat}
            disabled={formatting}
            className="gap-1.5 border-slate-200 bg-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
          >
            {formatting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5 text-amber-400" />
            )}
            Format with AI
          </Button>

          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  size="sm"
                  disabled={sending || !message}
                  className="gap-1.5 bg-blue-600 text-white hover:bg-blue-500"
                >
                  {sending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  Send to Telegram
                </Button>
              }
            />
            <AlertDialogContent className="border-slate-200 bg-white">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-slate-900">
                  Send this signal to Telegram?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-slate-500">
                  This will broadcast the signal message to your configured
                  Telegram channel. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-slate-200 bg-slate-200 text-slate-700 hover:bg-slate-100">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleSend}
                  className="bg-blue-600 text-white hover:bg-blue-500"
                >
                  Send
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Telegram config info */}
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white/50 p-3">
          <Info className="mt-0.5 size-3.5 shrink-0 text-blue-400" />
          <p className="text-xs leading-relaxed text-slate-500">
            Telegram integration requires{" "}
            <code className="rounded bg-slate-200 px-1 py-0.5 text-slate-500">
              TELEGRAM_BOT_TOKEN
            </code>{" "}
            and{" "}
            <code className="rounded bg-slate-200 px-1 py-0.5 text-slate-500">
              TELEGRAM_CHAT_ID
            </code>{" "}
            environment variables.
          </p>
        </div>

        {/* Show telegram_message_id after send */}
        {signal.telegram_message_id && (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-blue-500/20 bg-blue-500/10 text-xs text-blue-400"
            >
              Sent
            </Badge>
            <span className="font-mono text-xs text-slate-500">
              Message ID: {signal.telegram_message_id}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
