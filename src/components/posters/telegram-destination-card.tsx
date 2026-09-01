"use client";

import { useState } from "react";
import { Check, Loader2, Send, Unplug } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Connect the Telegram group that marketing images publish to.
 *
 * Groups appear here only after the user has PROVEN they are in them, by
 * posting a one-time code in the group. Telegram cannot bridge a Trade Journal
 * account to a Telegram account, so that code is the only evidence; listing
 * every chat the bot could see would expose other customers' groups. That is why
 * this asks the user to post in the group first: it is a platform constraint,
 * not a design choice, and saying so beats an empty list with no explanation.
 */

interface TelegramChat {
  readonly id: string;
  readonly title: string;
  readonly type: string;
}

export interface DestinationSummary {
  readonly chat_id: string;
  readonly chat_title: string | null;
  readonly status: string;
  readonly last_error: string | null;
}

export function TelegramDestinationCard({
  destination,
}: {
  readonly destination: DestinationSummary | null;
}) {
  const router = useRouter();
  const [chats, setChats] = useState<readonly TelegramChat[] | null>(null);
  const [busy, setBusy] = useState<"find" | "connect" | "test" | "off" | null>(
    null,
  );
  const [hint, setHint] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const findChats = async (): Promise<void> => {
    setBusy("find");
    try {
      const res = await fetch("/api/telegram/chats");
      const json: {
        data?: TelegramChat[];
        error?: string;
        meta?: { hint?: string | null; code?: string | null };
      } = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't reach Telegram.");
        return;
      }
      setChats(json.data ?? []);
      if ((json.data ?? []).length === 0) {
        // The server knows what it actually saw; repeating one guessed cause
        // here would send someone to fix the wrong thing.
        setHint(json.meta?.hint ?? null);
        setCode(json.meta?.code ?? null);
      } else {
        setHint(null);
      }
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const connect = async (chat: TelegramChat): Promise<void> => {
    setBusy("connect");
    try {
      const res = await fetch("/api/telegram/destination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat.id, chat_title: chat.title }),
      });
      const json: { error?: string } = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't connect that group.");
        return;
      }
      toast.success(`Connected to ${chat.title}`);
      setChats(null);
      router.refresh();
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async (): Promise<void> => {
    setBusy("test");
    try {
      const res = await fetch("/api/telegram/test", { method: "POST" });
      const json: { error?: string } = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Test failed.");
        router.refresh();
        return;
      }
      toast.success("Test message sent. Check the group.");
      router.refresh();
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy("off");
    try {
      await fetch("/api/telegram/destination", { method: "DELETE" });
      toast.success("Disconnected.");
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-3 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Telegram
        </p>

        {destination ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  destination.status === "connected" ? "bg-pos" : "bg-warn",
                )}
                aria-hidden
              />
              <span className="font-medium text-foreground">
                {destination.chat_title ?? destination.chat_id}
              </span>
            </div>

            {/*
              A destination that worked once can stop working — the bot removed
              from the group, or muted. Surfaced here rather than discovered at
              06:00 when nobody is watching.
            */}
            {destination.status === "error" && (
              <p className="text-xs text-warn" data-testid="telegram-error">
                Last attempt failed. Check the bot is still in the group and
                allowed to post.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={busy !== null}
                onClick={() => void sendTest()}
                data-testid="telegram-test"
              >
                {busy === "test" ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-2 h-3.5 w-3.5" />
                )}
                Send test message
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => void disconnect()}
                className="text-muted-foreground"
                data-testid="telegram-disconnect"
              >
                <Unplug className="h-3.5 w-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Add <span className="font-medium">@TradingJournalImagesBot</span>{" "}
              to your marketing group and post a message there, then find it
              below. Telegram only shows a bot the groups it has seen activity
              in.
            </p>

            {/*
              Shown whenever a code exists, not only when the list is empty:
              someone adding a SECOND group needs it just as much, and hiding it
              behind an empty state makes that look impossible.
            */}
            {code && (
              <div className="space-y-1" data-testid="telegram-claim-code">
                <p className="text-xs text-muted-foreground">
                  Post this in the group you want to publish to, so the bot
                  knows you are in it:
                </p>
                <code className="block select-all rounded-md border border-border bg-muted/40 px-2 py-1.5 text-center text-sm font-semibold tracking-widest">
                  {code}
                </code>
                <p className="text-xs text-muted-foreground">
                  Then press Find my groups again. The code lasts 15 minutes.
                </p>
              </div>
            )}

            {hint && !code && (
              <p className="text-xs text-warn" data-testid="telegram-hint">
                {hint}
              </p>
            )}

            {chats === null ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={busy !== null}
                onClick={() => void findChats()}
                data-testid="telegram-find"
              >
                {busy === "find" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Find my groups
              </Button>
            ) : (
              <div className="space-y-1.5">
                {chats.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void connect(c)}
                    data-testid={`telegram-chat-${c.id}`}
                    className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
                  >
                    <span className="truncate">{c.title}</span>
                    <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => void findChats()}
                  disabled={busy !== null}
                >
                  Refresh
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
