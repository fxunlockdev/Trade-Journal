"use client";

import { useState } from "react";
import {
  Calculator,
  DollarSign,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ALL_INSTRUMENTS } from "@/lib/constants/instruments";
import { computePipValue } from "@/lib/signals/computations";

type Direction = "buy" | "sell";
type RewardRatio = 1 | 2 | 3 | 4 | 5;

interface CalculatorInputs {
  readonly accountBalance: number;
  readonly riskPercent: number;
  readonly instrument: string;
  readonly entryPrice: string;
  readonly stopLossPrice: string;
  readonly rewardRatio: RewardRatio;
  readonly direction: Direction;
}

interface CalculationResult {
  readonly positionSize: number;
  readonly dollarRisk: number;
  readonly rewardAmount: number;
  readonly targetPrice: number;
  readonly priceDistance: number;
  readonly pipsAtRisk: number | null;
}

const REWARD_RATIOS: readonly RewardRatio[] = [1, 2, 3, 4, 5];
const RISK_STEP = 0.5;
const RISK_MIN = 0.5;
const RISK_MAX = 10;

function calculatePosition(inputs: CalculatorInputs): CalculationResult | null {
  const entry = parseFloat(inputs.entryPrice);
  const sl = parseFloat(inputs.stopLossPrice);

  if (!isFinite(entry) || !isFinite(sl) || entry <= 0 || sl <= 0) return null;

  // For buy: SL must be below entry. For sell: SL must be above entry.
  // Reject nonsensical SL placement instead of silently accepting it.
  if (inputs.direction === "buy" && sl >= entry) return null;
  if (inputs.direction === "sell" && sl <= entry) return null;

  const priceDistance = Math.abs(entry - sl);
  if (priceDistance === 0 || !Number.isFinite(priceDistance)) return null;

  const dollarRisk = inputs.accountBalance * (inputs.riskPercent / 100);

  // Position size = $ risk / price-distance. This is the number of "units"
  // such that (units × price-distance) = $ risk. Mathematically correct for
  // any instrument — it's the user's job to scale to their broker's lot size.
  const positionSize = dollarRisk / priceDistance;
  const rewardAmount = dollarRisk * inputs.rewardRatio;

  const targetPrice =
    inputs.direction === "buy"
      ? entry + priceDistance * inputs.rewardRatio
      : entry - priceDistance * inputs.rewardRatio;

  // Convert price distance to actual pips when an instrument is known.
  // Without an instrument, pip count is meaningless — we show price distance
  // only in that case (was silently reporting price-distance as "pips" before).
  const pipValue = inputs.instrument ? computePipValue(inputs.instrument) : 0;
  const pipsAtRisk =
    pipValue > 0 ? Math.round((priceDistance / pipValue) * 10) / 10 : null;

  return {
    positionSize,
    dollarRisk,
    rewardAmount,
    targetPrice,
    priceDistance,
    pipsAtRisk,
  };
}

