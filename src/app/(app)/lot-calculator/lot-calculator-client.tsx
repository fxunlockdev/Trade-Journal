"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Euro,
  PoundSterling,
  RotateCcw,
  Scale,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  Info,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ALL_INSTRUMENTS } from "@/lib/constants/instruments";
import { computeLotSize } from "@/lib/trading/lot-size";
import {
  applyOverrides,
  getInstrumentSpec,
} from "@/lib/trading/instrument-specs";
import type {
  AccountCurrency,
  Direction,
  LotSizeInput,
  SpecOverrides,
} from "@/lib/trading/lot-size.types";

type RewardRatio = 1 | 2 | 3 | 4 | 5;
const REWARD_RATIOS: readonly RewardRatio[] = [1, 2, 3, 4, 5];
const RISK_STEP = 0.5;
const RISK_MIN = 0.5;
const RISK_MAX = 10;
const LEVERAGES: readonly number[] = [0, 10, 20, 30, 50, 100, 200, 500];

const ACCOUNT_CURRENCIES: ReadonlyArray<{
  readonly value: AccountCurrency;
  readonly label: string;
  readonly symbol: string;
  readonly icon: LucideIcon;
}> = [
  { value: "USD", label: "USD ($)", symbol: "$", icon: DollarSign },
  { value: "EUR", label: "EUR (€)", symbol: "€", icon: Euro },
  { value: "GBP", label: "GBP (£)", symbol: "£", icon: PoundSterling },
];

/**
 * Look up the currency-config row by value. Kept as a helper so the
 * fallback (default to USD) is centralised — lucide's icon import names
 * and our currency enum map 1:1, so a missing row would be a typo bug.
 */
function currencyOf(code: AccountCurrency) {
  return ACCOUNT_CURRENCIES.find((c) => c.value === code) ?? ACCOUNT_CURRENCIES[0];
}

interface FormState {
  readonly accountBalance: string;
  readonly accountCurrency: AccountCurrency;
  readonly riskPercent: number;
  readonly instrument: string;
  readonly direction: Direction;
  readonly entryPrice: string;
  readonly stopLossPrice: string;
  readonly rewardRatio: RewardRatio;
  readonly leverage: number;
  readonly quoteToAccountRate: string;
}

const INITIAL_STATE: FormState = {
  accountBalance: "10000",
  accountCurrency: "USD",
  riskPercent: 1,
  instrument: "",
  direction: "buy",
  entryPrice: "",
  stopLossPrice: "",
  rewardRatio: 2,
  leverage: 0,
  quoteToAccountRate: "",
};

// ── LocalStorage-backed per-instrument overrides ─────────────────────────
const OVERRIDES_KEY = "trdr:lot-calc:overrides";

type OverridesMap = Record<string, SpecOverrides>;

function loadOverrides(): OverridesMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as OverridesMap;
    return {};
  } catch {
    return {};
  }
}

function saveOverrides(map: OverridesMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map));
  } catch {
    // Quota or privacy-mode — fail silently, the user just loses persistence.
  }
}

function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Render lots at the right precision — very small positions need more decimals,
 * big ones don't. Avoids showing "0.00" for a meaningful 0.003 lot size.
 */
function formatLots(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 100) return formatNumber(value, 2);
  if (value >= 1) return formatNumber(value, 3);
  return value.toFixed(Math.min(5, Math.max(3, -Math.floor(Math.log10(value)) + 2)));
}

/**
 * Decide whether the cross-rate input needs to be surfaced to the user.
 * Non-forex CFDs and XXX/USD or USD/XXX forex pairs don't need it.
 */
function needsCrossRate(instrument: string): {
  readonly needed: boolean;
  readonly rateSymbol: string;
} {
  if (!instrument) return { needed: false, rateSymbol: "" };
  const spec = getInstrumentSpec(instrument);
  if (spec.assetClass !== "forex") return { needed: false, rateSymbol: "" };
  const base = spec.baseCurrency.toUpperCase();
  const quote = spec.quoteCurrency.toUpperCase();
  if (base === "USD" || quote === "USD") return { needed: false, rateSymbol: "" };
  return { needed: true, rateSymbol: `${quote}/USD` };
}

