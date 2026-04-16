"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ALL_INSTRUMENTS } from "@/lib/constants/instruments";
import { computePipsDifference } from "@/lib/signals/computations";
import { useUser } from "@/hooks/use-user";
import type { Signal, TradeDirection } from "@/types/database";
import { ChevronDown, Check, TrendingUp, TrendingDown, Loader2, AlertTriangle } from "lucide-react";

interface SignalBuilderProps {
  readonly onSignalCreated?: (signal: Signal) => void;
}

interface FormState {
  readonly instrument: string;
  readonly direction: TradeDirection;
  readonly entry_price: string;
  readonly stop_loss: string;
  readonly tp1: string;
  readonly tp2: string;
  readonly tp3: string;
  readonly tp4: string;
  readonly notes: string;
}

const INITIAL_FORM: FormState = {
  instrument: "",
  direction: "buy",
  entry_price: "",
  stop_loss: "",
  tp1: "",
  tp2: "",
  tp3: "",
  tp4: "",
  notes: "",
};

function PipsDisplay({
  entryPrice,
  targetPrice,
  instrument,
  label,
}: {
  readonly entryPrice: number;
  readonly targetPrice: number;
  readonly instrument: string;
  readonly label: string;
}) {
  if (!entryPrice || !targetPrice || !instrument) return null;

  const pips = computePipsDifference(entryPrice, targetPrice, instrument);

  return (
    <span className="ml-2 text-xs font-medium text-zinc-400">
      {label}: {pips.toFixed(1)} pips
    </span>
  );
}

