"use client";

import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { createTradeSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";
import { z } from "zod";

const formSchema = createTradeSchema.omit({ user_id: true });
type FormInput = z.infer<typeof formSchema>;
import { ALL_INSTRUMENTS } from "@/lib/constants/instruments";
import { useUser } from "@/hooks/use-user";
import { cn, formatCurrency, formatPercentage } from "@/lib/utils";
import type { Trade, AssetType, TradeDirection } from "@/types/database";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const { user } = useUser();
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isEditMode = trade !== undefined;

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
        entry_time: trade.entry_time
          ? new Date(trade.entry_time).toISOString().slice(0, 16)
          : "",
        exit_time: trade.exit_time
          ? new Date(trade.exit_time).toISOString().slice(0, 16)
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
      entry_time: new Date().toISOString().slice(0, 16),
    };
  }, [trade]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useForm<FormInput>({
    resolver: zodResolver(formSchema) as any,
    defaultValues,
  });

  const watchedFields = watch();
  const direction = watch("direction");

  const preview = useMemo(() => {
    const entry = Number(watchedFields.entry_price) || 0;
    const exit = Number(watchedFields.exit_price) || 0;
    const qty = Number(watchedFields.quantity) || 0;
    const fees = Number(watchedFields.fees) || 0;
    const sl = Number(watchedFields.stop_loss) || 0;
    const tp = Number(watchedFields.take_profit) || 0;
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
      if (!user) {
        toast.error("You must be logged in");
        return;
      }

      setSubmitting(true);

      try {
        const tagsValue = typeof data.tags === "string"
          ? (data.tags as string).split(",").map((t: string) => t.trim()).filter(Boolean)
          : data.tags ?? [];

        const payload = {
          ...data,
          tags: tagsValue,
          exit_price: data.exit_price || null,
          exit_time: data.exit_time || null,
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
    [user, isEditMode, trade, onSuccess, router],
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
              <Label htmlFor="instrument">Instrument</Label>
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
              <Label>Asset Type</Label>
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
              <Label>Direction</Label>
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
              <Label htmlFor="entry_price">Entry Price</Label>
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
              <Label htmlFor="exit_price">Exit Price</Label>
              <Input
                id="exit_price"
                type="number"
                step="any"
                placeholder="0.00"
                {...register("exit_price")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stop_loss">Stop Loss</Label>
              <Input
                id="stop_loss"
                type="number"
                step="any"
                placeholder="0.00"
                {...register("stop_loss")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="take_profit">Take Profit</Label>
              <Input
                id="take_profit"
                type="number"
                step="any"
                placeholder="0.00"
                {...register("take_profit")}
              />
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
              <Label htmlFor="quantity">Quantity</Label>
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
              <Label htmlFor="lot_size">Lot Size</Label>
              <Input
                id="lot_size"
                type="number"
                step="any"
                placeholder="0.01"
                {...register("lot_size")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fees">Fees</Label>
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
              <Label htmlFor="entry_time">Entry Time</Label>
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
              <Label htmlFor="exit_time">Exit Time</Label>
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
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Trade rationale, observations..."
              rows={4}
              {...register("notes")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
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
