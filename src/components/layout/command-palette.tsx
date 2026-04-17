"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  LayoutDashboard,
  BookOpen,
  Plus,
  MessageSquare,
  Lightbulb,
  Calculator,
  Radio,
  Settings as SettingsIcon,
  Search,
  ArrowLeft,
  ArrowRight,
  Check,
  TrendingUp,
  TrendingDown,
  ExternalLink,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ALL_INSTRUMENTS,
  CRYPTO_PAIRS,
  COMMODITIES,
  FOREX_PAIRS,
  INDICES,
  METALS,
} from "@/lib/constants/instruments";
import type { AssetType, TradeDirection } from "@/types/database";

interface CommandAction {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon: React.ElementType;
  readonly href: string;
  readonly keywords?: readonly string[];
  readonly shortcut?: string;
  /** Restrict to roles with publishing privilege. */
  readonly traderOnly?: boolean;
}

const NAV_ACTIONS: readonly CommandAction[] = [
  {
    id: "dashboard",
    label: "Go to Dashboard",
    icon: LayoutDashboard,
    href: "/dashboard",
    keywords: ["home", "overview"],
  },
  {
    id: "journal",
    label: "Go to Journal",
    icon: BookOpen,
    href: "/journal",
    keywords: ["trades", "history", "log"],
  },
  {
    id: "ai-chat",
    label: "AI Trade Chat",
    icon: MessageSquare,
    href: "/ai-chat",
    keywords: ["ai", "gpt", "assistant"],
  },
  {
    id: "insights",
    label: "AI Insights",
    icon: Lightbulb,
    href: "/insights",
    keywords: ["analysis", "review"],
  },
  {
    id: "risk-calc",
    label: "Risk Calculator",
    icon: Calculator,
    href: "/risk-calculator",
    keywords: ["risk", "position", "sizing", "lots"],
  },
  {
    id: "settings",
    label: "Settings",
    icon: SettingsIcon,
    href: "/settings",
    keywords: ["profile", "account", "preferences"],
  },
];

interface CreateAction extends CommandAction {
  /** When true, selecting this action opens the inline wizard instead of navigating. */
  readonly inlineWizard?: "add-trade";
}

const CREATE_ACTIONS: readonly CreateAction[] = [
  {
    id: "new-trade",
    label: "Add Trade",
    hint: "@trade — log inline without leaving this page",
    icon: Plus,
    href: "/journal/new",
    keywords: ["new", "log", "create", "trade", "@trade"],
    shortcut: "T",
    inlineWizard: "add-trade",
  },
  {
    id: "new-signal",
    label: "New Signal",
    hint: "@signal",
    icon: Radio,
    href: "/signals/new",
    keywords: ["new", "signal", "create", "publish", "@signal"],
    shortcut: "S",
    traderOnly: true,
  },
];

interface CommandPaletteProps {
  readonly role: string;
}

/**
 * Maps an instrument symbol to its asset_type. The enum has to match the
 * DB's asset_type check constraint (see validators/trade.ts). Fallback to
 * "forex" — the most common case — rather than crashing the wizard.
 */
function inferAssetType(instrument: string): AssetType {
  const upper = instrument.trim().toUpperCase();
  if ((FOREX_PAIRS as readonly string[]).includes(upper)) return "forex";
  if ((CRYPTO_PAIRS as readonly string[]).includes(upper)) return "crypto";
  if ((METALS as readonly string[]).includes(upper)) return "metal";
  if ((INDICES as readonly string[]).includes(upper)) return "index";
  if ((COMMODITIES as readonly string[]).includes(upper)) return "commodity";
  return "forex";
}

type WizardStep =
  | "instrument"
  | "direction"
  | "entry"
  | "quantity"
  | "stop_loss"
  | "take_profit"
  | "exit"
  | "review";

const STEP_ORDER: readonly WizardStep[] = [
  "instrument",
  "direction",
  "entry",
  "quantity",
  "stop_loss",
  "take_profit",
  "exit",
  "review",
];

interface WizardState {
  readonly instrument: string;
  readonly direction: TradeDirection;
  readonly entry_price: string;
  readonly quantity: string;
  readonly stop_loss: string;
  readonly take_profit: string;
  readonly exit_price: string;
}

const INITIAL_WIZARD: WizardState = {
  instrument: "",
  direction: "buy",
  entry_price: "",
  quantity: "",
  stop_loss: "",
  take_profit: "",
  exit_price: "",
};

