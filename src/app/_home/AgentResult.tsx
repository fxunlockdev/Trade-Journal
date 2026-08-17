"use client";

import type { FlowResult } from "@/lib/assistant/flows";
import { formatUsd } from "@/lib/rebate/rates";

/**
 * Inline result cards.
 *
 * The answer is the moment that matters, so it gets the emphasis: one hero
 * figure, the supporting numbers beneath it, and nothing else competing. These
 * sit inside the assistant bubble, which already sits on glass, so they use
 * fills and hairlines rather than another elevated surface.
 */
export function AgentResult({ result }: { result: FlowResult }) {
  if (result.kind === "risk") {
    return (
      <div className="ares">
        <div className="ares-head">
          <span className={`ares-tag ${result.direction === "buy" ? "buy" : "sell"}`}>
            {result.direction.toUpperCase()}
          </span>
          <span className="ares-sym">{result.instrument}</span>
        </div>

        <div className="ares-hero">
          <span className="ares-hero-value">{result.lots.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span className="ares-hero-unit">lots</span>
        </div>
        <p className="ares-hero-sub">
          {Math.round(result.units).toLocaleString()} units · risking {formatUsd(result.riskAmount)} of{" "}
          {formatUsd(result.balance)}
        </p>

        <dl className="ares-grid">
          <div><dt>Risk</dt><dd>{result.riskPercent}%</dd></div>
          <div><dt>At risk</dt><dd>{formatUsd(result.riskAmount)}</dd></div>
          <div><dt>Stop distance</dt><dd>{result.pipsAtRisk.toFixed(1)} pips</dd></div>
        </dl>

        {result.notes.length > 0 && <p className="ares-note">{result.notes[0]}</p>}
      </div>
    );
  }

  if (result.kind === "rebate") {
    return (
      <div className="ares">
        <div className="ares-head">
          <span className="ares-tag rebate">REBATE</span>
          <span className="ares-sym">{result.assetLabel}</span>
        </div>

        <div className="ares-hero">
          <span className="ares-hero-value grad-text">{formatUsd(result.monthlyMid)}</span>
          <span className="ares-hero-unit">/ month</span>
        </div>
        <p className="ares-hero-sub">
          {formatUsd(result.monthlyLow)} to {formatUsd(result.monthlyHigh)} depending on terms
        </p>

        <dl className="ares-grid">
          <div><dt>Volume</dt><dd>{result.lots.toLocaleString()} lots</dd></div>
          <div><dt>Per lot</dt><dd>${result.perLotLow}–${result.perLotHigh}</dd></div>
          <div><dt>Yearly</dt><dd>{formatUsd(result.annualMid)}</dd></div>
        </dl>

        <a className="ares-cta" href="/rebate-calculator">
          Get your real terms <span className="chev">›</span>
        </a>
      </div>
    );
  }

  // Trade draft: shown for confirmation, not saved yet.
  return (
    <div className="ares">
      <div className="ares-head">
        <span className={`ares-tag ${result.direction === "buy" ? "buy" : "sell"}`}>
          {result.direction.toUpperCase()}
        </span>
        <span className="ares-sym">{result.instrument}</span>
        <span className="ares-draft">Draft</span>
      </div>

      <div className="ares-hero">
        <span className="ares-hero-value">{result.entry}</span>
        <span className="ares-hero-unit">entry</span>
      </div>
      <p className="ares-hero-sub">{result.lots} lots</p>

      <dl className="ares-grid">
        <div><dt>Stop</dt><dd>{result.stop ?? "–"}</dd></div>
        <div><dt>Target</dt><dd>{result.target ?? "–"}</dd></div>
        <div><dt>R:R</dt><dd>{result.riskReward ? `${result.riskReward.toFixed(2)}R` : "–"}</dd></div>
      </dl>
    </div>
  );
}
