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

type Direction = "buy" | "sell";
type RewardRatio = 1 | 2 | 3 | 4 | 5;

interface CalculatorInputs {
  readonly accountBalance: number;
  readonly riskPercent: number;
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
  readonly pipsAtRisk: number;
}

const REWARD_RATIOS: readonly RewardRatio[] = [1, 2, 3, 4, 5];
const RISK_STEP = 0.5;
const RISK_MIN = 0.5;
const RISK_MAX = 10;

function calculatePosition(inputs: CalculatorInputs): CalculationResult | null {
  const entry = parseFloat(inputs.entryPrice);
  const sl = parseFloat(inputs.stopLossPrice);

  if (!isFinite(entry) || !isFinite(sl) || entry <= 0 || sl <= 0) return null;

  const pipsAtRisk = Math.abs(entry - sl);
  if (pipsAtRisk === 0) return null;

  const dollarRisk = inputs.accountBalance * (inputs.riskPercent / 100);
  const positionSize = dollarRisk / pipsAtRisk;
  const rewardAmount = dollarRisk * inputs.rewardRatio;

  const targetPrice =
    inputs.direction === "buy"
      ? entry + (entry - sl) * inputs.rewardRatio
      : entry - (sl - entry) * inputs.rewardRatio;

  return { positionSize, dollarRisk, rewardAmount, targetPrice, pipsAtRisk };
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
                <p className="mt-1 text-xs text-amber-500">
                  Warning: Risk exceeds 2% — professional traders risk 1-2% per
                  trade
                </p>
              )}
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
                      ? "bg-emerald-500/15 text-emerald-500"
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
                      ? "bg-red-500/15 text-red-400"
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
                    units / contracts
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
                        className="border-red-500/30 bg-red-500/10 text-red-400 text-xs"
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
                        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-xs"
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
                      Pips at Risk
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-lg font-bold text-foreground">
                      {formatNumber(result.pipsAtRisk, 5)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      pips / points
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
                            ? "text-amber-500"
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
                            ? "text-emerald-500"
                            : "text-red-400"
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