export function LotCalculatorClient() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [overridesMap, setOverridesMap] = useState<OverridesMap>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setOverridesMap(loadOverrides());
  }, []);

  const instrumentKey = form.instrument.trim().toUpperCase();
  const currentOverrides = overridesMap[instrumentKey];
  const defaultSpec = useMemo(
    () => (instrumentKey ? getInstrumentSpec(instrumentKey) : null),
    [instrumentKey],
  );
  const effectiveSpec = useMemo(
    () => (defaultSpec ? applyOverrides(defaultSpec, currentOverrides) : null),
    [defaultSpec, currentOverrides],
  );

  const updateOverride = useCallback(
    (key: keyof SpecOverrides, raw: string) => {
      if (!instrumentKey) return;
      setOverridesMap((prev) => {
        const existing = prev[instrumentKey] ?? {};
        const trimmed = raw.trim();
        let next: SpecOverrides;
        if (trimmed === "") {
          // Empty input clears that specific override.
          const { [key]: _removed, ...rest } = existing;
          next = rest;
        } else {
          const n = Number(trimmed);
          if (!Number.isFinite(n) || n <= 0) return prev;
          next = { ...existing, [key]: n };
        }
        const merged: OverridesMap = { ...prev };
        if (Object.keys(next).length === 0) {
          delete merged[instrumentKey];
        } else {
          merged[instrumentKey] = next;
        }
        saveOverrides(merged);
        return merged;
      });
    },
    [instrumentKey],
  );

  const resetOverrides = useCallback(() => {
    if (!instrumentKey) return;
    setOverridesMap((prev) => {
      if (!prev[instrumentKey]) return prev;
      const { [instrumentKey]: _dropped, ...rest } = prev;
      saveOverrides(rest);
      return rest;
    });
  }, [instrumentKey]);

  const setRiskPercent = useCallback((delta: number) => {
    setForm((prev) => ({
      ...prev,
      riskPercent: Math.min(
        RISK_MAX,
        Math.max(RISK_MIN, Math.round((prev.riskPercent + delta) * 10) / 10),
      ),
    }));
  }, []);

  const input: LotSizeInput | null = useMemo(() => {
    if (!form.instrument) return null;
    const balance = Number(form.accountBalance);
    const entry = Number(form.entryPrice);
    const sl = Number(form.stopLossPrice);
    if (!Number.isFinite(balance) || balance <= 0) return null;
    if (!Number.isFinite(entry) || entry <= 0) return null;
    if (!Number.isFinite(sl) || sl <= 0) return null;

    const rate = Number(form.quoteToAccountRate);

    return {
      accountBalance: balance,
      accountCurrency: form.accountCurrency,
      riskPercent: form.riskPercent,
      instrument: form.instrument,
      direction: form.direction,
      entryPrice: entry,
      stopLossPrice: sl,
      rewardRatio: form.rewardRatio,
      leverage: form.leverage > 0 ? form.leverage : undefined,
      quoteToAccountRate:
        Number.isFinite(rate) && rate > 0 ? rate : undefined,
      overrides: currentOverrides,
    };
  }, [form, currentOverrides]);

  const result = useMemo(
    () => (input ? computeLotSize(input) : null),
    [input],
  );

  const cross = needsCrossRate(form.instrument);

  const currency = currencyOf(form.accountCurrency);
  const accountSymbol = currency.symbol;
  const CurrencyIcon = currency.icon;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <Scale className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Lot Size Calculator
          </h1>
          <p className="text-sm text-muted-foreground">
            Forex, metals, indices, commodities, and crypto CFDs — with
            per-instrument broker overrides.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Inputs ────────────────────────────────────────────────── */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold text-foreground">
              Trade Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Account Balance + Currency */}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="balance" className="text-xs font-medium text-muted-foreground">
                  Account Balance
                </Label>
                <div className="relative">
                  {/* Icon tracks the selected account currency — swapping
                      the currency dropdown rerenders this with the matching
                      lucide glyph (DollarSign / Euro / PoundSterling) so the
                      input affordance never lies. */}
                  <CurrencyIcon
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="balance"
                    type="number"
                    min={0}
                    step={100}
                    value={form.accountBalance}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, accountBalance: e.target.value }))
                    }
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Currency
                </Label>
                <Select
                  value={form.accountCurrency}
                  onValueChange={(v) =>
                    setForm((p) => ({
                      ...p,
                      accountCurrency: v as AccountCurrency,
                    }))
                  }
                >
                  <SelectTrigger className="w-[110px]">
                    {/* Mirror the balance-input affordance: show the matching
                        currency glyph alongside the code so the trigger
                        doesn't look empty/inconsistent with the input. */}
                    <span className="flex items-center gap-1.5">
                      <CurrencyIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <span>{form.accountCurrency}</span>
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_CURRENCIES.map((c) => {
                      const Icon = c.icon;
                      return (
                        <SelectItem key={c.value} value={c.value}>
                          <span className="flex items-center gap-2">
                            <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            <span>{c.value}</span>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Risk % */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Risk %
              </Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 shrink-0 p-0"
                  onClick={() => setRiskPercent(-RISK_STEP)}
                  disabled={form.riskPercent <= RISK_MIN}
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={RISK_MIN}
                  max={RISK_MAX}
                  step={RISK_STEP}
                  value={form.riskPercent}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      riskPercent: Math.min(
                        RISK_MAX,
                        Math.max(
                          RISK_MIN,
                          parseFloat(e.target.value) || RISK_MIN,
                        ),
                      ),
                    }))
                  }
                  className="text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 shrink-0 p-0"
                  onClick={() => setRiskPercent(RISK_STEP)}
                  disabled={form.riskPercent >= RISK_MAX}
                >
                  +
                </Button>
              </div>
            </div>

            {/* Instrument */}
            <div className="space-y-1.5">
              <Label htmlFor="instrument" className="text-xs font-medium text-muted-foreground">
                Instrument
              </Label>
              <Input
                id="instrument"
                list="lot-calc-instruments"
                placeholder="e.g. EURUSD, XAUUSD, US30, BTCUSDT, USOIL"
                value={form.instrument}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    instrument: e.target.value.toUpperCase().trim(),
                  }))
                }
              />
              <datalist id="lot-calc-instruments">
                {ALL_INSTRUMENTS.map((inst) => (
                  <option key={inst} value={inst} />
                ))}
              </datalist>
              {defaultSpec && (
                <p className="text-[11px] text-muted-foreground/70">
                  Asset class:{" "}
                  <span className="capitalize text-foreground">
                    {defaultSpec.assetClass}
                  </span>{" "}
                  · Contract: {formatNumber(defaultSpec.contractSize, 0)} ·
                  Pip: {defaultSpec.pipSize}
                </p>
              )}
            </div>

            {/* Direction */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Direction
              </Label>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, direction: "buy" }))}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors",
                    form.direction === "buy"
                      ? "bg-pos/15 text-pos"
                      : "bg-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  <TrendingUp className="size-4" />
                  Buy / Long
                </button>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, direction: "sell" }))}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 border-l border-border py-2 text-sm font-medium transition-colors",
                    form.direction === "sell"
                      ? "bg-neg/15 text-neg"
                      : "bg-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  <TrendingDown className="size-4" />
                  Sell / Short
                </button>
              </div>
            </div>

            {/* Entry + SL */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="entry" className="text-xs font-medium text-muted-foreground">
                  Entry Price
                </Label>
                <Input
                  id="entry"
                  type="number"
                  min={0}
                  step="any"
                  placeholder="1.0850"
                  value={form.entryPrice}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, entryPrice: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sl" className="text-xs font-medium text-muted-foreground">
                  Stop Loss
                </Label>
                <Input
                  id="sl"
                  type="number"
                  min={0}
                  step="any"
                  placeholder="1.0820"
                  value={form.stopLossPrice}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, stopLossPrice: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* Reward ratio + leverage */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Reward Ratio
                </Label>
                <Select
                  value={String(form.rewardRatio)}
                  onValueChange={(v) =>
                    setForm((p) => ({
                      ...p,
                      rewardRatio: Number(v) as RewardRatio,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REWARD_RATIOS.map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        1:{r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Leverage
                </Label>
                <Select
                  value={String(form.leverage)}
                  onValueChange={(v) =>
                    setForm((p) => ({ ...p, leverage: Number(v) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVERAGES.map((lev) => (
                      <SelectItem key={lev} value={String(lev)}>
                        {lev === 0 ? "Not set" : `1:${lev}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Cross-rate hint */}
            {cross.needed && (
              <div className="space-y-1.5">
                <Label htmlFor="cross-rate" className="text-xs font-medium text-muted-foreground">
                  Current {cross.rateSymbol} rate
                </Label>
                <Input
                  id="cross-rate"
                  type="number"
                  step="any"
                  min={0}
                  placeholder="e.g. 1.27"
                  value={form.quoteToAccountRate}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      quoteToAccountRate: e.target.value,
                    }))
                  }
                />
                <p className="flex items-start gap-1 text-[11px] text-muted-foreground/80">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  Needed only for cross pairs (neither leg is USD). Without it
                  the sizing is approximate.
                </p>
              </div>
            )}

            {/* Advanced / broker overrides */}
            {defaultSpec && (
              <div className="rounded-lg border border-border bg-background/30">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-foreground"
                >
                  <span>Advanced · Broker overrides</span>
                  {advancedOpen ? (
                    <ChevronUp className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  )}
                </button>
                {advancedOpen && effectiveSpec && (
                  <div className="space-y-3 border-t border-border px-3 py-3">
                    <p className="text-[11px] text-muted-foreground">
                      These defaults match most retail brokers. Override them if
                      your broker publishes different numbers — saved per
                      instrument to this browser.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <OverrideField
                        label="Contract size"
                        defaultValue={defaultSpec.contractSize}
                        value={currentOverrides?.contractSize}
                        onChange={(v) => updateOverride("contractSize", v)}
                      />
                      <OverrideField
                        label="Pip size"
                        defaultValue={defaultSpec.pipSize}
                        value={currentOverrides?.pipSize}
                        onChange={(v) => updateOverride("pipSize", v)}
                      />
                      <OverrideField
                        label="Tick size"
                        defaultValue={defaultSpec.tickSize}
                        value={currentOverrides?.tickSize}
                        onChange={(v) => updateOverride("tickSize", v)}
                      />
                      <OverrideField
                        label="Tick value (USD/lot)"
                        defaultValue={defaultSpec.tickValuePerLotUSD}
                        value={currentOverrides?.tickValuePerLotUSD}
                        onChange={(v) =>
                          updateOverride("tickValuePerLotUSD", v)
                        }
                      />
                    </div>
                    {currentOverrides && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={resetOverrides}
                        className="h-7 px-2 text-xs text-muted-foreground"
                      >
                        <RotateCcw className="mr-1 size-3" />
                        Reset overrides for {instrumentKey}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Results ───────────────────────────────────────────────── */}
        <div className="space-y-4">
          {result === null ? (
            <Card className="border-border bg-card">
              <CardContent className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-center">
                <Calculator className="size-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Enter an instrument, entry, and stop loss to see the lot
                  size.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Lots — hero */}
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="py-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Standard Lots
                  </p>
                  <p className="mt-1 text-5xl font-bold text-foreground">
                    {formatLots(result.standardLots)}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-border bg-card px-2 py-1.5">
                      <p className="text-muted-foreground">Mini lots</p>
                      <p className="mt-0.5 font-semibold text-foreground">
                        {formatLots(result.miniLots)}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-card px-2 py-1.5">
                      <p className="text-muted-foreground">Micro lots</p>
                      <p className="mt-0.5 font-semibold text-foreground">
                        {formatLots(result.microLots)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground/80">
                    {formatNumber(result.units, 2)} units · 1 pip ≈{" "}
                    {accountSymbol}
                    {formatNumber(result.pipValuePerLotAccount, 2)}/lot
                  </p>
                </CardContent>
              </Card>

              {/* Risk / reward */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="border-border bg-card">
                  <CardContent className="py-4">
                    <p className="text-xs text-muted-foreground">Risk</p>
                    <p className="mt-1 text-xl font-bold text-foreground">
                      {accountSymbol}
                      {formatNumber(result.dollarRisk)}
                    </p>
                    <Badge
                      variant="outline"
                      className="mt-1 border-neg/30 bg-neg/10 text-neg text-[10px]"
                    >
                      at {form.riskPercent}% of balance
                    </Badge>
                  </CardContent>
                </Card>
                <Card className="border-border bg-card">
                  <CardContent className="py-4">
                    <p className="text-xs text-muted-foreground">
                      Reward (1:{form.rewardRatio})
                    </p>
                    <p className="mt-1 text-xl font-bold text-foreground">
                      {accountSymbol}
                      {formatNumber(result.rewardAmount)}
                    </p>
                    <Badge
                      variant="outline"
                      className="mt-1 border-pos/30 bg-pos/10 text-pos text-[10px]"
                    >
                      target {formatNumber(result.targetPrice, 5)}
                    </Badge>
                  </CardContent>
                </Card>
              </div>

              {/* Pips + notional */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="border-border bg-card">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Shield className="size-3.5" />
                      Pips at Risk
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-lg font-bold text-foreground">
                      {formatNumber(result.pipsAtRisk, 1)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(result.priceDistance, 5)} price
                      distance
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-border bg-card">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Target className="size-3.5" />
                      Notional
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-lg font-bold text-foreground">
                      {accountSymbol}
                      {formatNumber(result.notionalAccount, 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      position size × entry
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Margin */}
              {result.marginRequiredAccount !== null && (
                <Card className="border-border bg-card">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Margin required at 1:{form.leverage}
                        </p>
                        <p className="mt-0.5 text-lg font-bold text-foreground">
                          {accountSymbol}
                          {formatNumber(result.marginRequiredAccount, 0)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          result.marginRequiredAccount > Number(form.accountBalance)
                            ? "border-neg/30 bg-neg/10 text-neg"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        {formatNumber(
                          (result.marginRequiredAccount /
                            Number(form.accountBalance)) *
                            100,
                          1,
                        )}
                        % of balance
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="space-y-2">
                  {result.warnings.map((w, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                        w.level === "error" &&
                          "border-neg/30 bg-neg/10 text-neg",
                        w.level === "warn" &&
                          "border-warn/30 bg-warn/10 text-warn",
                        w.level === "info" &&
                          "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      <Info className="mt-0.5 size-3.5 shrink-0" />
                      <span>{w.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Caveat */}
              <p className="text-[11px] text-muted-foreground/70">
                Contract sizes and tick values are industry defaults. If your
                broker uses different numbers, expand Advanced · Broker
                overrides above.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Override input helper ─────────────────────────────────────────────────
function OverrideField({
  label,
  defaultValue,
  value,
  onChange,
}: {
  readonly label: string;
  readonly defaultValue: number;
  readonly value: number | undefined;
  readonly onChange: (raw: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium text-muted-foreground">
        {label}
      </Label>
      <Input
        type="number"
        step="any"
        min={0}
        placeholder={String(defaultValue)}
        value={value !== undefined ? String(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
    </div>
  );
}
