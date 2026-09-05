"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BOT_HANDLE } from "@/lib/telegram/bot";
import type { JournalWithRole } from "@/types/database";

/**
 * Signal rooms the bot listens in, and what it did with them.
 *
 * The bot reads every message in a connected room, logs each signal as a
 * trade in the room's journal, applies the result replies, and never posts.
 * Connecting a room is proving you are in it: post a code there once; the
 * bot notices it silently and the room appears here.
 */

interface SourceTopic { readonly threadId: number; readonly name: string | null; readonly sample: string | null; readonly messageCount: number }
interface Source { readonly chatId: string; readonly chatType: string; readonly title: string; readonly topics: readonly SourceTopic[] }
interface FeedView {
  readonly id: string; readonly chatId: string; readonly threadId: number | null; readonly title: string | null;
  readonly journalId: string; readonly defaultLots: number; readonly enabled: boolean; readonly connectedAt: string;
  readonly counts: { readonly applied: number; readonly review: number };
}
interface ReviewItem {
  readonly chatId: string; readonly messageId: number; readonly kind: string; readonly reason: string | null;
  readonly sender: string | null; readonly text: string; readonly postedAt: string; readonly room: string | null;
}

interface Props {
  readonly journals: readonly JournalWithRole[];
}

const POLL_MS = 4000;
const inputClass = "h-9 rounded-md border border-border bg-background px-2 text-sm";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SignalRoomsCard({ journals }: Props) {
  const writable = journals.filter((j) => j.my_role === "owner" || j.my_role === "member");
  const [feeds, setFeeds] = useState<readonly FeedView[]>([]);
  const [sources, setSources] = useState<readonly Source[]>([]);
  const [review, setReview] = useState<readonly ReviewItem[]>([]);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ chatId: string; threadId: number | null; journalId: string; lots: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([fetch("/api/telegram/feeds"), fetch("/api/telegram/feeds/review")]);
      const ja = await a.json();
      const jb = await b.json();
      if (a.ok) { setFeeds(ja.data.feeds); setSources(ja.data.sources); }
      if (b.ok) setReview(jb.data);
    } catch {
      // Neutral state rather than a wrong one.
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // While a code is out, watch for the room to appear; stop when it expires.
  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => {
      if (new Date(code.expiresAt).getTime() <= Date.now()) { setCode(null); return; }
      void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [code, refresh]);

  const getCode = async (): Promise<void> => {
    setBusy("code");
    try {
      const res = await fetch("/api/telegram/feeds/code", { method: "POST" });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Couldn't get a code."); return; }
      setCode({ code: json.data.code, expiresAt: json.data.expiresAt });
    } catch { toast.error("Couldn't reach the server."); } finally { setBusy(null); }
  };

  const connect = async (): Promise<void> => {
    if (!draft) return;
    const lots = Number(draft.lots);
    if (!draft.journalId || !(lots > 0)) { toast.error("Pick a journal and a size in lots."); return; }
    setBusy("connect");
    try {
      const source = sources.find((s) => s.chatId === draft.chatId);
      const topic = source?.topics.find((t) => t.threadId === draft.threadId);
      const title = source ? `${source.title}${topic ? ` › ${topic.name ?? `topic ${topic.threadId}`}` : ""}` : null;
      const res = await fetch("/api/telegram/feeds", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: draft.chatId, threadId: draft.threadId, journalId: draft.journalId, defaultLots: lots, title }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Couldn't connect the room."); return; }
      toast.success("Listening. Trades from that room will appear in the journal.");
      setDraft(null);
      setCode(null);
      await refresh();
    } catch { toast.error("Couldn't reach the server."); } finally { setBusy(null); }
  };

  const patch = async (id: string, body: Record<string, unknown>): Promise<void> => {
    setBusy(id);
    try {
      const res = await fetch(`/api/telegram/feeds/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); toast.error(j.error ?? "Couldn't update."); return; }
      await refresh();
    } catch { toast.error("Couldn't reach the server."); } finally { setBusy(null); }
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      const res = await fetch(`/api/telegram/feeds/${id}`, { method: "DELETE" });
      if (!res.ok) { toast.error("Couldn't disconnect."); return; }
      toast.success("Stopped listening. The trades already logged stay in the journal.");
      await refresh();
    } catch { toast.error("Couldn't reach the server."); } finally { setBusy(null); }
  };

  const ignore = async (item: ReviewItem): Promise<void> => {
    setBusy(`${item.chatId}:${item.messageId}`);
    try {
      const res = await fetch("/api/telegram/feeds/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: item.chatId, messageId: item.messageId, action: "ignore" }) });
      if (!res.ok) { toast.error("Couldn't update."); return; }
      setReview((r) => r.filter((x) => !(x.chatId === item.chatId && x.messageId === item.messageId)));
    } catch { toast.error("Couldn't reach the server."); } finally { setBusy(null); }
  };

  const journalName = (id: string): string => journals.find((j) => j.id === id)?.name ?? "Unknown journal";
  const isConnected = (chatId: string, threadId: number | null): boolean => feeds.some((f) => f.chatId === chatId && f.threadId === threadId);
  const candidates = sources.flatMap((s) => [
    ...(s.topics.length === 0 || s.chatType === "channel" ? [{ chatId: s.chatId, threadId: null as number | null, label: s.title, sample: null as string | null }] : []),
    ...s.topics.map((t) => ({ chatId: s.chatId, threadId: t.threadId as number | null, label: `${s.title} › ${t.name ?? `topic ${t.threadId}`}`, sample: t.sample })),
  ]).filter((c) => !isConnected(c.chatId, c.threadId));

  return (
    <Card className="border-border bg-card" data-testid="signal-rooms-card">
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Signal rooms</p>
          <p className="text-sm text-muted-foreground">
            The bot listens in a room and logs its signals and results into a journal, silently. Traders post as they
            always have; nothing is asked and nothing is posted back.
          </p>
        </div>

        {feeds.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border" data-testid="signal-rooms-list">
            {feeds.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{f.title ?? f.chatId}</p>
                  <p className="text-xs text-muted-foreground">
                    → {journalName(f.journalId)} · {f.defaultLots} lots · {f.counts.applied} logged
                    {f.counts.review > 0 ? ` · ${f.counts.review} to review` : ""} · since {formatWhen(f.connectedAt)}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={busy === f.id} onClick={() => void patch(f.id, { enabled: !f.enabled })}>
                  {f.enabled ? "Pause" : "Resume"}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy === f.id} onClick={() => void remove(f.id)}>
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}

        {draft ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">{candidates.find((c) => c.chatId === draft.chatId && c.threadId === draft.threadId)?.label}</p>
            <div className="flex flex-wrap items-center gap-2">
              <select className={inputClass} value={draft.journalId} onChange={(e) => setDraft({ ...draft, journalId: e.target.value })} aria-label="Journal">
                <option value="">Journal…</option>
                {writable.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
              <input className={`${inputClass} w-24`} inputMode="decimal" value={draft.lots} onChange={(e) => setDraft({ ...draft, lots: e.target.value })} aria-label="Lots per trade" placeholder="lots" />
              <Button type="button" size="sm" disabled={busy === "connect"} onClick={() => void connect()}>Start listening</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground">Every trade from this room is logged at this size; signals don&apos;t say one.</p>
          </div>
        ) : candidates.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Rooms the bot can hear:</p>
            <ul className="space-y-1">
              {candidates.map((c) => (
                <li key={`${c.chatId}:${c.threadId ?? "all"}`} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{c.label}{c.sample ? <span className="text-muted-foreground"> · “{c.sample.slice(0, 40)}…”</span> : null}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => setDraft({ chatId: c.chatId, threadId: c.threadId, journalId: "", lots: "1" })}>Connect</Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {code ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Post this code in the room (an admin can delete the message afterwards). The bot confirms silently; the room appears above.
            </p>
            <code className="block select-all rounded-md border border-border bg-muted/40 px-2 py-2 text-center text-lg font-semibold tracking-widest">{code.code}</code>
            <p className="text-xs text-muted-foreground">{BOT_HANDLE} must be in the room as an admin.</p>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={busy === "code"} onClick={() => void getCode()} data-testid="signal-rooms-code">
            {busy === "code" ? "Getting a code..." : "Connect a room"}
          </Button>
        )}

        {review.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">To review ({review.length})</p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {review.map((item) => (
                <li key={`${item.chatId}:${item.messageId}`} className="space-y-1 px-3 py-2 text-sm">
                  <p className="text-xs text-muted-foreground">{item.room ?? item.chatId} · {item.sender ?? "unknown"} · {formatWhen(item.postedAt)}</p>
                  <p className="whitespace-pre-wrap break-words">{item.text}</p>
                  <div className="flex items-center gap-2">
                    <p className="flex-1 text-xs text-warn">{item.reason}</p>
                    <Button type="button" size="sm" variant="ghost" disabled={busy === `${item.chatId}:${item.messageId}`} onClick={() => void ignore(item)}>Ignore</Button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Log these by hand if they are real; ignoring keeps them out of the journal.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
