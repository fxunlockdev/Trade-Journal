"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Check, Plus, Star, X } from "lucide-react";

import { useFavoriteInstruments } from "@/hooks/use-favorite-instruments";
import { useJournals } from "@/hooks/use-journals";
import { JournalPicker } from "@/components/trade/journal-picker";

import { createTradeFormSchema } from "@/lib/validators/trade";
import { EMOTIONS } from "@/lib/constants/emotions";
import { computeTradeFields } from "@/lib/trades/computations";
import { computeAutoSize } from "@/lib/trades/auto-size";
import { parseSignalText } from "@/lib/trades/signal-parser";
import {
  ALL_INSTRUMENTS,
  FOREX_PAIRS,
  CRYPTO_PAIRS,
  METALS,
  INDICES,
  COMMODITIES,
} from "@/lib/constants/instruments";
import { cn, formatCurrency, formatPercentage, formatRR } from "@/lib/utils";
import type {
  Trade,
  AssetType,
  OrderType,
  TPResult,
  EmotionState,
} from "@/types/database";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/trade/field-label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

const formSchema = createTradeFormSchema;
type FormInput = z.infer<typeof formSchema>;

interface TradeFormProps {
  readonly trade?: Trade;
  readonly onSuccess?: () => void;
  /**
   * Which journal this trade belongs to. In new-trade mode this defaults to
   * the caller's active journal. In edit mode it defaults to the trade's
   * existing journal_id. The picker then lets the user switch (subject to
   * owner/member role in the target journal).
   */
  readonly defaultJournalId: string;
}

const ORDER_TYPES: readonly { readonly value: OrderType; readonly label: string }[] = [
  { value: "market", label: "MARKET" },
  { value: "limit", label: "LIMIT" },
  { value: "stop", label: "STOP" },
] as const;

const TP_RESULTS: readonly { readonly value: TPResult; readonly label: string; readonly className: string }[] = [
  { value: "hit", label: "Hit", className: "data-[selected=true]:bg-pos data-[selected=true]:text-white" },
  { value: "be", label: "BE", className: "data-[selected=true]:bg-warn data-[selected=true]:text-white" },
  { value: "sl", label: "SL", className: "data-[selected=true]:bg-neg data-[selected=true]:text-white" },
] as const;

type TpKey = "tp1" | "tp2" | "tp3" | "tp4" | "tp5" | "tp6" | "tp7";
type TpPipsKey =
  | "tp1_pips"
  | "tp2_pips"
  | "tp3_pips"
  | "tp4_pips"
  | "tp5_pips"
  | "tp6_pips"
  | "tp7_pips";
type TpResultKey =
  | "tp1_result"
  | "tp2_result"
  | "tp3_result"
  | "tp4_result"
  | "tp5_result"
  | "tp6_result"
  | "tp7_result";

interface TpPalette {
  readonly key: TpKey;
  readonly pipsKey: TpPipsKey;
  readonly resultKey: TpResultKey;
  readonly label: string;
  readonly accent: string;
  readonly badge: string;
}

/**
 * Per-TP palette. TP1..4 match the original mockup (emerald → orange);
 * TP5..7 extend with a distinct but complementary set so 7 simultaneous TPs
 * remain legible at a glance. All palette classes are tailwind utilities,
 * so they tree-shake correctly at build time.
 */
