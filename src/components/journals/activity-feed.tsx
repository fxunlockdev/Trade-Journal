"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TradeAuditAction } from "@/types/database";

interface AuditEntry {
  readonly id: string;
  readonly trade_id: string | null;
  readonly actor_user_id: string | null;
  readonly action: TradeAuditAction;
  readonly changed_fields: readonly string[];
  readonly created_at: string;
}

interface ActorInfo {
  readonly id: string;
  readonly email: string | null;
  readonly full_name: string | null;
  readonly avatar_url: string | null;
}

interface Payload {
  readonly data?: readonly AuditEntry[];
  readonly actors?: Record<string, ActorInfo>;
  readonly error?: string;
}

interface ActivityFeedProps {
  /** Either `/api/trades/[id]/audit` (trade view) or `/api/journals/[id]/activity` (journal view). */
  readonly endpoint: string;
  /** Empty-state copy when no entries exist. */
  readonly emptyLabel?: string;
  /** Skip entries with NULL actor (system/backfill rows). Default true. */
  readonly hideSystemRows?: boolean;
}

function initials(info: ActorInfo | undefined): string {
  if (!info) return "?";
  const name = info.full_name ?? "";
  if (name.trim()) {
    return name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return info.email?.[0]?.toUpperCase() ?? "?";
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function describeAction(entry: AuditEntry): string {
  if (entry.action === "created") return "logged this trade";
  if (entry.action === "deleted") return "deleted this trade";

  // updated
  const fields = entry.changed_fields.filter(
    (f) => !["updated_at", "created_at"].includes(f),
  );
  if (fields.length === 0) return "edited this trade";
  if (fields.length <= 3) return `changed ${fields.join(", ")}`;
  return `changed ${fields.slice(0, 3).join(", ")} +${fields.length - 3} more`;
}

function actionDotColor(action: TradeAuditAction): string {
  if (action === "created") return "bg-pos";
  if (action === "deleted") return "bg-neg";
  return "bg-primary";
}

export function ActivityFeed({
  endpoint,
  emptyLabel = "No activity yet.",
  hideSystemRows = true,
}: ActivityFeedProps) {
  const [entries, setEntries] = useState<readonly AuditEntry[]>([]);
  const [actors, setActors] = useState<Record<string, ActorInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        const body = (await res.json()) as Payload;
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? "Failed to load activity");
          return;
        }
        const rows = body.data ?? [];
        setEntries(
          hideSystemRows ? rows.filter((r) => r.actor_user_id !== null) : rows,
        );
        setActors(body.actors ?? {});
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint, hideSystemRows]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-neg">{error}</p>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">{emptyLabel}</p>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const actor = entry.actor_user_id ? actors[entry.actor_user_id] : undefined;
        const displayName =
          actor?.full_name || actor?.email || "A former member";
        return (
          <li
            key={entry.id}
            className="flex items-start gap-3 rounded-md border border-border/40 bg-card/40 px-3 py-2.5"
          >
            <Avatar className="size-7 shrink-0 border border-border">
              {actor?.avatar_url && <AvatarImage src={actor.avatar_url} />}
              <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
                {initials(actor)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-foreground">
                <span className="font-medium">{displayName}</span>{" "}
                <span className="text-muted-foreground">
                  {describeAction(entry)}
                </span>
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    actionDotColor(entry.action),
                  )}
                />
                {timeAgo(entry.created_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
