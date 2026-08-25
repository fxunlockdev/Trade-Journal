"use client";

import {
  formatAvgR,
  formatPips,
  formatRowPips,
  formatWinRate,
  type PosterTradeRow,
} from "@/lib/posters/poster-data";
import type { PosterTheme } from "@/lib/posters/theme";
import {
  fitHeadline,
  GradientNumber,
  noiseLayerStyle,
  POSTER_SIZE,
  type PosterProps,
} from "@/lib/posters/templates/types";

/**
 * Rows that fit at comfortable spacing before the layout must densify.
 * Densifying at 8 used to drop the font to 14px AND stretch eight rows across
 * the full height, which looked broken for a perfectly ordinary trading day.
 */
const COMFY_MAX = 12;
/** Hard ceiling — beyond this the log is truncated and the overflow is stated. */
const DENSE_MAX = 20;

const LOG_COLUMNS = "1fr 1.1fr 0.9fr 1.1fr 0.8fr 0.9fr";

function resultLabel(row: PosterTradeRow): string {
  if (row.result === "win") return "WIN";
  if (row.result === "loss") return "LOSS";
  return "BE";
}

function LogRow({
  row,
  theme,
  dense,
}: {
  readonly row: PosterTradeRow;
  readonly theme: PosterTheme;
  readonly dense: boolean;
}) {
  // Colour follows the MONEY result, not the pip sign: a trade closed for a
  // small pip gain that lost money after fees must not read as a win.
  const resultColor =
    row.result === "win"
      ? theme.win
      : row.result === "loss"
        ? theme.loss
        : theme.tMuted;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: LOG_COLUMNS,
        alignItems: "center",
        padding: dense ? "3px 6px" : "13px 6px",
        borderBottom: `1px solid ${theme.tRowLine}`,
        fontSize: dense ? 14 : 17,
        lineHeight: dense ? 1.15 : undefined,
      }}
    >
      <div style={{ fontSize: dense ? undefined : 14, color: theme.tMuted }}>
        {row.date}
      </div>
      <div style={{ fontWeight: 500 }}>{row.pair}</div>
      <div>
        <span
          style={{
            display: "inline-block",
            padding: dense ? "1px 9px" : "3px 12px",
            borderRadius: 999,
            fontSize: dense ? 10 : 12,
            letterSpacing: dense ? "0.1em" : "0.12em",
            textTransform: "uppercase",
            border: `1px solid ${row.direction === "buy" ? theme.win : theme.loss}55`,
            color: row.direction === "buy" ? theme.win : theme.loss,
          }}
        >
          {row.direction}
        </span>
      </div>
      <div
        style={{
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: theme.tText2,
        }}
      >
        {row.entry}
      </div>
      <div
        style={{
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          color: resultColor,
        }}
      >
        {row.pips === null ? "—" : formatRowPips(row.pips)}
      </div>
      <div
        style={{
          textAlign: "right",
          fontSize: dense ? 11 : 13,
          letterSpacing: dense ? "0.08em" : "0.1em",
          textTransform: "uppercase",
          color: resultColor,
        }}
      >
        {resultLabel(row)}
      </div>
    </div>
  );
}

/**
 * Design C — stat strip over a per-trade log.
 * Ported from the supplied `Design C.dc.html`. The original's `sc-if` comfy /
 * dense branches become a row-count switch, and the `moreNote` states any
 * truncation so the log never silently misrepresents the trade count.
 */
