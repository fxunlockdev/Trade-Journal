"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Loader2,
  Bot,
  User,
  TrendingUp,
  TrendingDown,
  Plus,
  ChevronLeft,
  MessageSquare,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import type { Trade, ChatMessage } from "@/types/database";

interface TradeChatProps {
  readonly userId: string;
  readonly userName?: string;
  readonly isFirstTime?: boolean;
}

interface DisplayMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly trade?: Trade;
  readonly tradeError?: string;
  readonly createdAt: string;
}

interface SessionGroup {
  readonly label: string;
  readonly dateKey: string;
  readonly messages: readonly DisplayMessage[];
}

/* ─── helpers ─────────────────────────────────────────────── */

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (msgDay.getTime() === today.getTime()) return "Today";
  if (msgDay.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function groupByDate(messages: readonly DisplayMessage[]): SessionGroup[] {
  const map = new Map<string, DisplayMessage[]>();
  for (const msg of messages) {
    const key = dateKey(msg.createdAt);
    const existing = map.get(key) ?? [];
    map.set(key, [...existing, msg]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // newest first in sidebar
    .map(([key, msgs]) => ({
      label: formatDateLabel(msgs[0].createdAt),
      dateKey: key,
      messages: msgs,
    }));
}

function getSessionPreview(msgs: readonly DisplayMessage[]): string {
  const first = msgs.find((m) => m.role === "user");
  if (!first) return "No messages";
  return first.content.length > 42
    ? `${first.content.slice(0, 42)}…`
    : first.content;
}

/* ─── sub-components ──────────────────────────────────────── */

function TradeConfirmationCard({
  trade,
  tradeError,
}: {
  readonly trade: Trade;
  readonly tradeError?: string;
}) {
  const isProfit =
    trade.pnl_absolute !== null ? trade.pnl_absolute >= 0 : null;

  return (
    <Card className="mt-2 border-border bg-muted">
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {trade.direction === "buy" ? (
              <TrendingUp className="h-4 w-4 text-pos" />
            ) : (
              <TrendingDown className="h-4 w-4 text-neg" />
            )}
            <span className="text-sm font-semibold text-foreground">
              {trade.instrument}
            </span>
            <Badge
              variant="outline"
              className={
                trade.direction === "buy"
                  ? "border-pos/30 text-pos"
                  : "border-neg/30 text-neg"
              }
            >
              {trade.direction.toUpperCase()}
            </Badge>
          </div>
          {trade.pnl_absolute !== null && (
            <span
              className={`text-sm font-medium ${isProfit ? "text-pos" : "text-neg"}`}
            >
              {isProfit ? "+" : ""}
              {trade.pnl_absolute.toFixed(2)}
            </span>
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Entry: <span className="text-foreground">{trade.entry_price}</span>
          </span>
          <span>
            Qty: <span className="text-foreground">{trade.quantity}</span>
          </span>
          {trade.exit_price !== null && (
            <span>
              Exit: <span className="text-foreground">{trade.exit_price}</span>
            </span>
          )}
          {trade.stop_loss !== null && (
            <span>
              SL: <span className="text-foreground">{trade.stop_loss}</span>
            </span>
          )}
        </div>
        {tradeError ? (
          <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
            <p className="text-xs font-medium text-destructive">Trade save failed</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{tradeError}</p>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-pos/80">✓ Trade logged</p>
            <Link
              href={`/journal/${trade.id}`}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              View in Journal
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TradeErrorBanner({ error }: { readonly error: string }) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      <div>
        <p className="text-xs font-medium text-destructive">Trade save failed</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
      </div>
    </div>
  );
}

function FormattedContent({ content }: { readonly content: string }) {
  const cleaned = content.replace(/```json[\s\S]*?```/g, "").replace(/```[\s\S]*?```/g, "").trim();
  return <>{cleaned || content}</>;
}

function DateDivider({ label }: { readonly label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function MessageBubble({ message }: { readonly message: DisplayMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-primary" : "bg-primary/10"
        }`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-white" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-primary" />
        )}
      </div>
      <div className={`max-w-[80%] space-y-1 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "rounded-tr-md bg-primary text-white"
              : "rounded-tl-md bg-muted text-foreground"
          }`}
        >
          <FormattedContent content={message.content} />
        </div>
        {message.trade && (
          <TradeConfirmationCard trade={message.trade} tradeError={message.tradeError} />
        )}
        {!message.trade && message.tradeError && (
          <TradeErrorBanner error={message.tradeError} />
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="rounded-2xl rounded-tl-md bg-muted px-4 py-3">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

/* ─── sessions sidebar ────────────────────────────────────── */

function SessionSidebar({
  sessions,
  activeDateKey,
  onSelect,
  onNewChat,
  isOpen,
  onClose,
}: {
  readonly sessions: readonly SessionGroup[];
  readonly activeDateKey: string | null;
  readonly onSelect: (key: string) => void;
  readonly onNewChat: () => void;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}) {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          absolute inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-border bg-card transition-transform duration-200
          lg:relative lg:translate-x-0
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            History
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 lg:hidden"
            onClick={onClose}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        {/* New Chat */}
        <div className="px-3 pb-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 border-border text-sm"
            onClick={onNewChat}
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {sessions.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No conversations yet
            </p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.dateKey}
                onClick={() => onSelect(session.dateKey)}
                className={`
                  mb-0.5 w-full rounded-lg px-3 py-2.5 text-left transition-colors
                  ${
                    activeDateKey === session.dateKey
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }
                `}
              >
                <p className="text-xs font-semibold">{session.label}</p>
                <p className="mt-0.5 truncate text-[11px] opacity-70">
                  {getSessionPreview(session.messages)}
                </p>
                <p className="mt-0.5 text-[10px] opacity-50">
                  {session.messages.length} message
                  {session.messages.length !== 1 ? "s" : ""}
                </p>
              </button>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

/* ─── main component ──────────────────────────────────────── */

export function TradeChat({ userId, userName, isFirstTime }: TradeChatProps) {
  const router = useRouter();
  const [allMessages, setAllMessages] = useState<readonly DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [activeDateKey, setActiveDateKey] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  /* load history on mount */
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch("/api/chat/history");
        if (!res.ok) {
          setIsLoadingHistory(false);
          return;
        }
        const json = (await res.json()) as { data: ReadonlyArray<ChatMessage> };
        const loaded: readonly DisplayMessage[] = json.data
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => {
            // A trade that was never saved must still read as not saved after
            // a reload; the error travels in the message's metadata.
            const meta = (m.metadata ?? null) as { trade_error?: unknown } | null;
            const tradeError =
              typeof meta?.trade_error === "string" ? meta.trade_error : undefined;
            return {
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              createdAt: m.created_at,
              tradeError,
            };
          });
        setAllMessages(loaded);

        // Default to today's session if it exists, else most recent
        const groups = groupByDate(loaded);
        if (groups.length > 0) {
          const todayKey = dateKey(new Date().toISOString());
          const todayGroup = groups.find((g) => g.dateKey === todayKey);
          setActiveDateKey(todayGroup ? todayKey : groups[0].dateKey);
        }
      } catch {
        // silently ignore
      } finally {
        setIsLoadingHistory(false);
      }
    }
    loadHistory();
  }, []);

  /* auto-scroll */
  useEffect(() => {
    scrollToBottom();
  }, [allMessages, isLoading, activeDateKey, scrollToBottom]);

  /* welcome for first-time users */
  useEffect(() => {
    if (!isFirstTime || allMessages.length > 0 || isLoadingHistory) return;
    const welcome: DisplayMessage = {
      id: "welcome",
      role: "assistant",
      content: `Welcome${userName ? `, ${userName}` : ""}! I'm your trade logging assistant. Just tell me about a trade, e.g. "Bought BTC at 77200, sold at 77431", and I'll log it instantly.`,
      createdAt: new Date().toISOString(),
    };
    setAllMessages([welcome]);
    setActiveDateKey(dateKey(welcome.createdAt));
  }, [isFirstTime, userName, allMessages.length, isLoadingHistory]);

  /* derive sessions + filtered messages */
  const sessions = groupByDate(allMessages);
  const todayKey = dateKey(new Date().toISOString());
  const displayMessages =
    activeDateKey === null
      ? allMessages
      : sessions.find((s) => s.dateKey === activeDateKey)?.messages ?? [];

  /* handlers */
  const handleNewChat = useCallback(() => {
    setActiveDateKey(todayKey);
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [todayKey]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const now = new Date().toISOString();
    const userMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: now,
    };

    setAllMessages((prev) => [...prev, userMessage]);
    setActiveDateKey(dateKey(now));
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error ?? "Failed to send message");
      }

      const json = (await res.json()) as {
        message: string;
        trade?: Trade;
        tradeError?: string;
      };

      const aiMessage: DisplayMessage = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: json.message,
        trade: json.trade,
        tradeError: json.tradeError,
        createdAt: new Date().toISOString(),
      };

      setAllMessages((prev) => [...prev, aiMessage]);

      // If a trade was saved, invalidate the server cache so dashboard +
      // journal reflect the new trade immediately on next navigation
      if (json.trade && !json.tradeError) {
        router.refresh();
      }

      if (isFirstTime) {
        fetch("/api/chat/onboard", { method: "POST" }).catch(() => {});
      }
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : "Something went wrong";
      const errMessage: DisplayMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `Sorry, I ran into an error: ${errorText}. Please try again.`,
        createdAt: new Date().toISOString(),
      };
      setAllMessages((prev) => [...prev, errMessage]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, isLoading, isFirstTime]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  /* render date-grouped messages with separators */
  function renderMessages() {
    if (isLoadingHistory) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (displayMessages.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Bot className="mb-3 h-10 w-10 text-muted-foreground/20" />
          <p className="text-sm font-medium text-muted-foreground">
            {activeDateKey === todayKey || activeDateKey === null
              ? "Start by telling me about a trade"
              : "No messages on this day"}
          </p>
          {activeDateKey !== todayKey && activeDateKey !== null && (
            <p className="mt-1 text-xs text-muted-foreground/60">
              Switch to Today to chat
            </p>
          )}
        </div>
      );
    }

    // Group by date within the visible messages to add separators
    const groups = groupByDate(displayMessages).reverse(); // chronological

    return groups.map((group) => (
      <div key={group.dateKey}>
        <DateDivider label={group.label} />
        <div className="space-y-4">
          {group.messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      </div>
    ));
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Sessions sidebar */}
      <SessionSidebar
        sessions={sessions}
        activeDateKey={activeDateKey}
        onSelect={(key) => {
          setActiveDateKey(key);
          setSidebarOpen(false);
        }}
        onNewChat={handleNewChat}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main chat panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          {/* Desktop: toggle sidebar */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-7 w-7 lg:flex"
            onClick={() => setSidebarOpen((o) => !o)}
            title="Toggle history"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-foreground">
            {activeDateKey
              ? sessions.find((s) => s.dateKey === activeDateKey)?.label ?? "Chat"
              : "Chat"}
          </span>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={handleNewChat}
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
        >
          {renderMessages()}
          {isLoading && <TypingIndicator />}
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your trade… e.g. Bought BTC at 77200, sold at 77431"
              disabled={isLoading}
              className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring/50 focus:outline-none focus:ring-1 focus:ring-ring/30 disabled:opacity-50"
            />
            <Button
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              className="h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50"
              size="icon"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
