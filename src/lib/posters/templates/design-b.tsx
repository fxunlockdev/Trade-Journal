"use client";

import {
  formatAvgR,
  formatPips,
  formatWinRate,
} from "@/lib/posters/poster-data";
import {
  fitHeadline,
  GradientNumber,
  noiseLayerStyle,
  POSTER_SIZE,
  type PosterProps,
} from "@/lib/posters/templates/types";

/**
 * Design B — framed card, hero pips beside a 2×2 stat grid.
 * Ported from the supplied `Design B.dc.html`; layout values are unchanged.
 */
export function DesignB({
  stats,
  theme,
  group,
  periodKind,
  dateLabel,
  disclaimer,
}: PosterProps) {
  const cell: React.CSSProperties = {
    padding: "26px 28px",
    borderBottom: `1px solid ${theme.tFrame}`,
    borderRight: `1px solid ${theme.tFrame}`,
  };
  const cellValue: React.CSSProperties = {
    fontFamily: "var(--font-poster-display), sans-serif",
    fontWeight: 600,
    fontSize: 52,
    lineHeight: 1,
  };
  const cellLabel: React.CSSProperties = {
    fontSize: 13,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color: theme.tMuted,
    marginTop: 10,
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
          background: `radial-gradient(100% 70% at 100% 0%, ${theme.tGlow1}, transparent 55%), radial-gradient(90% 80% at 0% 100%, ${theme.tGlow2}, transparent 55%), ${theme.tBg}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(48% 42% at 0% 0%, ${theme.tBlush}, transparent 60%), radial-gradient(48% 42% at 100% 100%, ${theme.tBlush}, transparent 60%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(116deg, transparent 24%, ${theme.tStreak} 39%, transparent 54%), linear-gradient(116deg, transparent 61%, ${theme.tStreak} 72%, transparent 84%)`,
        }}
      />
      <div style={noiseLayerStyle} />

      <div
        style={{
          position: "relative",
          height: "100%",
          padding: 80,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            position: "relative",
            flex: 1,
            border: `1px solid ${theme.tFrame}`,
            borderRadius: 6,
            background: theme.tCardFill,
            padding: "60px 60px 50px",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 18,
              left: 18,
              right: 18,
              bottom: 18,
              border: `1px solid ${theme.tFrameSoft}`,
              borderRadius: 3,
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                border: `1px solid ${theme.tChipBorder}`,
                borderRadius: 999,
                padding: "12px 24px",
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
            <div
              style={{
                textAlign: "right",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  letterSpacing: "0.3em",
                  textTransform: "uppercase",
                  color: theme.tAccent,
                }}
              >
                {periodKind} Results
              </div>
              <div style={{ fontSize: 18, color: theme.tText2 }}>{dateLabel}</div>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 56 }}>
            <div style={{ flex: "0 0 auto" }}>
              <div
                style={{
                  fontSize: 15,
                  letterSpacing: "0.32em",
                  textTransform: "uppercase",
                  color: theme.tText2,
                  marginBottom: 14,
                }}
              >
                {stats.asset}
              </div>
              <GradientNumber
                gradient={theme.tNumGrad}
                fallbackColor={theme.tAccent}
                style={{
                  fontFamily: "var(--font-poster-display), sans-serif",
                  fontWeight: 700,
                  fontSize: fitHeadline(formatPips(stats.pips), 150),
                  lineHeight: 0.8,
                  letterSpacing: "-0.02em",
                  whiteSpace: "nowrap",
                }}
              >
                {formatPips(stats.pips)}
              </GradientNumber>
              <div
                style={{
                  fontFamily: "var(--font-poster-display), sans-serif",
                  fontSize: 40,
                  color: theme.tText,
                  marginTop: 4,
                }}
              >
                PIPS
              </div>
            </div>
            <div
              style={{
                flex: 1,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 0,
                borderTop: `1px solid ${theme.tFrame}`,
                borderLeft: `1px solid ${theme.tFrame}`,
              }}
            >
              <div style={cell}>
                <div style={cellValue}>{stats.tradeCount}</div>
                <div style={cellLabel}>Trades</div>
              </div>
              <div style={cell}>
                <div style={cellValue}>
                  <span style={{ color: theme.win }}>{stats.wins}</span>
                  <span style={{ color: theme.tMuted, fontSize: 34 }}> / </span>
                  <span style={{ color: theme.loss }}>{stats.losses}</span>
                </div>
                <div style={cellLabel}>Win / Loss</div>
              </div>
              <div style={cell}>
                <div style={{ ...cellValue, color: theme.tAccent }}>
                  {formatWinRate(stats.winRate)}
                </div>
                <div style={cellLabel}>Win Rate</div>
              </div>
              <div style={cell}>
                <div style={{ ...cellValue, color: theme.tAccent }}>
                  {formatAvgR(stats.avgR)}
                </div>
                <div style={cellLabel}>Avg R:R</div>
              </div>
            </div>
          </div>

          <div
            style={{
              fontSize: 12,
              lineHeight: 1.6,
              color: theme.tFaint,
              maxWidth: 900,
            }}
          >
            {disclaimer}
          </div>
        </div>
      </div>
    </div>
  );
}