function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function RiskCalculatorClient() {
  const [inputs, setInputs] = useState<CalculatorInputs>({
    accountBalance: 10000,
    riskPercent: 1,
    instrument: "",
    entryPrice: "",
    stopLossPrice: "",
    rewardRatio: 2,
    direction: "buy",
  });

  const result = calculatePosition(inputs);
  const showHighRiskWarning = inputs.riskPercent > 2;

  function setRiskPercent(delta: number) {
    setInputs((prev) => ({
      ...prev,
      riskPercent: Math.min(
        RISK_MAX,
        Math.max(RISK_MIN, Math.round((prev.riskPercent + delta) * 10) / 10)
      ),
    }));
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <Calculator className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Risk / Position Size Calculator
          </h1>
          <p className="text-sm text-muted-foreground">
            Calculate your position size based on account risk
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Inputs */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold text-foreground">
              Trade Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Account Balance */}
            <div className="space-y-1.5">
              <Label
                htmlFor="balance"
                className="text-xs font-medium text-muted-foreground"
              >
                Account Balance (USD)
              </Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="balance"
                  type="number"
                  min={0}
                  step={100}
                  value={inputs.accountBalance}
                  onChange={(e) =>
                    setInputs((prev) => ({
                      ...prev,
                      accountBalance: Math.max(0, parseFloat(e.target.value) || 0),
                    }))
                  }
                  className="pl-9"
                />
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
                  disabled={inputs.riskPercent <= RISK_MIN}
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={RISK_MIN}
                  max={RISK_MAX}
                  step={RISK_STEP}
                  value={inputs.riskPercent}
                  onChange={(e) =>
                    setInputs((prev) => ({
                      ...prev,
                      riskPercent: Math.min(
                        RISK_MAX,
                        Math.max(RISK_MIN, parseFloat(e.target.value) || RISK_MIN)
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
                  disabled={inputs.riskPercent >= RISK_MAX}
                >
                  +
                </Button>
              </div>
              {showHighRiskWarning && (
                <p className="mt-1 text-xs text-warn">
                  Warning: Risk exceeds 2%. Professional traders risk 1-2% per
                  trade
                </p>
              )}
            </div>

            {/* Instrument */}
            <div className="space-y-1.5">
              <Label
                htmlFor="instrument"
                className="text-xs font-medium text-muted-foreground"
              >
                Instrument{" "}
                <span className="text-muted-foreground/60">(optional)</span>
              </Label>
              <Input
                id="instrument"
                list="risk-calc-instruments"
                placeholder="e.g. EURUSD, XAUUSD, BTCUSDT"
                value={inputs.instrument}
                onChange={(e) =>
                  setInputs((prev) => ({
                    ...prev,
                    instrument: e.target.value.toUpperCase().trim(),
                  }))
                }
              />
              <datalist id="risk-calc-instruments">
                {ALL_INSTRUMENTS.map((inst) => (
                  <option key={inst} value={inst} />
                ))}
              </datalist>
              <p className="text-[11px] text-muted-foreground/70">
                Used to convert price distance → actual pips. Position size
                math works without it.
              </p>
            </div>

            {/* Direction Toggle */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Direction
              </Label>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() =>
                    setInputs((prev) => ({ ...prev, direction: "buy" }))
                  }
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors",
                    inputs.direction === "buy"
                      ? "bg-pos/15 text-pos"
                      : "bg-transparent text-muted-foreground hover:bg-muted"
                  )}
                >
                  <TrendingUp className="size-4" />
                  Buy / Long
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setInputs((prev) => ({ ...prev, direction: "sell" }))
                  }
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 border-l border-border py-2 text-sm font-medium transition-colors",
                    inputs.direction === "sell"
                      ? "bg-neg/15 text-neg"
                      : "bg-transparent text-muted-foreground hover:bg-muted"
                  )}
                >
                  <TrendingDown className="size-4" />
                  Sell / Short
                </button>
              </div>
            </div>

            {/* Entry Price */}
            <div className="space-y-1.5">
              <Label
                htmlFor="entry"
                className="text-xs font-medium text-muted-foreground"
              >
                Entry Price
              </Label>
              <Input
                id="entry"
                type="number"
                min={0}
                step="any"
                placeholder="e.g. 1.08450"
                value={inputs.entryPrice}
                onChange={(e) =>
                  setInputs((prev) => ({ ...prev, entryPrice: e.target.value }))
                }
              />
            </div>

            {/* Stop Loss Price */}
            <div className="space-y-1.5">
              <Label
                htmlFor="sl"
                className="text-xs font-medium text-muted-foreground"
              >
                Stop Loss Price
              </Label>
              <Input
                id="sl"
                type="number"
                min={0}
                step="any"
                placeholder="e.g. 1.08200"
                value={inputs.stopLossPrice}
                onChange={(e) =>
                  setInputs((prev) => ({
                    ...prev,
                    stopLossPrice: e.target.value,
                  }))
                }
              />
            </div>

            {/* Reward Ratio */}
            <div className="space-y-1.5">
              <Label
                htmlFor="rr"
                className="text-xs font-medium text-muted-foreground"
              >
                Reward Ratio (RR)
              </Label>
              <select
                id="rr"
                value={inputs.rewardRatio}
                onChange={(e) =>
                  setInputs((prev) => ({
                    ...prev,
                    rewardRatio: parseInt(e.target.value, 10) as RewardRatio,
                  }))
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {REWARD_RATIOS.map((r) => (
                  <option key={r} value={r}>
                    1:{r}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="space-y-4">
          {result === null ? (
            <Card className="border-border bg-card">
              <CardContent className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-center">
                <Shield className="size-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Enter entry and stop loss prices to calculate position size
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Position Size — hero card */}
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="py-6 text-center">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Position Size
                  </p>
                  <p className="mt-1 text-5xl font-bold text-foreground">
                    {formatNumber(result.positionSize, 2)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    units (${formatNumber(result.dollarRisk)} risk ÷{" "}
                    {formatNumber(result.priceDistance, 5)} price distance)
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    Convert to lots using your broker&apos;s contract size.
                  </p>
                </CardContent>
              </Card>

              {/* Risk & Reward */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="border-border bg-card">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Dollar Risk
                        </p>
                        <p className="mt-1 text-xl font-bold text-foreground">
                          ${formatNumber(result.dollarRisk)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="border-neg/30 bg-neg/10 text-neg text-xs"
                      >
                        You risk ${formatNumber(result.dollarRisk)}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border bg-card">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Reward (1:{inputs.rewardRatio})
                        </p>
                        <p className="mt-1 text-xl font-bold text-foreground">
                          ${formatNumber(result.rewardAmount)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="border-pos/30 bg-pos/10 text-pos text-xs"
                      >
                        You gain ${formatNumber(result.rewardAmount)}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Target Price & Pips */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="border-border bg-card">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                      <Target className="size-3.5" />
                      Target Price
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-lg font-bold text-foreground">
                      {formatNumber(result.targetPrice, 5)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      at 1:{inputs.rewardRatio} RR
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border bg-card">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                      <Shield className="size-3.5" />
                      {result.pipsAtRisk !== null
                        ? "Pips at Risk"
                        : "Price Distance"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-lg font-bold text-foreground">
                      {result.pipsAtRisk !== null
                        ? formatNumber(result.pipsAtRisk, 1)
                        : formatNumber(result.priceDistance, 5)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {result.pipsAtRisk !== null
                        ? "pips"
                        : "pick an instrument for pips"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Summary row */}
              <Card className="border-border bg-card">
                <CardContent className="py-3 px-4">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Balance:{" "}
                      <span className="font-medium text-foreground">
                        ${formatNumber(inputs.accountBalance)}
                      </span>
                    </span>
                    <span>
                      Risk:{" "}
                      <span
                        className={cn(
                          "font-medium",
                          showHighRiskWarning
                            ? "text-warn"
                            : "text-foreground"
                        )}
                      >
                        {inputs.riskPercent}%
                      </span>
                    </span>
                    <span>
                      Direction:{" "}
                      <span
                        className={cn(
                          "font-medium capitalize",
                          inputs.direction === "buy"
                            ? "text-pos"
                            : "text-neg"
                        )}
                      >
                        {inputs.direction}
                      </span>
                    </span>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