export function SignalBuilder({ onSignalCreated }: SignalBuilderProps) {
  const { profile } = useUser();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = useCallback(
    <K extends keyof FormState>(field: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const entryNum = useMemo(() => parseFloat(form.entry_price) || 0, [form.entry_price]);
  const slNum = useMemo(() => parseFloat(form.stop_loss) || 0, [form.stop_loss]);
  const tp1Num = useMemo(() => parseFloat(form.tp1) || 0, [form.tp1]);
  const tp2Num = useMemo(() => parseFloat(form.tp2) || 0, [form.tp2]);
  const tp3Num = useMemo(() => parseFloat(form.tp3) || 0, [form.tp3]);
  const tp4Num = useMemo(() => parseFloat(form.tp4) || 0, [form.tp4]);

  const riskPips = useMemo(() => {
    if (!entryNum || !slNum || !form.instrument) return 0;
    return computePipsDifference(entryNum, slNum, form.instrument);
  }, [entryNum, slNum, form.instrument]);

  const rewardPips = useMemo(() => {
    const tps = [tp1Num, tp2Num, tp3Num, tp4Num].filter(Boolean);
    if (!entryNum || !form.instrument || tps.length === 0) return [];
    return tps.map((tp, i) => ({
      label: `TP${i + 1}`,
      pips: computePipsDifference(entryNum, tp, form.instrument),
      rr: riskPips > 0 ? computePipsDifference(entryNum, tp, form.instrument) / riskPips : 0,
    }));
  }, [entryNum, tp1Num, tp2Num, tp3Num, tp4Num, form.instrument, riskPips]);

  const handleSubmit = useCallback(async () => {
    if (!profile) return;

    setError(null);
    setSubmitting(true);

    try {
      const payload = {
        trader_id: profile.id,
        instrument: form.instrument,
        direction: form.direction,
        entry_price: parseFloat(form.entry_price),
        stop_loss: parseFloat(form.stop_loss),
        tp1: form.tp1 ? parseFloat(form.tp1) : null,
        tp2: form.tp2 ? parseFloat(form.tp2) : null,
        tp3: form.tp3 ? parseFloat(form.tp3) : null,
        tp4: form.tp4 ? parseFloat(form.tp4) : null,
        notes: form.notes || null,
      };

      const response = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error ?? "Failed to create signal");
        return;
      }

      onSignalCreated?.(result.data);
      setForm(INITIAL_FORM);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [form, profile, onSignalCreated]);

  const isValid =
    form.instrument &&
    form.entry_price &&
    form.stop_loss &&
    parseFloat(form.entry_price) > 0 &&
    parseFloat(form.stop_loss) > 0;

  return (
    <Card className="border-zinc-800 bg-zinc-950">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-zinc-100">
          New Signal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Instrument Selector */}
        <div className="space-y-2">
          <Label className="text-sm text-zinc-400">Instrument</Label>
          <Popover open={instrumentOpen} onOpenChange={setInstrumentOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={instrumentOpen}
                  className="w-full justify-between border-zinc-800 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                />
              }
            >
              {form.instrument || "Select instrument..."}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </PopoverTrigger>
            <PopoverContent className="w-full border-zinc-800 bg-zinc-900 p-0">
              <Command className="bg-zinc-900">
                <CommandInput
                  placeholder="Search instrument..."
                  className="text-zinc-100"
                />
                <CommandList>
                  <CommandEmpty className="text-zinc-500">
                    No instrument found.
                  </CommandEmpty>
                  <CommandGroup>
                    {ALL_INSTRUMENTS.map((inst) => (
                      <CommandItem
                        key={inst}
                        value={inst}
                        onSelect={() => {
                          updateField("instrument", inst);
                          setInstrumentOpen(false);
                        }}
                        className="text-zinc-200"
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            form.instrument === inst
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        {inst}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Direction Toggle */}
        <div className="space-y-2">
          <Label className="text-sm text-zinc-400">Direction</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => updateField("direction", "buy")}
              className={cn(
                "h-14 text-lg font-bold transition-all",
                form.direction === "buy"
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300",
              )}
            >
              <TrendingUp className="mr-2 h-5 w-5" />
              BUY
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => updateField("direction", "sell")}
              className={cn(
                "h-14 text-lg font-bold transition-all",
                form.direction === "sell"
                  ? "border-red-500 bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300",
              )}
            >
              <TrendingDown className="mr-2 h-5 w-5" />
              SELL
            </Button>
          </div>
        </div>

        {/* Price Inputs */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center">
              <Label className="text-sm text-zinc-400">Entry Price</Label>
            </div>
            <Input
              type="number"
              step="any"
              value={form.entry_price}
              onChange={(e) => updateField("entry_price", e.target.value)}
              placeholder="0.00000"
              className="border-zinc-800 bg-zinc-900 font-mono text-zinc-100"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center">
              <Label className="text-sm text-zinc-400">Stop Loss</Label>
              {entryNum > 0 && slNum > 0 && form.instrument && (
                <PipsDisplay
                  entryPrice={entryNum}
                  targetPrice={slNum}
                  instrument={form.instrument}
                  label="Risk"
                />
              )}
            </div>
            <Input
              type="number"
              step="any"
              value={form.stop_loss}
              onChange={(e) => updateField("stop_loss", e.target.value)}
              placeholder="0.00000"
              className="border-red-900/50 bg-zinc-900 font-mono text-zinc-100 focus:border-red-700"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center">
              <Label className="text-sm text-zinc-400">
                TP1 <span className="text-zinc-600">(required)</span>
              </Label>
              {entryNum > 0 && tp1Num > 0 && form.instrument && (
                <PipsDisplay
                  entryPrice={entryNum}
                  targetPrice={tp1Num}
                  instrument={form.instrument}
                  label="Reward"
                />
              )}
            </div>
            <Input
              type="number"
              step="any"
              value={form.tp1}
              onChange={(e) => updateField("tp1", e.target.value)}
              placeholder="0.00000"
              className="border-emerald-900/50 bg-zinc-900 font-mono text-zinc-100 focus:border-emerald-700"
            />
          </div>

          {(["tp2", "tp3", "tp4"] as const).map((tp, idx) => {
            const tpNum = [tp2Num, tp3Num, tp4Num][idx];
            return (
              <div key={tp} className="space-y-1.5">
                <div className="flex items-center">
                  <Label className="text-sm text-zinc-400">
                    TP{idx + 2}{" "}
                    <span className="text-zinc-600">(optional)</span>
                  </Label>
                  {entryNum > 0 && (tpNum ?? 0) > 0 && form.instrument && (
                    <PipsDisplay
                      entryPrice={entryNum}
                      targetPrice={tpNum ?? 0}
                      instrument={form.instrument}
                      label="Reward"
                    />
                  )}
                </div>
                <Input
                  type="number"
                  step="any"
                  value={form[tp]}
                  onChange={(e) => updateField(tp, e.target.value)}
                  placeholder="0.00000"
                  className="border-zinc-800 bg-zinc-900 font-mono text-zinc-100"
                />
              </div>
            );
          })}
        </div>

        {/* Risk Summary */}
        {riskPips > 0 && (
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardContent className="p-4">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Risk Summary
              </h4>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Risk</span>
                  <span className="font-mono text-sm font-semibold text-red-400">
                    {riskPips.toFixed(1)} pips
                  </span>
                </div>
                {rewardPips.map((rp) => (
                  <div
                    key={rp.label}
                    className="flex items-center justify-between"
                  >
                    <span className="text-sm text-zinc-400">
                      {rp.label} Reward
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-emerald-400">
                        {rp.pips.toFixed(1)} pips
                      </span>
                      <Badge
                        variant="outline"
                        className="border-zinc-700 text-xs text-zinc-300"
                      >
                        {rp.rr.toFixed(1)}R
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-sm text-zinc-400">Notes</Label>
          <Textarea
            value={form.notes}
            onChange={(e) => updateField("notes", e.target.value)}
            placeholder="Trade rationale, confluence factors..."
            className="min-h-[80px] resize-none border-zinc-800 bg-zinc-900 text-zinc-100"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={!isValid || submitting}
          className="w-full bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            "Create Signal"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