export function DesignC({
  stats,
  theme,
  group,
  periodKind,
  dateLabel,
  disclaimer,
}: PosterProps) {
  const dense = stats.log.length > COMFY_MAX;
  const visible = stats.log.slice(0, dense ? DENSE_MAX : COMFY_MAX);
  const hidden = stats.log.length - visible.length;

  const statCell: React.CSSProperties = {
    background: theme.tCardBg,
    padding: "22px 26px",
  };
  const statLabel: React.CSSProperties = {
    fontSize: 12,
    letterSpacing: "0.24em",
    textTransform: "uppercase",
    color: theme.tMuted,
    marginBottom: 8,
  };
  const statValue: React.CSSProperties = {
    fontFamily: "var(--font-poster-display), sans-serif",
    fontWeight: 600,
    fontSize: 52,
    lineHeight: 0.9,
  };

  return (
    <div
      style={{
        position: "relative",
        width: POSTER_SIZE,
        height: POSTER_SIZE,
        overflow: "hidden",
        background: theme.tBg,
        fontFamily: "var(--font-poster-body), sans-serif",
        color: theme.tText,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(90% 60% at 50% -8%, ${theme.tGlow1}, transparent 55%), ${theme.tBg}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(116deg, transparent 26%, ${theme.tStreak} 40%, transparent 55%), linear-gradient(116deg, transparent 62%, ${theme.tStreak} 72%, transparent 84%)`,
        }}
      />
      <div style={noiseLayerStyle} />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          background: theme.tTopBar,
        }}
      />

      <div
        style={{
          position: "relative",
          height: "100%",
          padding: "70px 72px 58px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 34,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 14,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: theme.tAccent,
              }}
            >
              {periodKind} Results · {stats.asset}
            </div>
            <div style={{ fontSize: 19, color: theme.tText2 }}>{dateLabel}</div>
          </div>
          <div
            style={{
              border: `1px solid ${theme.tChipBorder}`,
              borderRadius: 6,
              padding: "12px 22px",
              textAlign: "right",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: theme.tMuted,
              }}
            >
              Group
            </div>
            <div
              style={{
                fontFamily: "var(--font-poster-display), sans-serif",
                fontWeight: 600,
                fontSize: 24,
                lineHeight: 1,
              }}
            >
              {group}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
            gap: 1,
            background: theme.tFrame,
            border: `1px solid ${theme.tFrame}`,
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div style={statCell}>
            <div style={statLabel}>Net Pips</div>
            <GradientNumber
              gradient={theme.tNumGrad}
              fallbackColor={theme.tAccent}
              style={{
                fontFamily: "var(--font-poster-display), sans-serif",
                fontWeight: 700,
                fontSize: fitHeadline(formatPips(stats.pips), 64),
                lineHeight: 0.9,
              }}
            >
              {formatPips(stats.pips)}
            </GradientNumber>
          </div>
          <div style={statCell}>
            <div style={statLabel}>Trades</div>
            <div style={statValue}>{stats.tradeCount}</div>
          </div>
          <div style={statCell}>
            <div style={statLabel}>Win Rate</div>
            <div style={{ ...statValue, color: theme.tAccent }}>
              {formatWinRate(stats.winRate)}
            </div>
          </div>
          <div style={statCell}>
            <div style={statLabel}>Avg R</div>
            <div style={{ ...statValue, color: theme.tAccent }}>
              {formatAvgR(stats.avgR)}
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontSize: 13,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: theme.tText2,
              }}
            >
              Trade Log
            </div>
            <div style={{ fontSize: 13, color: theme.tMuted }}>
              <span style={{ color: theme.win }}>{stats.wins} W</span> ·{" "}
              <span style={{ color: theme.loss }}>{stats.losses} L</span>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: LOG_COLUMNS,
              padding: "0 6px 12px",
              borderBottom: `1px solid ${theme.tFrame}`,
              fontSize: 12,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: theme.tMuted,
            }}
          >
            <div>Date</div>
            <div>Pair</div>
            <div>Buy / Sell</div>
            <div style={{ textAlign: "right" }}>Entry</div>
            <div style={{ textAlign: "right" }}>Pips</div>
            <div style={{ textAlign: "right" }}>Result</div>
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              minHeight: 0,
            }}
          >
            {visible.map((row) => (
              <LogRow key={row.id} row={row} theme={theme} dense={dense} />
            ))}
          </div>

          {hidden > 0 && (
            <div
              style={{
                marginTop: 12,
                fontSize: 14,
                color: theme.tFaint,
                fontFamily: "var(--font-poster-display), sans-serif",
              }}
            >
              + {hidden} more {hidden === 1 ? "trade" : "trades"} not shown
            </div>
          )}
        </div>

        <div style={{ fontSize: 11, lineHeight: 1.55, color: theme.tFaint }}>
          {disclaimer}
        </div>
      </div>
    </div>
  );
}
