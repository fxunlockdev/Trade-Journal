"use client";

import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, TrendingUp, TrendingDown, Target, ShieldAlert } from "lucide-react";
import type { Signal, TradeDirection } from "@/types/database";
import { createSignalFormSchema } from "@/lib/validators/signal";
import { ALL_INSTRUMENTS } from "@/lib/constants/instruments";
import { computePipsDifference } from "@/lib/signals/computations";
import { useUser } from "@/hooks/use-user";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface FormInput {
  instrument: string;
  direction: "buy" | "sell";
  entry_price: number;
  stop_loss: number;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  tp4?: number | null;
  notes?: string | null;
  risk_amount?: number | null;
}

interface SignalBuilderProps {
  readonly onSignalCreated?: (signal: Signal) => void;
}

function PipsBadge({
  entry,
  target,
  instrument,
}: {
  readonly entry: number | undefined;
  readonly target: number | undefined;
  readonly instrument: string;
}) {
  if (!entry || !target || !instrument) return null;

  const pips = computePipsDifference(entry, target, instrument);

  return (
    <Badge
      variant="outline"
      className="ml-2 border-border bg-muted text-xs font-mono tabular-nums text-foreground"
    >
      {pips} pips
    </Badge>
  );
}

export function SignalBuilder({ onSignalCreated }: SignalBuilderProps) {
  const { user } = useUser();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(createSignalFormSchema) as any,
    defaultValues: {
      instrument: "",
      direction: undefined,
      entry_price: undefined,
      stop_loss: undefined,
      tp1: undefined,
      tp2: undefined,
      tp3: undefined,
      tp4: undefined,
      notes: "",
    },
  });

  const watchedDirection = watch("direction");
  const watchedEntry = watch("entry_price");
  const watchedSl = watch("stop_loss");
  const watchedTp1 = watch("tp1");
  const watchedTp2 = watch("tp2");
  const watchedTp3 = watch("tp3");
  const watchedTp4 = watch("tp4");
  const watchedInstrument = watch("instrument");

  const riskSummary = useMemo(() => {
    const entry = Number(watchedEntry);
    const sl = Number(watchedSl);
    const tp1 = Number(watchedTp1);
    const inst = watchedInstrument;

    if (!entry || !sl || !inst) return null;

    const riskPips = computePipsDifference(entry, sl, inst);
    const rewardPips = tp1 ? computePipsDifference(entry, tp1, inst) : null;
    const rrRatio = rewardPips && riskPips > 0 ? rewardPips / riskPips : null;

    return { riskPips, rewardPips, rrRatio };
  }, [watchedEntry, watchedSl, watchedTp1, watchedInstrument]);

  const setDirection = useCallback(
    (dir: TradeDirection) => {
      setValue("direction", dir, { shouldValidate: true });
    },
    [setValue],
  );

  const onSubmit = useCallback(
    async (data: FormInput) => {
      if (!user) {
        toast.error("You must be logged in to create a signal");
        return;
      }

      setSubmitting(true);
      try {
        const payload = {
          ...data,
          trader_id: user.id,
          tp1: data.tp1 ?? null,
          tp2: data.tp2 ?? null,
          tp3: data.tp3 ?? null,
          tp4: data.tp4 ?? null,
          notes: data.notes ?? null,
        };

        const res = await fetch("/api/signals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.json();
          toast.error(body.error ?? "Failed to create signal");
          return;
        }

        const { data: signal } = await res.json();
        toast.success("Signal created");
        onSignalCreated?.(signal);
      } catch {
        toast.error("Failed to create signal");
      } finally {
        setSubmitting(false);
      }
    },
    [user, onSignalCreated],
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Section 1: Instrument & Direction */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Instrument & Direction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="instrument" className="text-foreground">
              Instrument
            </Label>
            <Input
              id="instrument"
              list="instruments-list"
              placeholder="e.g. EURUSD, XAUUSD"
              className="mt-1.5 border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/20"
              {...register("instrument")}
            />
            <datalist id="instruments-list">
              {ALL_INSTRUMENTS.map((inst) => (
                <option key={inst} value={inst} />
              ))}
            </datalist>
            {errors.instrument && (
              <p className="mt-1 text-xs text-red-400">{errors.instrument.message}</p>
            )}
          </div>

          <div>
            <Label className="text-foreground">Direction</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDirection("buy")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-bold uppercase transition-all",
                  watchedDirection === "buy"
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-400 shadow-lg shadow-emerald-500/10"
                    : "border-border bg-muted text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <TrendingUp className="size-5" />
                Buy
              </button>
              <button
                type="button"
                onClick={() => setDirection("sell")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-bold uppercase transition-all",
                  watchedDirection === "sell"
                    ? "border-red-500 bg-red-500/15 text-red-400 shadow-lg shadow-red-500/10"
                    : "border-border bg-muted text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <TrendingDown className="size-5" />
                Sell
              </button>
            </div>
            {errors.direction && (
              <p className="mt-1 text-xs text-red-400">{errors.direction.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Price Levels */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Price Levels
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="entry_price" className="text-foreground">
                Entry Price
              </Label>
              <Input
                id="entry_price"
                type="number"
                step="any"
                placeholder="0.00000"
                className="mt-1.5 border-border bg-muted font-mono text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/20"
                {...register("entry_price")}
              />
              {errors.entry_price && (
                <p className="mt-1 text-xs text-red-400">{errors.entry_price.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="stop_loss" className="text-foreground">
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5 text-red-400" />
                  Stop Loss
                </span>
              </Label>
              <Input
                id="stop_loss"
                type="number"
                step="any"
                placeholder="0.00000"
                className="mt-1.5 border-border bg-muted font-mono text-foreground placeholder:text-muted-foreground focus:border-red-600 focus:ring-red-600/20"
                {...register("stop_loss")}
              />
              {errors.stop_loss && (
                <p className="mt-1 text-xs text-red-400">{errors.stop_loss.message}</p>
              )}
            </div>
          </div>

          <Separator className="bg-muted" />

          <div className="space-y-3">
            {([
              { name: "tp1" as const, label: "TP1", value: watchedTp1, required: true },
              { name: "tp2" as const, label: "TP2", value: watchedTp2, required: false },
              { name: "tp3" as const, label: "TP3", value: watchedTp3, required: false },
              { name: "tp4" as const, label: "TP4", value: watchedTp4, required: false },
            ]).map((tp) => (
              <div key={tp.name}>
                <div className="flex items-center">
                  <Label htmlFor={tp.name} className="text-foreground">
                    <span className="flex items-center gap-1.5">
                      <Target className="size-3.5 text-emerald-400" />
                      {tp.label}
                      {!tp.required && (
                        <span className="text-xs text-muted-foreground">(optional)</span>
                      )}
                    </span>
                  </Label>
                  <PipsBadge
                    entry={Number(watchedEntry)}
                    target={Number(tp.value)}
                    instrument={watchedInstrument}
                  />
                </div>
                <Input
                  id={tp.name}
                  type="number"
                  step="any"
                  placeholder="0.00000"
                  className="mt-1.5 border-border bg-muted font-mono text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/20"
                  {...register(tp.name)}
                />
                {errors[tp.name] && (
                  <p className="mt-1 text-xs text-red-400">
                    {errors[tp.name]?.message}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Risk Summary */}
      {riskSummary && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Risk Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-center">
                <p className="text-xs uppercase text-muted-foreground">Risk</p>
                <p className="mt-1 font-mono text-lg font-bold text-red-400">
                  {riskSummary.riskPips}
                </p>
                <p className="text-xs text-muted-foreground">pips</p>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                <p className="text-xs uppercase text-muted-foreground">Reward TP1</p>
                <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
                  {riskSummary.rewardPips ?? "---"}
                </p>
                <p className="text-xs text-muted-foreground">pips</p>
              </div>
              <div className="rounded-lg border border-border bg-muted p-3 text-center">
                <p className="text-xs uppercase text-muted-foreground">R:R</p>
                <p className="mt-1 font-mono text-lg font-bold text-foreground">
                  {riskSummary.rrRatio
                    ? `1:${riskSummary.rrRatio.toFixed(1)}`
                    : "---"}
                </p>
                <p className="text-xs text-muted-foreground">ratio</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section 4: Notes */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Trade rationale, confluence factors, market context..."
            className="min-h-[80px] border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/20"
            {...register("notes")}
          />
        </CardContent>
      </Card>

      {/* Submit */}
      <Button
        type="submit"
        disabled={submitting}
        className="w-full bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Creating...
          </>
        ) : (
          "Create Signal"
        )}
      </Button>
    </form>
  );
}
