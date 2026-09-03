"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BOT_HANDLE } from "@/lib/telegram/bot";

/**
 * Link this account to a Telegram account, so trades can be logged by DM.
 *
 * The bot has no way to know who is typing until this is done: a Telegram
 * account and a Trade Journal account are unrelated identities. The code shown
 * here, sent to the bot FROM the Telegram account to be linked, is the proof.
 *
 * Deliberately a DM, not a group. The marketing channel has partners in it.
 */

interface LinkStatus {
  readonly linked: boolean;
  readonly linkedAt: string | null;
  readonly lastSeenAt: string | null;
}

interface LinkCode {
  readonly code: string;
  readonly expiresAt: string;
  readonly ttlMinutes: number;
}

const POLL_MS = 4000;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TelegramLinkCard() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [code, setCode] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState<"code" | "unlink" | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram/link");
      const json = await res.json();
      if (res.ok) setStatus(json.data);
    } catch {
      // Left null: the card renders its neutral state rather than a wrong one.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A clock while a code is showing, so the countdown moves and the code is
  // retired the moment it expires -- which is also what stops the poll below.
  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code]);

  const msLeft = code ? new Date(code.expiresAt).getTime() - now : 0;
  useEffect(() => {
    if (code && msLeft <= 0) setCode(null);
  }, [code, msLeft]);

  // Polled while a LIVE code is outstanding, so the card flips to "linked" on
  // its own when the message lands, without a "check again" button. Ends
  // when linked, when the code expires, and on unmount.
  useEffect(() => {
    if (!code || status?.linked) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [code, status?.linked, refresh]);

  useEffect(() => {
    if (status?.linked) setCode(null);
  }, [status?.linked]);

  const getCode = async (): Promise<void> => {
    setBusy("code");
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't get a code.");
        return;
      }
      setNow(Date.now());
      setCode({
        code: json.data.code,
        expiresAt: json.data.expiresAt,
        ttlMinutes: json.data.ttlMinutes ?? 15,
      });
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const unlink = async (): Promise<void> => {
    setBusy("unlink");
    try {
      const res = await fetch("/api/telegram/link", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't unlink.");
        return;
      }
      if (json.data?.removed === 0) {
        toast.message("Nothing to unlink. This account wasn't linked.");
      } else {
        toast.success("Unlinked. Trades can no longer be logged from that Telegram account.");
      }
      setStatus({ linked: false, linkedAt: null, lastSeenAt: null });
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-border bg-card" data-testid="telegram-link-card">
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Log trades from Telegram
          </p>
          <p className="text-sm text-muted-foreground">
            Message the bot a trade in plain words, pick the journal, done. It
            shows you exactly what it understood before saving anything.
          </p>
        </div>

        {status?.linked ? (
          <div className="space-y-3">
            <p className="text-sm text-pos" data-testid="telegram-linked">
              Linked to your Telegram account
              {status.linkedAt ? ` since ${formatWhen(status.linkedAt)}` : ""}.
              {status.lastSeenAt ? ` Last message ${formatWhen(status.lastSeenAt)}.` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Send {BOT_HANDLE} something like{" "}
              <code className="rounded bg-muted/40 px-1">
                XAUUSD buy 3340 sl 3335 tp1 3350 closed 3348
              </code>
              , or just describe it: &ldquo;bought gold at 3340 this morning, stop 3335, out at 3348&rdquo;.
              Say what happened (an exit price, <code className="rounded bg-muted/40 px-1">tp1 hit</code>,{" "}
              <code className="rounded bg-muted/40 px-1">sl</code>,{" "}
              <code className="rounded bg-muted/40 px-1">be</code> or{" "}
              <code className="rounded bg-muted/40 px-1">still open</code>). The bot then asks for anything
              missing: size, date, how it felt, tags and notes, each with buttons or Skip. Send it{" "}
              <code className="rounded bg-muted/40 px-1">/quick</code> to be asked only for size and date. One
              trade per message.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void unlink()}
              data-testid="telegram-unlink"
            >
              {busy === "unlink" ? "Unlinking..." : "Unlink"}
            </Button>
          </div>
        ) : code ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Open a chat with {BOT_HANDLE} and send it this code:
            </p>
            <code className="block select-all rounded-md border border-border bg-muted/40 px-2 py-2 text-center text-lg font-semibold tracking-widest">
              {code.code}
            </code>
            <p className="text-xs text-muted-foreground" data-testid="telegram-code-expiry">
              Expires in {formatRemaining(msLeft)}. This page updates by itself
              once the bot has it.
            </p>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void getCode()}
            data-testid="telegram-get-code"
          >
            {busy === "code" ? "Getting a code..." : "Link my Telegram"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