const TP_PALETTE: readonly TpPalette[] = [
  { key: "tp1", pipsKey: "tp1_pips", resultKey: "tp1_result", label: "TP1", accent: "border-emerald-500/60 bg-emerald-500/5", badge: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30" },
  { key: "tp2", pipsKey: "tp2_pips", resultKey: "tp2_result", label: "TP2", accent: "border-sky-500/60 bg-sky-500/5", badge: "bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30" },
  { key: "tp3", pipsKey: "tp3_pips", resultKey: "tp3_result", label: "TP3", accent: "border-violet-500/60 bg-violet-500/5", badge: "bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/30" },
  { key: "tp4", pipsKey: "tp4_pips", resultKey: "tp4_result", label: "TP4", accent: "border-orange-500/60 bg-orange-500/5", badge: "bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30" },
  { key: "tp5", pipsKey: "tp5_pips", resultKey: "tp5_result", label: "TP5", accent: "border-cyan-500/60 bg-cyan-500/5", badge: "bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/30" },
  { key: "tp6", pipsKey: "tp6_pips", resultKey: "tp6_result", label: "TP6", accent: "border-rose-500/60 bg-rose-500/5", badge: "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30" },
  { key: "tp7", pipsKey: "tp7_pips", resultKey: "tp7_result", label: "TP7", accent: "border-lime-500/60 bg-lime-500/5", badge: "bg-lime-500/15 text-lime-400 ring-1 ring-lime-500/30" },
] as const;

const TP_KEYS: readonly TpKey[] = TP_PALETTE.map((p) => p.key);

function inferAssetType(instrument: string): AssetType {
  const upper = instrument.trim().toUpperCase();
  if ((FOREX_PAIRS as readonly string[]).includes(upper)) return "forex";
  if ((CRYPTO_PAIRS as readonly string[]).includes(upper)) return "crypto";
  if ((METALS as readonly string[]).includes(upper)) return "metal";
  if ((INDICES as readonly string[]).includes(upper)) return "index";
  if ((COMMODITIES as readonly string[]).includes(upper)) return "commodity";
  return "forex";
}

/**
 * `<input type="datetime-local">` interprets its value as **local** wall
 * clock time. Using `toISOString().slice(0,16)` returns a UTC wall clock
 * string, so rendering an edit form in any non-UTC timezone showed the
 * wrong time AND (worse) silently shifted `entry_time` by the user's UTC
 * offset every time they saved. Always build + parse these values in the
 * user's local timezone.
 */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function TradeForm({ trade, onSuccess, defaultJournalId }: TradeFormProps) {
  const router = useRouter();
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const favoriteInstruments = useFavoriteInstruments();
  const { journals: availableJournals } = useJournals();
  const [journalId, setJournalId] = useState<string>(defaultJournalId);
  const [submitting, setSubmitting] = useState(false);

  // Reorder: favorites first (in the order the user starred them), then every
  // non-favorited instrument from the canonical list. Memoized so toggling a
  // star doesn't re-sort on every render during the optimistic update.
  const orderedInstruments = useMemo<readonly string[]>(() => {
    const favSet = new Set(favoriteInstruments.favorites);
    const rest = ALL_INSTRUMENTS.filter((inst) => !favSet.has(inst));
    return [...favoriteInstruments.favorites, ...rest];
  }, [favoriteInstruments.favorites]);
  const [activeTab, setActiveTab] = useState<"manual" | "paste">("manual");
  const [pasteText, setPasteText] = useState("");
  const [pasteWarnings, setPasteWarnings] = useState<readonly string[]>([]);

  const isEditMode = trade !== undefined;

  const defaultValues: Partial<FormInput> = useMemo(() => {
    if (trade) {
      return {
        instrument: trade.instrument,
        asset_type: trade.asset_type,
        direction: trade.direction,
        order_type: trade.order_type ?? "market",
        entry_price: trade.entry_price,
        entry_price_high: trade.entry_price_high ?? undefined,
        exit_price: trade.exit_price ?? undefined,
        quantity: trade.quantity,
        stop_loss: trade.stop_loss ?? undefined,
        sl_pips: trade.sl_pips ?? undefined,
        take_profit: trade.take_profit ?? undefined,
        tp1: trade.tp1 ?? trade.take_profit ?? undefined,
        tp2: trade.tp2 ?? undefined,
        tp3: trade.tp3 ?? undefined,
        tp4: trade.tp4 ?? undefined,
        tp5: trade.tp5 ?? undefined,
        tp6: trade.tp6 ?? undefined,
        tp7: trade.tp7 ?? undefined,
        tp1_pips: trade.tp1_pips ?? undefined,
        tp2_pips: trade.tp2_pips ?? undefined,
        tp3_pips: trade.tp3_pips ?? undefined,
        tp4_pips: trade.tp4_pips ?? undefined,
        tp5_pips: trade.tp5_pips ?? undefined,
        tp6_pips: trade.tp6_pips ?? undefined,
        tp7_pips: trade.tp7_pips ?? undefined,
        tp1_result: trade.tp1_result ?? undefined,
        tp2_result: trade.tp2_result ?? undefined,
        tp3_result: trade.tp3_result ?? undefined,
        tp4_result: trade.tp4_result ?? undefined,
        tp5_result: trade.tp5_result ?? undefined,
        tp6_result: trade.tp6_result ?? undefined,
        tp7_result: trade.tp7_result ?? undefined,
        tp4_trailing: trade.tp4_trailing ?? false,
        num_positions: trade.num_positions ?? 1,
        split_risk: trade.split_risk ?? false,
        fees: trade.fees,
        emotion: trade.emotion ?? undefined,
        emotion_post: trade.emotion_post ?? undefined,
        notes: trade.notes ?? undefined,
        // Use a comma-separated string so React Hook Form's `register` picks up
        // the correct initial value. Passing the raw array clashed with the
        // `defaultValue` prop that was previously on the Input, causing tag
        // edits in edit-mode to be silently discarded on submit.
        tags: (trade.tags ?? []).join(", ") as unknown as string[],
        entry_time: trade.entry_time ? toLocalInputValue(trade.entry_time) : "",
        exit_time: trade.exit_time ? toLocalInputValue(trade.exit_time) : undefined,
        source: trade.source,
      };
    }
    return {
      asset_type: "forex",
      direction: "buy",
      order_type: "market",
      fees: 0,
      quantity: 1,
      tp4_trailing: false,
      num_positions: 1,
      split_risk: false,
      tags: [],
      source: "manual",
      entry_time: toLocalInputValue(new Date().toISOString()),
    };
  }, [trade]);

  /**
   * Progressive "Add TP" reveal. Start with TP1 visible; each click of the
   * "+ Add TP" button reveals the next slot. In edit mode we pre-expand to
   * the highest slot that has data so the user doesn't lose existing values
   * when they re-open a trade.
   */
  const initialVisibleTps: number = useMemo(() => {
    if (!trade) return 1;
    let max = 1;
    TP_KEYS.forEach((k, idx) => {
      const n = trade[k];
      if (n != null) max = Math.max(max, idx + 1);
    });
    return Math.max(max, 1);
  }, [trade]);

  const [visibleTps, setVisibleTps] = useState<number>(initialVisibleTps);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(formSchema) as any,
    defaultValues,
  });

  const watched = watch();
  const direction = watch("direction");

  /**
   * Position sizing from the journal's account capital. When the journal has a
   * capital + risk % configured, entry and stop loss are enough to work out the
   * size — so the trader never types a quantity. It stays a suggestion: editing
   * the field by hand switches auto-sizing off for this trade.
   */
  const sizingJournal = availableJournals.find((j) => j.id === journalId);
  const [quantityTouched, setQuantityTouched] = useState(isEditMode);
  const autoSize = useMemo(
    () =>
      computeAutoSize({
        capital: sizingJournal?.initial_capital,
        accountCurrency: sizingJournal?.account_currency ?? "USD",
        riskPercent: sizingJournal?.default_risk_percent ?? 1,
        instrument: watched.instrument ?? "",
        direction: direction ?? "buy",
        entryPrice: Number(watched.entry_price),
        stopLossPrice:
          watched.stop_loss == null || watched.stop_loss === ("" as unknown)
            ? null
            : Number(watched.stop_loss),
      }),
    [
      sizingJournal?.initial_capital,
      sizingJournal?.account_currency,
      sizingJournal?.default_risk_percent,
      watched.instrument,
      watched.entry_price,
      watched.stop_loss,
      direction,
    ],
  );

  useEffect(() => {
    if (quantityTouched || autoSize === null) return;
    setValue("quantity", autoSize.quantity, { shouldValidate: true });
    setValue("lot_size", autoSize.lots);
  }, [autoSize, quantityTouched, setValue]);
  const tp4Trailing = watch("tp4_trailing");
  const splitRisk = watch("split_risk");
  const numPositions = watch("num_positions");
  const tp1Result = watch("tp1_result");
  const tp2Result = watch("tp2_result");
  const tp3Result = watch("tp3_result");
  const tp4Result = watch("tp4_result");
  const tp5Result = watch("tp5_result");
  const tp6Result = watch("tp6_result");
  const tp7Result = watch("tp7_result");
  const resultsByKey: Record<TpKey, TPResult | undefined> = {
    tp1: tp1Result ?? undefined,
    tp2: tp2Result ?? undefined,
    tp3: tp3Result ?? undefined,
    tp4: tp4Result ?? undefined,
    tp5: tp5Result ?? undefined,
    tp6: tp6Result ?? undefined,
    tp7: tp7Result ?? undefined,
  };

  const preview = useMemo(() => {
    // `Number("1e400")` is Infinity and `Number("abc")` is NaN. Both slip
    // past `|| 0` when chained after coercion: `Infinity || 0 === Infinity`.
    // Narrow to finite numbers so the preview card never renders "∞" or "NaN".
    const toFinite = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const entry = toFinite(watched.entry_price);
    const qty = toFinite(watched.quantity);
    const fees = toFinite(watched.fees);
    const sl = toFinite(watched.stop_loss);

    if (entry <= 0 || qty <= 0) return null;

    const toOptNum = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const tradeData = {
      entry_price: entry,
      exit_price: toOptNum(watched.exit_price),
      quantity: qty,
      direction: direction ?? "buy",
      fees,
      stop_loss: sl > 0 ? sl : null,
      take_profit: toOptNum(watched.tp1) ?? toOptNum(watched.take_profit),
      tp1: toOptNum(watched.tp1),
      tp2: toOptNum(watched.tp2),
      tp3: toOptNum(watched.tp3),
      tp4: toOptNum(watched.tp4),
      tp5: toOptNum(watched.tp5),
      tp6: toOptNum(watched.tp6),
      tp7: toOptNum(watched.tp7),
      tp1_result: watched.tp1_result ?? null,
      tp2_result: watched.tp2_result ?? null,
      tp3_result: watched.tp3_result ?? null,
      tp4_result: watched.tp4_result ?? null,
      tp5_result: watched.tp5_result ?? null,
      tp6_result: watched.tp6_result ?? null,
      tp7_result: watched.tp7_result ?? null,
      num_positions: watched.num_positions ?? 1,
      split_risk: watched.split_risk ?? false,
    };

    const computed = computeTradeFields(tradeData);

    // Broker-sourced trades (report import / MT5 sync) carry the broker's REAL
    // money P&L; price×qty math can't reproduce it (lot-denominated / non-USD
    // quote instruments) and the server never saves a recomputed value for them.
    // Preview the STORED figures so editing an imported trade shows the truth.
    if (
      isEditMode &&
      trade &&
      (trade.source === "csv" || trade.source === "mt5_webhook")
    ) {
      return {
        ...computed,
        pnl_absolute: trade.pnl_absolute,
        pnl_percentage: trade.pnl_percentage,
        risk_reward_ratio: trade.risk_reward_ratio,
        r_multiple: trade.r_multiple,
      };
    }

    return computed;
  }, [
    watched.entry_price,
    watched.exit_price,
    watched.quantity,
    watched.fees,
    watched.stop_loss,
    watched.take_profit,
    watched.tp1,
    watched.tp2,
    watched.tp3,
    watched.tp4,
    watched.tp5,
    watched.tp6,
    watched.tp7,
    watched.tp1_result,
    watched.tp2_result,
    watched.tp3_result,
    watched.tp4_result,
    watched.tp5_result,
    watched.tp6_result,
    watched.tp7_result,
    watched.num_positions,
    watched.split_risk,
    direction,
    isEditMode,
    trade,
  ]);

  const applyParsedSignal = useCallback(() => {
    const parsed = parseSignalText(pasteText);
    setPasteWarnings(parsed.warnings);

    if (parsed.instrument) {
      setValue("instrument", parsed.instrument, { shouldValidate: true });
      setValue("asset_type", inferAssetType(parsed.instrument), { shouldValidate: true });
    }
    if (parsed.direction) {
      setValue("direction", parsed.direction, { shouldValidate: true });
    }
    if (parsed.entry_price != null) {
      setValue("entry_price", parsed.entry_price, { shouldValidate: true });
    }
    if (parsed.entry_price_high != null) {
      setValue("entry_price_high", parsed.entry_price_high, { shouldValidate: true });
    }
    if (parsed.stop_loss != null) {
      setValue("stop_loss", parsed.stop_loss, { shouldValidate: true });
    }
    if (parsed.tp1 != null) setValue("tp1", parsed.tp1, { shouldValidate: true });
    if (parsed.tp2 != null) setValue("tp2", parsed.tp2, { shouldValidate: true });
    if (parsed.tp3 != null) setValue("tp3", parsed.tp3, { shouldValidate: true });
    if (parsed.tp4 != null) setValue("tp4", parsed.tp4, { shouldValidate: true });
    if (parsed.tp5 != null) setValue("tp5", parsed.tp5, { shouldValidate: true });
    if (parsed.tp6 != null) setValue("tp6", parsed.tp6, { shouldValidate: true });
    if (parsed.tp7 != null) setValue("tp7", parsed.tp7, { shouldValidate: true });
    if (parsed.tp4_trailing) {
      setValue("tp4_trailing", true, { shouldValidate: true });
    }

    // Reveal enough TP slots so the parsed values are visible in the form.
    const parsedTps = [parsed.tp1, parsed.tp2, parsed.tp3, parsed.tp4, parsed.tp5, parsed.tp6, parsed.tp7];
    let maxFilled = 0;
    parsedTps.forEach((v, i) => {
      if (v != null) maxFilled = i + 1;
    });
    if (maxFilled > 0) setVisibleTps((prev) => Math.max(prev, maxFilled));

    const filled = [
      parsed.instrument && "instrument",
      parsed.direction && "direction",
      parsed.entry_price != null && "entry",
      parsed.stop_loss != null && "SL",
      parsedTps.some((v) => v != null) && "TPs",
    ].filter(Boolean);

    if (filled.length === 0) {
      toast.error("Could not parse anything — please check the signal format");
      return;
    }

    toast.success(`Parsed: ${filled.join(", ")} — review & submit`);
    setActiveTab("manual");
  }, [pasteText, setValue]);

  const onInstrumentSelect = useCallback(
    (value: string) => {
      const upper = value.toUpperCase();
      setValue("instrument", upper, { shouldValidate: true });
      setValue("asset_type", inferAssetType(upper), { shouldValidate: true });
      setInstrumentOpen(false);
    },
    [setValue],
  );

  const toggleTpResult = useCallback(
    (key: TpResultKey, value: TPResult) => {
      const current = watch(key);
      setValue(key, current === value ? undefined : value, { shouldValidate: true });
    },
    [setValue, watch],
  );

  /**
   * Remove a TP slot. We clear price/pips/result for that slot then collapse
   * the visible-TPs counter to the highest still-populated slot (but never
   * below 1 — there's always at least TP1 visible).
   */
  const removeTp = useCallback(
    (index: number) => {
      const p = TP_PALETTE[index];
      if (!p) return;
      setValue(p.key, undefined, { shouldValidate: true });
      setValue(p.pipsKey, undefined, { shouldValidate: true });
      setValue(p.resultKey, undefined, { shouldValidate: true });
      if (p.key === "tp4") {
        setValue("tp4_trailing", false, { shouldValidate: true });
      }
      // Recalculate visibleTps from the highest still-populated slot so
      // removing e.g. TP3 from a TP1+TP2+TP3+TP4 form doesn't hide TP4.
      // Always keep TP1 visible (min = 1).
      const snapshot = TP_PALETTE.map((slot, i) =>
        i === index
          ? null
          : (watch(slot.key) ??
              watch(slot.pipsKey) ??
              watch(slot.resultKey) ??
              null),
      );
      let highest = 1;
      snapshot.forEach((v, i) => {
        if (v != null) highest = Math.max(highest, i + 1);
      });
      setVisibleTps(highest);
    },
    [setValue, watch],
  );

  const onReset = useCallback(() => {
    reset({
      asset_type: "forex",
      direction: "buy",
      order_type: "market",
      fees: 0,
      quantity: 1,
      tp4_trailing: false,
      num_positions: 1,
      split_risk: false,
      tags: [],
      source: "manual",
      entry_time: toLocalInputValue(new Date().toISOString()),
    });
    setPasteText("");
    setPasteWarnings([]);
    setVisibleTps(1);
  }, [reset]);

  const onSubmit = useCallback(
    async (data: FormInput) => {
      // No client-side auth gate: the browser Supabase client can show
      // `user === null` during a cookie-refresh blip even though the server
      // session is perfectly valid. `/api/trades` already authenticates via
      // server cookies and RLS enforces per-user isolation.
      setSubmitting(true);

      try {
        const tagsValue = typeof data.tags === "string"
          ? (data.tags as string).split(",").map((t: string) => t.trim()).filter(Boolean)
          : data.tags ?? [];

        // `<input type="datetime-local">` emits "YYYY-MM-DDTHH:mm" with no
        // timezone. `new Date(...)` parses those as LOCAL time, which is
        // exactly what we want — then we serialize to UTC ISO for storage.
        const toIsoOrNull = (v: string | null | undefined): string | null => {
          if (!v) return null;
          const d = new Date(v);
          return Number.isNaN(d.getTime()) ? null : d.toISOString();
        };

        const entryIso = toIsoOrNull(data.entry_time);
        if (!entryIso) {
          toast.error("Entry time is required");
          return;
        }

        // Keep legacy take_profit in sync with tp1 so old UI / reports keep
        // working. When the user explicitly set take_profit in edit mode we
        // prefer tp1 (the new canonical field).
        const tp1Value = data.tp1 ?? null;
        const legacyTp = tp1Value ?? data.take_profit ?? null;

        const payload = {
          ...data,
          // Explicit journal target — the server will verify the caller has
          // owner/member role in this journal before accepting the write.
          journal_id: journalId,
          tags: tagsValue,
          entry_time: entryIso,
          exit_time: toIsoOrNull(data.exit_time),
          exit_price: data.exit_price || null,
          // Always null — the lot size UI was removed per client feedback.
          // The column still exists in the DB for CSV + MT5 imports.
          lot_size: null,
          stop_loss: data.stop_loss || null,
          sl_pips: data.sl_pips || null,
          take_profit: legacyTp,
          tp1: tp1Value,
          tp2: data.tp2 || null,
          tp3: data.tp3 || null,
          tp4: data.tp4 || null,
          tp5: data.tp5 || null,
          tp6: data.tp6 || null,
          tp7: data.tp7 || null,
          tp1_pips: data.tp1_pips || null,
          tp2_pips: data.tp2_pips || null,
          tp3_pips: data.tp3_pips || null,
          tp4_pips: data.tp4_pips || null,
          tp5_pips: data.tp5_pips || null,
          tp6_pips: data.tp6_pips || null,
          tp7_pips: data.tp7_pips || null,
          tp1_result: data.tp1_result ?? null,
          tp2_result: data.tp2_result ?? null,
          tp3_result: data.tp3_result ?? null,
          tp4_result: data.tp4_result ?? null,
          tp5_result: data.tp5_result ?? null,
          tp6_result: data.tp6_result ?? null,
          tp7_result: data.tp7_result ?? null,
          entry_price_high: data.entry_price_high || null,
          notes: data.notes || null,
          emotion: data.emotion || null,
          emotion_post: data.emotion_post || null,
        };

        const url = isEditMode ? `/api/trades/${trade.id}` : "/api/trades";
        const method = isEditMode ? "PATCH" : "POST";

        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (!response.ok) {
          toast.error(result.error ?? "Failed to save trade");
          return;
        }

        // Success toast includes R:R when we can compute it. This is the
        // user-visible confirmation asked for in client feedback — it also
        // matches what the preview card shows so there's no surprise.
        const rr = preview?.risk_reward_ratio ?? null;
        const savedRow = result?.data as
          | { readonly id?: string; readonly journal_id?: string }
          | undefined;
        const tradeId = savedRow?.id ? ` (#${savedRow.id.slice(0, 8)})` : "";
        const base = isEditMode ? "Trade updated" : "Trade logged";
        const withRr = rr !== null ? `${base} · R:R ${formatRR(rr)}` : base;
        toast.success(`${withRr}${tradeId}`);

        onSuccess?.();

        // Critical: if the user logged this trade into a journal that's NOT
        // their current active workspace (e.g. they picked a different one
        // from the form's journal dropdown), they'd land on /journal still
        // scoped to the old active journal and the trade they just logged
        // would be invisible — looking like a silent save failure.
        //
        // Sync the active-journal cookie to wherever this trade was saved
        // before redirecting. If the switch fails, we still redirect — the
        // worst case is a stale view the user can manually switch out of.
        const savedJournalId =
          (result?.data as { journal_id?: string } | undefined)?.journal_id ??
          journalId;
        try {
          await fetch(`/api/journals/${savedJournalId}/activate`, {
            method: "POST",
          });
        } catch {
          // Non-fatal — the cookie just stays on the previous workspace.
        }

        router.push("/journal");
        router.refresh();
      } catch {
        toast.error("An unexpected error occurred");
      } finally {
        setSubmitting(false);
      }
    },
    [isEditMode, trade, onSuccess, router, preview, journalId],
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Tabs: Manual vs Paste Signal */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "manual" | "paste")}
      >
        <TabsList>
          <TabsTrigger value="manual">Manual Entry</TabsTrigger>
          <TabsTrigger value="paste">Paste Signal</TabsTrigger>
        </TabsList>

        <TabsContent value="paste" className="mt-4">
          <Card className="border-border/40 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Paste signal text
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={6}
                placeholder={
                  "e.g.\nBUY XAUUSD 2340 SL 2330 TP1 2350 TP2 2360 TP3 2370 TP4 OPEN"
                }
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              {pasteWarnings.length > 0 && (
                <div className="rounded-md border border-warn/30 bg-warn/5 p-3 text-xs text-warn space-y-1">
                  {pasteWarnings.map((w) => (
                    <p key={w}>• {w}</p>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPasteText("");
                    setPasteWarnings([]);
                  }}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  onClick={applyParsedSignal}
                  disabled={!pasteText.trim()}
                >
                  Parse & fill form
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Journal target — picks which workspace the trade lands in. */}
      <Card className="border-border/40 bg-card/50">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2 md:col-span-2">
              <FieldLabel
                required
                help="Which journal this trade will be saved into. Only journals where you're an owner or member are shown."
              >
                Journal
              </FieldLabel>
              <JournalPicker
                journals={availableJournals}
                value={journalId}
                onChange={setJournalId}
                disabled={submitting}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Row 1: Symbol / Direction / Order Type / Date */}
      <Card className="border-border/40 bg-card/50">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <FieldLabel required help="The asset you traded. Start typing to search.">
                Symbol
              </FieldLabel>
              <Popover open={instrumentOpen} onOpenChange={setInstrumentOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={instrumentOpen}
                      className="w-full justify-between font-normal"
                    />
                  }
                >
                  {watched.instrument || "Select symbol..."}
                </PopoverTrigger>
                <PopoverContent className="w-[260px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search symbols..." />
                    <CommandList>
                      <CommandEmpty>No symbol found.</CommandEmpty>
                      {favoriteInstruments.favorites.length > 0 && (
                        <>
                          <CommandGroup heading="Favourites">
                            {favoriteInstruments.favorites.map((inst) => (
                              <CommandItem
                                key={`fav-${inst}`}
                                value={inst}
                                onSelect={onInstrumentSelect}
                                className="group"
                              >
                                <span className="flex-1">{inst}</span>
                                <button
                                  type="button"
                                  aria-label={`Unfavourite ${inst}`}
                                  className="ml-2 p-0.5 rounded hover:bg-muted"
                                  onPointerDown={(e) => {
                                    // Prevent cmdk from selecting the item when
                                    // the user clicks the star — otherwise we'd
                                    // fill the form with this instrument on unstar.
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void favoriteInstruments.toggle(inst);
                                  }}
                                >
                                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                </button>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                          <CommandSeparator />
                        </>
                      )}
                      <CommandGroup heading="All Symbols">
                        {orderedInstruments
                          .filter(
                            (inst) =>
                              !favoriteInstruments.favorites.includes(inst),
                          )
                          .map((inst) => (
                            <CommandItem
                              key={inst}
                              value={inst}
                              onSelect={onInstrumentSelect}
                              className="group"
                            >
                              <span className="flex-1">{inst}</span>
                              <button
                                type="button"
                                aria-label={`Favourite ${inst}`}
                                className="ml-2 p-0.5 rounded opacity-50 hover:opacity-100 hover:bg-muted transition-opacity"
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void favoriteInstruments.toggle(inst);
                                }}
                              >
                                <Star className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <input type="hidden" {...register("instrument")} />
              {errors.instrument && (
                <p className="text-xs text-destructive">{errors.instrument.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <FieldLabel required help="BUY (long) profits when price rises. SELL (short) profits when price falls.">
                Direction
              </FieldLabel>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={direction === "buy" ? "default" : "outline"}
                  className={cn(
                    "flex-1 font-semibold",
                    direction === "buy" && "bg-pos hover:bg-pos/90 text-white",
                  )}
                  onClick={() => setValue("direction", "buy", { shouldValidate: true })}
                >
                  BUY
                </Button>
                <Button
                  type="button"
                  variant={direction === "sell" ? "default" : "outline"}
                  className={cn(
                    "flex-1 font-semibold",
                    direction === "sell" && "bg-neg hover:bg-neg/90 text-white",
                  )}
                  onClick={() => setValue("direction", "sell", { shouldValidate: true })}
                >
                  SELL
                </Button>
              </div>
              <input type="hidden" {...register("direction")} />
            </div>

            <div className="space-y-2">
              <FieldLabel required help="MARKET = fill at current price. LIMIT = fill only at your price or better. STOP = trigger once price passes your level.">
                Order Type
              </FieldLabel>
              <Select
                value={watch("order_type") ?? "market"}
                onValueChange={(v) => {
                  if (v) setValue("order_type", v as OrderType, { shouldValidate: true });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="entry_time" required help="When you opened the trade. Used to bucket by day/week/hour on the calendar + stats.">
                Date
              </FieldLabel>
              <Input
                id="entry_time"
                type="datetime-local"
                {...register("entry_time")}
              />
              {errors.entry_time && (
                <p className="text-xs text-destructive">{errors.entry_time.message}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Row 2: Entry Low / Entry High / SL / SL Pips */}
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Entry & Stop Loss
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="entry_price" required help="Fill price (or lower bound of a range).">
                Entry Price
              </FieldLabel>
              <Input
                id="entry_price"
                type="number"
                step="any"
                placeholder="0.00"
                {...register("entry_price")}
              />
              {errors.entry_price && (
                <p className="text-xs text-destructive">{errors.entry_price.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="entry_price_high" help="Optional — upper bound for range entries like '1.2300 – 1.2310'.">
                Entry High
              </FieldLabel>
              <Input
                id="entry_price_high"
                type="number"
                step="any"
                placeholder="optional"
                {...register("entry_price_high")}
              />
              {errors.entry_price_high && (
                <p className="text-xs text-destructive">{errors.entry_price_high.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="stop_loss" help="Price that closes the trade for a loss. Below entry for BUY, above for SELL.">
                SL Price
              </FieldLabel>
              <Input
                id="stop_loss"
                type="number"
                step="any"
                placeholder="0.00"
                {...register("stop_loss")}
              />
              {errors.stop_loss && (
                <p className="text-xs text-destructive">{errors.stop_loss.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="sl_pips" help="Distance to SL in pips/points. Informational — doesn't affect PnL math.">
                SL Pips / Pts
              </FieldLabel>
              <Input
                id="sl_pips"
                type="number"
                step="any"
                placeholder="0"
                {...register("sl_pips")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Take Profits grid — progressive reveal up to 7 TPs */}
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Take Profits
          </CardTitle>
          <span className="text-xs text-muted-foreground tabular-nums">
            {visibleTps}/{TP_PALETTE.length}
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {TP_PALETTE.slice(0, visibleTps).map((tp, idx) => {
              const isTp4 = tp.key === "tp4";
              const disablePrice = isTp4 && tp4Trailing;
              const isLastVisible = idx === visibleTps - 1;
              const canRemove = isLastVisible && idx > 0;
              return (
                <div
                  key={tp.key}
                  className={cn(
                    "rounded-lg border p-3 space-y-3 transition-colors",
                    tp.accent,
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", tp.badge)}>
                      {tp.label}
                    </span>
                    <div className="flex items-center gap-2">
                      {isTp4 && (
                        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox
                            checked={!!tp4Trailing}
                            onCheckedChange={(v) =>
                              setValue("tp4_trailing", !!v, { shouldValidate: true })
                            }
                          />
                          Open / Trail
                        </label>
                      )}
                      {canRemove && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeTp(idx)}
                          aria-label={`Remove ${tp.label}`}
                          title={`Remove ${tp.label}`}
                        >
                          <X className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Price
                    </label>
                    <Input
                      type="number"
                      step="any"
                      placeholder={disablePrice ? "trailing" : "0.00"}
                      disabled={disablePrice}
                      {...register(tp.key)}
                    />
                    {errors[tp.key] && (
                      <p className="text-xs text-destructive">{errors[tp.key]?.message as string}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Pips / Pts
                    </label>
                    <Input
                      type="number"
                      step="any"
                      placeholder="0"
                      {...register(tp.pipsKey)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Outcome
                    </label>
                    <div className="grid grid-cols-4 gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={resultsByKey[tp.key] == null ? "secondary" : "outline"}
                        className="h-7 px-0 text-[11px]"
                        onClick={() =>
                          setValue(tp.resultKey, undefined, { shouldValidate: true })
                        }
                      >
                        —
                      </Button>
                      {TP_RESULTS.map((r) => {
                        const isSelected = resultsByKey[tp.key] === r.value;
                        return (
                          <Button
                            key={r.value}
                            type="button"
                            size="sm"
                            variant={isSelected ? "default" : "outline"}
                            className={cn(
                              "h-7 px-0 text-[11px] font-semibold",
                              isSelected && r.value === "hit" && "bg-pos hover:bg-pos/90 text-white",
                              isSelected && r.value === "be" && "bg-warn hover:bg-warn/90 text-white",
                              isSelected && r.value === "sl" && "bg-neg hover:bg-neg/90 text-white",
                            )}
                            onClick={() => toggleTpResult(tp.resultKey, r.value)}
                          >
                            {isSelected && <Check className="size-3 mr-0.5" />}
                            {r.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {visibleTps < TP_PALETTE.length && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVisibleTps((n) => Math.min(TP_PALETTE.length, n + 1))}
              >
                <Plus className="size-3.5 mr-1" /> Add TP
              </Button>
              <p className="text-xs text-muted-foreground mt-1.5">
                Signal groups sometimes use up to 7 TPs — add as many as you need.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Position structure */}
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Position
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={!!splitRisk}
              onCheckedChange={(v) =>
                setValue("split_risk", !!v, { shouldValidate: true })
              }
            />
            <div className="flex-1">
              <label className="text-sm font-medium">Split risk across positions</label>
              <p className="text-xs text-muted-foreground">
                Each TP closes 1/N of the position, where N = number of positions.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <FieldLabel htmlFor="num_positions" help="How many slices to split the risk into (1..10).">
                Number of Positions
              </FieldLabel>
              <Input
                id="num_positions"
                type="number"
                step="1"
                min="1"
                max="10"
                disabled={!splitRisk}
                {...register("num_positions", { valueAsNumber: true })}
              />
              {errors.num_positions && (
                <p className="text-xs text-destructive">{errors.num_positions.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="quantity" required help="Total units / contracts on the trade. Used for P&L math. Filled in automatically when the journal has an account capital set.">
                Quantity
              </FieldLabel>
              <Input
                id="quantity"
                type="number"
                step="any"
                placeholder="1"
                {...register("quantity")}
                onInput={() => setQuantityTouched(true)}
              />
              {errors.quantity && (
                <p className="text-xs text-destructive">{errors.quantity.message}</p>
              )}
              {autoSize !== null && !quantityTouched && (
                <p className="text-xs text-primary">
                  Auto-sized: {autoSize.lots.toFixed(2)} lots — risking{" "}
                  {sizingJournal?.account_currency ?? "USD"}{" "}
                  {autoSize.riskAmount.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  over {Math.round(autoSize.pipsAtRisk)} pips. Type to override.
                </p>
              )}
              {autoSize === null &&
                sizingJournal?.initial_capital != null &&
                !quantityTouched && (
                  <p className="text-xs text-muted-foreground">
                    Add an entry price and stop loss to size this automatically.
                  </p>
                )}
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="fees" help="Commissions + spread + swap. Deducted from P&L.">
                Fees
              </FieldLabel>
              <Input
                id="fees"
                type="number"
                step="any"
                placeholder="0.00"
                {...register("fees")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes + Tags */}
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Emotion — how you felt entering the trade, and after it closed.
              Optional single-selects; leave on "None" to skip. Surfaces tilt /
              FOMO / revenge patterns in the AI insights. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <FieldLabel help="How did you feel taking this trade? Used to spot tilt / FOMO patterns.">
                Emotion — when trading
              </FieldLabel>
              <Select
                value={watch("emotion") ?? "none"}
                onValueChange={(v) =>
                  setValue(
                    "emotion",
                    v === "none" ? null : (v as EmotionState),
                    { shouldValidate: true },
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {EMOTIONS.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.emoji} {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <FieldLabel help="How did you feel after the trade closed / on review? Reveals regret, relief and post-loss tilt.">
                Emotion — after the trade
              </FieldLabel>
              <Select
                value={watch("emotion_post") ?? "none"}
                onValueChange={(v) =>
                  setValue(
                    "emotion_post",
                    v === "none" ? null : (v as EmotionState),
                    { shouldValidate: true },
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {EMOTIONS.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.emoji} {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="notes" help="Rationale, setup, emotions. Optional — notes turn one trade into a lesson.">
              Trade Notes
            </FieldLabel>
            <Textarea
              id="notes"
              placeholder="Rationale, setup, observations..."
              rows={4}
              {...register("notes")}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="tags" help="Comma-separated labels — e.g. 'breakout, trend, news'.">
              Tags
            </FieldLabel>
            <Input
              id="tags"
              placeholder="breakout, trend, scalp"
              {...register("tags" as never)}
            />
            <p className="text-xs text-muted-foreground">Separate tags with commas</p>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {preview && (
        <>
          <Separator />
          <Card className="border-border/40 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">P&L</p>
                  <p
                    className={cn(
                      "text-lg font-semibold tabular-nums",
                      preview.pnl_absolute !== null && preview.pnl_absolute > 0
                        ? "text-pos"
                        : preview.pnl_absolute !== null && preview.pnl_absolute < 0
                          ? "text-neg"
                          : "text-muted-foreground",
                    )}
                  >
                    {preview.pnl_absolute !== null
                      ? formatCurrency(preview.pnl_absolute)
                      : "---"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">P&L %</p>
                  <p
                    className={cn(
                      "text-lg font-semibold tabular-nums",
                      preview.pnl_percentage !== null && preview.pnl_percentage >= 0
                        ? "text-pos"
                        : "text-neg",
                    )}
                  >
                    {preview.pnl_percentage !== null
                      ? formatPercentage(preview.pnl_percentage)
                      : "---"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">R:R Ratio</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {preview.risk_reward_ratio !== null
                      ? `1:${preview.risk_reward_ratio.toFixed(2)}`
                      : "---"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">R-Multiple</p>
                  <p
                    className={cn(
                      "text-lg font-semibold tabular-nums",
                      preview.r_multiple !== null && preview.r_multiple >= 0
                        ? "text-pos"
                        : "text-neg",
                    )}
                  >
                    {preview.r_multiple !== null
                      ? `${preview.r_multiple >= 0 ? "+" : ""}${preview.r_multiple.toFixed(2)}R`
                      : "---"}
                  </p>
                </div>
              </div>
              {splitRisk && numPositions != null && numPositions > 1 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Risk split across {numPositions} positions — each filled TP closes 1/
                  {numPositions} of the trade.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={onReset}>
          Reset
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting
            ? "Saving..."
            : isEditMode
              ? "Update Trade"
              : "Log Trade"}
        </Button>
      </div>
    </form>
  );
}