/**
 * Cmd+K (Ctrl+K on Windows/Linux) opens a fuzzy-search command palette
 * with quick-access actions. Typing "@trade" jumps straight to Add Trade,
 * "@signal" to New Signal (trader/admin only).
 *
 * "Add Trade" opens an INLINE multi-step wizard inside the palette instead
 * of navigating to /journal/new. Submits directly to /api/trades so the
 * trade appears in the journal. Full form is still available via the
 * "Open full form" fallback action.
 *
 * Mounted once in AppShell so shortcuts are globally available regardless
 * of route. Visibility state is local — nothing to persist between sessions.
 */
export function CommandPalette({ role }: CommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"nav" | "add-trade">("nav");
  const [step, setStep] = useState<WizardStep>("instrument");
  const [wizard, setWizard] = useState<WizardState>(INITIAL_WIZARD);
  const [submitting, setSubmitting] = useState(false);

  const canPublishSignals = role === "trader" || role === "admin";

  const createActions = useMemo(
    () => CREATE_ACTIONS.filter((a) => !a.traderOnly || canPublishSignals),
    [canPublishSignals],
  );

  // Reset wizard whenever the palette closes so re-opening starts fresh.
  useEffect(() => {
    if (!open) {
      setMode("nav");
      setStep("instrument");
      setWizard(INITIAL_WIZARD);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    // Listen for Cmd+K / Ctrl+K globally. Guard against triggering while the
    // user is mid-typing in an <input> or <textarea> — modern browsers still
    // fire keydown there, and Cmd+K in Gmail-like apps does NOT steal focus.
    // But here the palette IS the intended action, so we accept it anyway.
    const keyHandler = (e: KeyboardEvent) => {
      const isCmdK =
        (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (!isCmdK) return;
      e.preventDefault();
      setOpen((prev) => !prev);
    };
    // Non-keyboard trigger: the Topbar search button dispatches this event
    // so we have one source of truth for palette visibility.
    const openHandler = () => setOpen(true);
    window.addEventListener("keydown", keyHandler);
    window.addEventListener("trdr:open-command-palette", openHandler);
    return () => {
      window.removeEventListener("keydown", keyHandler);
      window.removeEventListener("trdr:open-command-palette", openHandler);
    };
  }, []);

  const runAction = useCallback(
    (action: CreateAction | CommandAction) => {
      if ("inlineWizard" in action && action.inlineWizard === "add-trade") {
        setMode("add-trade");
        setStep("instrument");
        return;
      }
      setOpen(false);
      router.push(action.href);
    },
    [router],
  );

  const cancelWizard = useCallback(() => {
    setMode("nav");
    setStep("instrument");
    setWizard(INITIAL_WIZARD);
  }, []);

  const goToStep = useCallback((next: WizardStep) => {
    setStep(next);
  }, []);

  const goNext = useCallback(() => {
    setStep((current) => {
      const idx = STEP_ORDER.indexOf(current);
      if (idx < 0 || idx >= STEP_ORDER.length - 1) return current;
      return STEP_ORDER[idx + 1];
    });
  }, []);

  const goBack = useCallback(() => {
    setStep((current) => {
      const idx = STEP_ORDER.indexOf(current);
      if (idx <= 0) return current;
      return STEP_ORDER[idx - 1];
    });
  }, []);

  const updateWizard = useCallback(
    <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
      setWizard((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const submitWizard = useCallback(async () => {
    // Re-validate critical numeric fields at submit time. Each step also
    // blocks "Next" until valid, but defence-in-depth since wizard state can
    // be mutated via Back/Forward.
    const entry = Number(wizard.entry_price);
    const qty = Number(wizard.quantity);
    if (!wizard.instrument || !Number.isFinite(entry) || entry <= 0) {
      toast.error("Instrument and entry price are required");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Quantity must be positive");
      return;
    }

    const toNum = (v: string): number | null => {
      const trimmed = v.trim();
      if (!trimmed) return null;
      const n = Number(trimmed);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const payload = {
      instrument: wizard.instrument.toUpperCase(),
      asset_type: inferAssetType(wizard.instrument),
      direction: wizard.direction,
      entry_price: entry,
      quantity: qty,
      stop_loss: toNum(wizard.stop_loss),
      take_profit: toNum(wizard.take_profit),
      exit_price: toNum(wizard.exit_price),
      fees: 0,
      tags: [] as string[],
      notes: null,
      entry_time: new Date().toISOString(),
      source: "manual" as const,
    };

    setSubmitting(true);
    try {
      const response = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error ?? "Failed to log trade");
        return;
      }
      toast.success("Trade logged");
      setOpen(false);
      // Refresh any active server-rendered route (journal/dashboard) so the
      // new trade shows up without a hard reload.
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unexpected error logging trade";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }, [wizard, router]);

  const stepIndex = STEP_ORDER.indexOf(step);
  const stepNumber = stepIndex + 1;
  const stepTotal = STEP_ORDER.length;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Jump to any page or add a trade swiftly"
    >
      {mode === "nav" ? (
        /* cmdk primitives (Input/List/Item) require a <Command> ancestor to
            register with. CommandDialog intentionally omits it so consumers
            can pass their own <Command> with custom props — forgetting it
            throws "no command menu found" on open. */
        <Command>
          <CommandInput placeholder="Type a command, page, or @trade…" />
          <CommandList>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-2 py-4 text-muted-foreground">
                <Search className="h-5 w-5 opacity-50" />
                <p className="text-sm">No matching action.</p>
                <p className="text-xs">
                  Try &quot;@trade&quot;, &quot;dashboard&quot;, or
                  &quot;insights&quot;.
                </p>
              </div>
            </CommandEmpty>

            <CommandGroup heading="Create">
              {createActions.map((action) => {
                const Icon = action.icon;
                return (
                  <CommandItem
                    key={action.id}
                    value={`${action.label} ${action.hint ?? ""} ${(action.keywords ?? []).join(" ")}`}
                    onSelect={() => runAction(action)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{action.label}</span>
                    {action.hint && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {action.hint}
                      </span>
                    )}
                    {action.shortcut && (
                      <CommandShortcut>⌘{action.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Navigate">
              {NAV_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <CommandItem
                    key={action.id}
                    value={`${action.label} ${(action.keywords ?? []).join(" ")}`}
                    onSelect={() => runAction(action)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{action.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      ) : (
        <AddTradeWizard
          step={step}
          stepNumber={stepNumber}
          stepTotal={stepTotal}
          wizard={wizard}
          submitting={submitting}
          onUpdate={updateWizard}
          onNext={goNext}
          onBack={goBack}
          onJumpTo={goToStep}
          onCancel={cancelWizard}
          onSubmit={submitWizard}
          onOpenFullForm={() => {
            setOpen(false);
            router.push("/journal/new");
          }}
        />
      )}
    </CommandDialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Inline Add Trade Wizard
// ────────────────────────────────────────────────────────────────────────────

interface AddTradeWizardProps {
  readonly step: WizardStep;
  readonly stepNumber: number;
  readonly stepTotal: number;
  readonly wizard: WizardState;
  readonly submitting: boolean;
  readonly onUpdate: <K extends keyof WizardState>(
    key: K,
    value: WizardState[K],
  ) => void;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onJumpTo: (step: WizardStep) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
  readonly onOpenFullForm: () => void;
}

function AddTradeWizard({
  step,
  stepNumber,
  stepTotal,
  wizard,
  submitting,
  onUpdate,
  onNext,
  onBack,
  onJumpTo,
  onCancel,
  onSubmit,
  onOpenFullForm,
}: AddTradeWizardProps) {
  const entry = Number(wizard.entry_price);
  const sl = Number(wizard.stop_loss);
  const tp = Number(wizard.take_profit);

  const slError = useMemo(() => {
    if (!wizard.stop_loss) return null;
    if (!Number.isFinite(sl) || sl <= 0) return "Must be a positive number";
    if (!Number.isFinite(entry) || entry <= 0) return null;
    if (wizard.direction === "buy" && sl >= entry)
      return "Stop loss must be below entry for a buy";
    if (wizard.direction === "sell" && sl <= entry)
      return "Stop loss must be above entry for a sell";
    return null;
  }, [wizard.stop_loss, wizard.direction, sl, entry]);

  const tpError = useMemo(() => {
    if (!wizard.take_profit) return null;
    if (!Number.isFinite(tp) || tp <= 0) return "Must be a positive number";
    if (!Number.isFinite(entry) || entry <= 0) return null;
    if (wizard.direction === "buy" && tp <= entry)
      return "Take profit must be above entry for a buy";
    if (wizard.direction === "sell" && tp >= entry)
      return "Take profit must be below entry for a sell";
    return null;
  }, [wizard.take_profit, wizard.direction, tp, entry]);

  const canAdvance = useMemo(() => {
    switch (step) {
      case "instrument":
        return wizard.instrument.trim().length > 0;
      case "direction":
        return wizard.direction === "buy" || wizard.direction === "sell";
      case "entry":
        return Number.isFinite(entry) && entry > 0;
      case "quantity": {
        const qty = Number(wizard.quantity);
        return Number.isFinite(qty) && qty > 0;
      }
      case "stop_loss":
        return slError == null;
      case "take_profit":
        return tpError == null;
      case "exit": {
        if (!wizard.exit_price) return true;
        const exit = Number(wizard.exit_price);
        return Number.isFinite(exit) && exit > 0;
      }
      case "review":
        return true;
      default:
        return false;
    }
  }, [step, wizard, entry, slError, tpError]);

  return (
    <div className="flex flex-col">
      <WizardHeader
        stepNumber={stepNumber}
        stepTotal={stepTotal}
        onCancel={onCancel}
      />

      <div className="max-h-[60vh] overflow-y-auto px-4 py-4">
        {step === "instrument" && (
          <InstrumentStep
            value={wizard.instrument}
            onChange={(v) => onUpdate("instrument", v)}
            onCommit={onNext}
          />
        )}
        {step === "direction" && (
          <DirectionStep
            value={wizard.direction}
            onChange={(v) => onUpdate("direction", v)}
          />
        )}
        {step === "entry" && (
          <NumberStep
            id="entry_price"
            label="Entry price"
            help="The price you entered the trade at."
            value={wizard.entry_price}
            placeholder="e.g. 1.0950"
            onChange={(v) => onUpdate("entry_price", v)}
            onEnter={canAdvance ? onNext : undefined}
          />
        )}
        {step === "quantity" && (
          <NumberStep
            id="quantity"
            label="Quantity"
            help="Units traded (e.g. lots for forex, contracts, or coins)."
            value={wizard.quantity}
            placeholder="e.g. 1"
            onChange={(v) => onUpdate("quantity", v)}
            onEnter={canAdvance ? onNext : undefined}
          />
        )}
        {step === "stop_loss" && (
          <NumberStep
            id="stop_loss"
            label="Stop Loss"
            help="Optional. Price at which the trade auto-closes to cap losses."
            optional
            value={wizard.stop_loss}
            placeholder="Leave empty if none"
            onChange={(v) => onUpdate("stop_loss", v)}
            error={slError}
            onEnter={canAdvance ? onNext : undefined}
          />
        )}
        {step === "take_profit" && (
          <NumberStep
            id="take_profit"
            label="Take Profit"
            help="Optional. Price at which the trade auto-closes to lock in gains."
            optional
            value={wizard.take_profit}
            placeholder="Leave empty if none"
            onChange={(v) => onUpdate("take_profit", v)}
            error={tpError}
            onEnter={canAdvance ? onNext : undefined}
          />
        )}
        {step === "exit" && (
          <NumberStep
            id="exit_price"
            label="Exit price"
            help="Optional. Leave empty to log an open trade you'll close later."
            optional
            value={wizard.exit_price}
            placeholder="Leave empty for open trade"
            onChange={(v) => onUpdate("exit_price", v)}
            onEnter={canAdvance ? onNext : undefined}
          />
        )}
        {step === "review" && (
          <ReviewStep
            wizard={wizard}
            onJumpTo={onJumpTo}
            onOpenFullForm={onOpenFullForm}
          />
        )}
      </div>

      <WizardFooter
        step={step}
        canAdvance={canAdvance}
        submitting={submitting}
        onBack={onBack}
        onNext={onNext}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  );
}

function WizardHeader({
  stepNumber,
  stepTotal,
  onCancel,
}: {
  readonly stepNumber: number;
  readonly stepTotal: number;
  readonly onCancel: () => void;
}) {
  const progress = Math.round((stepNumber / stepTotal) * 100);
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            Add Trade
          </span>
          <span className="text-xs text-muted-foreground">
            Step {stepNumber} of {stepTotal}
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Back to menu
        </button>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function WizardFooter({
  step,
  canAdvance,
  submitting,
  onBack,
  onNext,
  onSubmit,
  onCancel,
}: {
  readonly step: WizardStep;
  readonly canAdvance: boolean;
  readonly submitting: boolean;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const isFirst = step === "instrument";
  const isReview = step === "review";
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={isFirst ? onCancel : onBack}
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        {isFirst ? "Cancel" : "Back"}
      </Button>
      {isReview ? (
        <Button
          type="button"
          size="sm"
          onClick={onSubmit}
          disabled={submitting}
        >
          <Check className="mr-1 h-4 w-4" />
          {submitting ? "Logging…" : "Log Trade"}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          onClick={onNext}
          disabled={!canAdvance}
        >
          Next
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

// ── Step: Instrument ──────────────────────────────────────────────────────
function InstrumentStep({
  value,
  onChange,
  onCommit,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly onCommit: () => void;
}) {
  const [query, setQuery] = useState(value);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return ALL_INSTRUMENTS.slice(0, 12);
    return ALL_INSTRUMENTS.filter((i) => i.includes(q)).slice(0, 20);
  }, [query]);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="instrument-search">Instrument</Label>
        <p className="text-xs text-muted-foreground">
          The asset you traded — e.g. EURUSD, BTCUSDT, XAUUSD.
        </p>
        <Input
          id="instrument-search"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              e.preventDefault();
              onCommit();
            }
          }}
          placeholder="Type to search or enter symbol…"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {matches.map((sym) => {
          const selected = sym === value.trim().toUpperCase();
          return (
            <button
              type="button"
              key={sym}
              onClick={() => {
                onChange(sym);
                setQuery(sym);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground",
              )}
            >
              {sym}
            </button>
          );
        })}
        {matches.length === 0 && (
          <span className="text-xs text-muted-foreground">
            No matches — you can still enter a custom symbol above.
          </span>
        )}
      </div>
    </div>
  );
}

// ── Step: Direction ──────────────────────────────────────────────────────
function DirectionStep({
  value,
  onChange,
}: {
  readonly value: TradeDirection;
  readonly onChange: (v: TradeDirection) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Direction</Label>
        <p className="text-xs text-muted-foreground">
          Buy (long) expects price to rise, Sell (short) expects it to fall.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <DirectionCard
          active={value === "buy"}
          onClick={() => onChange("buy")}
          icon={<TrendingUp className="h-5 w-5" />}
          label="Buy"
          sub="Long"
          tone="positive"
        />
        <DirectionCard
          active={value === "sell"}
          onClick={() => onChange("sell")}
          icon={<TrendingDown className="h-5 w-5" />}
          label="Sell"
          sub="Short"
          tone="negative"
        />
      </div>
    </div>
  );
}

function DirectionCard({
  active,
  onClick,
  icon,
  label,
  sub,
  tone,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly sub: string;
  readonly tone: "positive" | "negative";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
        active
          ? tone === "positive"
            ? "border-emerald-500/50 bg-emerald-500/10"
            : "border-red-500/50 bg-red-500/10"
          : "border-border bg-card hover:border-ring/40",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2",
          active
            ? tone === "positive"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
            : "text-muted-foreground",
        )}
      >
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </button>
  );
}

// ── Step: Number input (entry/qty/sl/tp/exit) ────────────────────────────
function NumberStep({
  id,
  label,
  help,
  optional,
  value,
  placeholder,
  onChange,
  error,
  onEnter,
}: {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly optional?: boolean;
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (v: string) => void;
  readonly error?: string | null;
  readonly onEnter?: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <Label htmlFor={id}>{label}</Label>
        {optional && (
          <span className="text-xs text-muted-foreground">(optional)</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
      <Input
        id={id}
        autoFocus
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

// ── Step: Review ─────────────────────────────────────────────────────────
function ReviewStep({
  wizard,
  onJumpTo,
  onOpenFullForm,
}: {
  readonly wizard: WizardState;
  readonly onJumpTo: (step: WizardStep) => void;
  readonly onOpenFullForm: () => void;
}) {
  const rows: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly step: WizardStep;
  }> = [
    {
      label: "Instrument",
      value: wizard.instrument || "—",
      step: "instrument",
    },
    {
      label: "Direction",
      value: wizard.direction.toUpperCase(),
      step: "direction",
    },
    { label: "Entry", value: wizard.entry_price || "—", step: "entry" },
    { label: "Quantity", value: wizard.quantity || "—", step: "quantity" },
    {
      label: "Stop Loss",
      value: wizard.stop_loss || "—",
      step: "stop_loss",
    },
    {
      label: "Take Profit",
      value: wizard.take_profit || "—",
      step: "take_profit",
    },
    {
      label: "Exit",
      value: wizard.exit_price || "— (open)",
      step: "exit",
    },
  ];

  return (
    <div className="space-y-3">
      <div>
        <Label>Review</Label>
        <p className="text-xs text-muted-foreground">
          Confirm the details below. Click any row to edit. Entry time is set
          to now; fees, tags, and notes default to empty — use the full form
          for those.
        </p>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <button
            type="button"
            key={row.label}
            onClick={() => onJumpTo(row.step)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent/40"
          >
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium text-foreground">{row.value}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onOpenFullForm}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="h-3 w-3" />
        Need fees, tags, notes, or custom entry time? Open full form
      </button>
    </div>
  );
}
