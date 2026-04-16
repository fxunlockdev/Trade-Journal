"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, Bot, User, TrendingUp, TrendingDown } from "lucide-react";
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
  readonly createdAt: string;
}

function TradeConfirmationCard({ trade }: { readonly trade: Trade }) {
  const isProfit =
    trade.pnl_absolute !== null ? trade.pnl_absolute >= 0 : null;

  return (
    <Card className="mt-2 border-border bg-muted">
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {trade.direction === "buy" ? (
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-400" />
            )}
            <span className="text-sm font-semibold text-foreground">
              {trade.instrument}
            </span>
            <Badge
              variant="outline"
              className={
                trade.direction === "buy"
                  ? "border-emerald-500/30 text-emerald-400"
                  : "border-red-500/30 text-red-400"
              }
            >
              {trade.direction.toUpperCase()}
            </Badge>
          </div>
          {trade.pnl_absolute !== null && (
            <span
              className={`text-sm font-medium ${isProfit ? "text-emerald-400" : "text-red-400"}`}
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
        <p className="mt-2 text-xs text-emerald-400/80">
          Trade logged successfully
        </p>
      </CardContent>
    </Card>
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
      <div
        className={`max-w-[80%] space-y-1 ${isUser ? "items-end" : "items-start"}`}
      >
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "rounded-tr-md bg-primary text-white"
              : "rounded-tl-md bg-muted text-foreground"
          }`}
        >
          <FormattedContent content={message.content} />
        </div>
        {message.trade && <TradeConfirmationCard trade={message.trade} />}
      </div>
    </div>
  );
}

function FormattedContent({ content }: { readonly content: string }) {
  // Strip JSON code blocks from display so user only sees the text part
  const cleanedContent = content.replace(/```json[\s\S]*?```/g, "").trim();

  return <>{cleanedContent || content}</>;
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="rounded-2xl rounded-tl-md bg-muted px-4 py-3">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

export function TradeChat({ userId, userName, isFirstTime }: TradeChatProps) {
  const [messages, setMessages] = useState<readonly DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Load chat history
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch("/api/chat/history");
        if (!res.ok) {
          setIsLoadingHistory(false);
          return;
        }

        const json = (await res.json()) as {
          data: ReadonlyArray<ChatMessage>;
        };

        const loaded: readonly DisplayMessage[] = json.data
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            trade: undefined,
            createdAt: m.created_at,
          }));

        setMessages(loaded);
      } catch {
        // Silently handle - user will see empty chat
      } finally {
        setIsLoadingHistory(false);
      }
    }

    loadHistory();
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // Show welcome message for first-time users
  useEffect(() => {
    if (!isFirstTime || messages.length > 0 || isLoadingHistory) return;

    const welcomeMessage: DisplayMessage = {
      id: "welcome",
      role: "assistant",
      content: `Welcome${userName ? `, ${userName}` : ""}! I'm your trade logging assistant. Tell me about a trade you'd like to log - for example: "I bought 1 lot of EURUSD at 1.0850 today at 9am with a stop loss at 1.0820."`,
      createdAt: new Date().toISOString(),
    };

    setMessages([welcomeMessage]);
  }, [isFirstTime, userName, messages.length, isLoadingHistory]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errJson.error ?? "Failed to send message");
      }

      const json = (await res.json()) as {
        message: string;
        trade?: Trade;
      };

      const aiMessage: DisplayMessage = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: json.message,
        trade: json.trade,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, aiMessage]);

      // Mark user as onboarded after first interaction
      if (isFirstTime) {
        fetch("/api/chat/onboard", { method: "POST" }).catch(() => {
          // Non-critical, silently handle
        });
      }
    } catch (err: unknown) {
      const errorText =
        err instanceof Error ? err.message : "Something went wrong";
      const errMessage: DisplayMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `Sorry, I encountered an error: ${errorText}. Please try again.`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errMessage]);
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

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {isLoadingHistory ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Bot className="mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm text-muted-foreground">
              Tell me about a trade you want to log.
            </p>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
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
            placeholder="Describe your trade..."
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
  );
}
