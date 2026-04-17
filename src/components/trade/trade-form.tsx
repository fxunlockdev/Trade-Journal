"use client";

import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { createTradeFormSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";
import { z } from "zod";

const formSchema = createTradeFormSchema;
type FormInput = z.infer<typeof formSchema>;
import { ALL_INSTRUMENTS } from "@/lib/constants/instruments";
import { cn, formatCurrency, formatPercentage } from "@/lib/utils";
import type { Trade, AssetType, TradeDirection } from "@/types/database";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/trade/field-label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";

interface TradeFormProps {
  readonly trade?: Trade;
  readonly onSuccess?: () => void;
}

const ASSET_TYPES: readonly { readonly value: AssetType; readonly label: string }[] = [
  { value: "forex", label: "Forex" },
  { value: "crypto", label: "Crypto" },
  { value: "metal", label: "Metal" },
] as const;

export function TradeForm({ trade, onSuccess }: TradeFormProps) {
  const router = useRouter();
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isEditMode = trade !== undefined;

  /**
   * `<input type="datetime-local">` interprets its value as **local** wall
   * clock time. Using `toISOString().slice(0,16)` returns a UTC wall clock
   * string, so rendering an edit form in any non-UTC timezone showed the
   * wrong time AND (worse) silently shifted `entry_time` by the user's UTC
   * offset every time they saved. Always build + parse these values in the
   * user's local timezone.
   */
  const toLocalInputValue = useCallback((iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }, []);

  const defaultValues: Partial<FormInput> = useMemo(() => {
    if (trade) {
      return {
        instrument: trade.instrument,
        asset_type: trade.asset_type,
        direction: trade.direction,
        entry_price: trade.entry_price,
        exit_price: trade.exit_price ?? undefined,
        quantity: trade.quantity,
        lot_size: trade.lot_size ?? undefined,
        stop_loss: trade.stop_loss ?? undefined,
        take_profit: trade.take_profit ?? undefined,
        fees: trade.fees,
        notes: trade.notes ?? undefined,
        tags: [...trade.tags],
        entry_time: trade.entry_time ? toLocalInputValue(trade.entry_time) : "",
        exit_time: trade.exit_time
          ? toLocalInputValue(trade.exit_time)
          : undefined,
        source: trade.source,
      };
    }
    return {
      asset_type: "forex",
      direction: "buy",
      fees: 0,
      tags: [],
      source: "manual",
      entry_time: toLocalInputValue(new Date().toISOString()),
    };
  }, [trade, toLocalInputValue]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(formSchema) as any,
    defaultValues,
  });

  const watchedFields = watch();
  const direction = watch("direction");

  const preview = useMemo(() => {
    // `Number("1e400")` is Infinity and `Number("abc")` is NaN. Both slip
    // past `|| 0` when chained after coercion: `Infinity || 0 === Infinity`.
    // Narrow to finite numbers so the preview card never renders "∞" or "NaN".
    const toFinite = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const entry = toFinite(watchedFields.entry_price);
    const exit = toFinite(watchedFields.exit_price);
    const qty = toFinite(watchedFields.quantity);
    const fees = toFinite(watchedFields.fees);
    const sl = toFinite(watchedFields.stop_loss);
    const tp = toFinite(watchedFields.take_profit);
    const dir = watchedFields.direction ?? "buy";

    if (entry <= 0 || qty <= 0) return null;

    const tradeData = {
      entry_price: entry,
      exit_price: exit > 0 ? exit : null,
      quantity: qty,
      direction: dir,
      fees,
      stop_loss: sl > 0 ? sl : null,
      take_profit: tp > 0 ? tp : null,
    };

    return computeTradeFields(tradeData);
  }, [
    watchedFields.entry_price,
    watchedFields.exit_price,
    watchedFields.quantity,
    watchedFields.fees,
    watchedFields.stop_loss,
    watchedFields.take_profit,
    watchedFields.direction,
  ]);

  const onSubmit = useCallback(
    async (data: FormInput) => {
      // No client-side auth gate: the browser Supabase client can show
      // `user === null` during a cookie-refresh blip even though the server
      // session is perfectly valid. `/api/trades` already authenticates via
      // server cookies and RLS enforces per-user isolation, so we rely on
      // those two layers and surface a real 401 (if any) via response.ok.
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

        const payload = {
          ...data,
          tags: tagsValue,
          entry_time: entryIso,
          exit_time: toIsoOrNull(data.exit_time),
          exit_price: data.exit_price || null,
          lot_size: data.lot_size || null,
          stop_loss: data.stop_loss || null,
          take_profit: data.take_profit || null,
          notes: data.notes || null,
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

        toast.success(isEditMode ? "Trade updated" : "Trade created");
        onSuccess?.();
        router.push("/journal");
        router.refresh();
      } catch {
        toast.error("An unexpected error occurred");
      } finally {
        setSubmitting(false);
      }
    },
    [isEditMode, trade, onSuccess, router],
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Section 1: Trade Details */}
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Trade Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Instrument Combobox */}
            <div className="space-y-2">
              <FieldLabel
                htmlFor="instrument"
                required
                help="The asset you traded — e.g. EURUSD, BTCUSD, XAUUSD. Start typing to search the catalog."
              >
                Instrument
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
                  {watchedFields.instrument || "Select instrument..."}
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search instruments..." />
                    <CommandList>
                      <CommandEmpty>No instrument found.</CommandEmpty>
                      <CommandGroup>
                        {ALL_INSTRUMENTS.map((inst) => (
                          <CommandItem
                            key={inst}
                            value={inst}
                            onSelect={(value) => {
                              setValue("instrument", value.toUpperCase(), {
                                shouldValidate: true,
                              });
                              setInstrumentOpen(false);
                            }}
                          >
                            {inst}
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

            {/* Asset Type */}
            <div className="space-y-2">
              <FieldLabel
                required
                help="Category of the instrument. Forex = currency pairs. Crypto = digital coins. Metal = gold/silver. Commodity = oil/gas/agri. Index = stock indices like SPX."
              >
                Asset Type
              </FieldLabel>
              <Select
                defaultValue={defaultValues.asset_type}
                onValueChange={(value) =>
                  setValue("asset_type", value as AssetType, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.asset_type && (
                <p className="text-xs text-destructive">{errors.asset_type.message}</p>
              )}
            </div>

            {/* Direction Toggle */}
            <div className="space-y-2">
              <FieldLabel
                required
                help="BUY (Long) — you profit when price rises above entry. SELL (Short) — you profit when price drops below entry."
              >
                Direction
              </FieldLabel>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={direction === "buy" ? "default" : "outline"}
                  className={cn(
                    "flex-1 font-semibold",
                    direction === "buy" &&
                      "bg-emerald-600 hover:bg-emerald-700 text-white",
                  )}
                  onClick={() =>
                    setValue("direction", "buy", { shouldValidate: true })
                  }
                >
                  BUY
                </Button>
                <Button
                  type="button"
                  variant={direction === "sell" ? "default" : "outline"}
                  className={cn(
                    "flex-1 font-semibold",
                    direction === "sell" &&
                      "bg-red-600 hover:bg-red-700 text-white",
                  )}
                  onClick={() =>
                    setValue("direction", "sell", { shouldValidate: true })
                  }
                >
                  SELL
                </Button>
              </div>
              <input type="hidden" {...register("direction")} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Prices */}
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Prices
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="entry_price"
                required
                help="The price at which you entered the trade. Use the exact fill price from your broker for accurate P&L."
              >
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
              <FieldLabel
                htmlFor="exit_price"
                help="The price at which you closed the trade. Leave blank if the trade is still open — P&L will be computed once you set this."
              >
                Exit Price
              </FieldLabel>
              <Input
                id="exit_price"
                type="number"
                step="any"
                placeholder="0.00"
                {...register("exit_price")}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel
                htmlFor="stop_loss"
                help="Price that would auto-close the trade to cap your loss. Must be BELOW entry for BUY trades, ABOVE entry for SELL trades."
              >
                Stop Loss
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
              <FieldLabel
                htmlFor="take_profit"
                help="Price that would auto-close the trade to lock in profit. Must be ABOVE entry for BUY trades, BELOW entry for SELL trades."
              >
                Take Profit
              </FieldLabel>
              <Input
                id="take_profit"
                type="number"
                step="any"
                placeholder="0.00"
                {...register("take_profit")}
              />
              {errors.take_profit && (
                <p className="text-xs text-destructive">{errors.take_profit.message}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Size */}
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Size
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="quantity"
                required
                help="Number of units / contracts / shares traded. For forex, this is typically the lot size × contract size (e.g. 0.1 lots = 10,000 units on a standard pair)."
              >
                Quantity
              </FieldLabel>
              <Input
                id="quantity"
                type="number"
                step="any"
                placeholder="1"
                {...register("quantity")}
              />
              {errors.quantity && (
                <p className="text-xs text-destructive">{errors.quantity.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <FieldLabel
                htmlFor="lot_size"
                help="Broker-facing position size (e.g. 0.01 micro, 0.1 mini, 1.0 standard in forex). Optional — stored for reporting only; doesn't change P&L math."
              >
                Lot Size
              </FieldLabel>
              <Input
                id="lot_size"
                type="number"
                step="any"
                placeholder="0.01"
                {...register("lot_size")}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel
                htmlFor="fees"
                help="Total commissions, spread, and swap charges paid on this trade. Deducted from P&L so your numbers reflect real net performance."
              >
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

      {/* Section 4: Time */}
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="entry_time"
                required
                help="When you opened the trade, in your local time. Used to bucket trades on the calendar, equity curve, and by-hour stats."
              >
                Entry Time
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
            <div className="space-y-2">
              <FieldLabel
                htmlFor="exit_time"
                help="When you closed the trade. Leave blank if still open. Hold duration = exit time − entry time."
              >
                Exit Time
              </FieldLabel>
              <Input
                id="exit_time"
                type="datetime-local"
                {...register("exit_time")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 5: Notes & Tags */}
      <Card className="border-border/40 bg-card/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <FieldLabel
              htmlFor="notes"
              help="Your rationale, setup, emotions, or post-trade review. Optional — but the traders who keep notes improve fastest."
            >
              Notes
            </FieldLabel>
            <Textarea
              id="notes"
              placeholder="Trade rationale, observations..."
              rows={4}
              {...register("notes")}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel
              htmlFor="tags"
              help="Comma-separated labels for grouping & filtering — e.g. 'breakout, trend, news'. Used by the Journal filters and AI Insights to compare tagged vs untagged performance."
            >
              Tags
            </FieldLabel>
            <Input
              id="tags"
              placeholder="breakout, trend, scalp (comma-separated)"
              defaultValue={trade?.tags.join(", ") ?? ""}
              {...register("tags" as never)}
            />
            <p className="text-xs text-muted-foreground">
              Separate tags with commas
            </p>
          </div>
        </CardContent>
      </Card>

      {/* PnL Preview */}
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
                      preview.pnl_absolute !== null && preview.pnl_absolute >= 0
                        ? "text-emerald-400"
                        : "text-red-400",
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
                        ? "text-emerald-400"
                        : "text-red-400",
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
                        ? "text-emerald-400"
                        : "text-red-400",
                    )}
                  >
                    {preview.r_multiple !== null
                      ? `${preview.r_multiple >= 0 ? "+" : ""}${preview.r_multiple.toFixed(2)}R`
                      : "---"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting
            ? "Saving..."
            : isEditMode
              ? "Update Trade"
              : "Create Trade"}
        </Button>
      </div>
    </form>
  );
}
