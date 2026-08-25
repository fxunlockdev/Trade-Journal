"use client";

import { formatPips } from "@/lib/posters/poster-data";
import {
  fitHeadline,
  GradientNumber,
  noiseLayerStyle,
  POSTER_SIZE,
  type PosterProps,
} from "@/lib/posters/templates/types";

/**
 * Design A — hero pip count with a wins/losses footer.
 * Ported from the supplied `Design A.dc.html`; layout values are unchanged.
 */
export function DesignA({
  stats,
  theme,
  group,
  periodKind,
  dateLabel,
  disclaimer,
}: PosterProps) {
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
          background: `radial-gradient(120% 80% at 50% -10%, ${theme.tGlow1}, transparent 55%), radial-gradient(90% 90% at 50% 120%, ${theme.tGlow2}, transparent 60%), ${theme.tBg}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(52% 44% at 0% 0%, ${theme.tBlush}, transparent 62%), radial-gradient(52% 44% at 100% 100%, ${theme.tBlush}, transparent 62%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(116deg, transparent 26%, ${theme.tStreak} 40%, transparent 55%), linear-gradient(116deg, transparent 60%, ${theme.tStreak} 71%, transparent 83%)`,
        }}
      />
      <div style={noiseLayerStyle} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `repeating-linear-gradient(90deg, ${theme.tGridLine} 0 1px, transparent 1px 108px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 64,
          border: `1px solid ${theme.tFrame}`,
          borderRadius: 2,
        }}
      />

      <div
        style={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "108px 108px 92px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                fontSize: 13,
                letterSpacing: "0.32em",
                textTransform: "uppercase",
                color: theme.tMuted,
              }}
            >
              Presented by
            </div>
            <div
              style={{
                fontFamily: "var(--font-poster-display), sans-serif",
                fontWeight: 600,
                fontSize: 30,
                letterSpacing: "0.01em",
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
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 13,
                letterSpacing: "0.32em",
                textTransform: "uppercase",
                color: theme.tAccent,
              }}
            >
              {periodKind} Results
            </div>
            <div style={{ fontSize: 19, fontWeight: 400, color: theme.tText2 }}>
              {dateLabel}
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 44,
                height: 1,
                background: `linear-gradient(90deg, ${theme.tAccent}, transparent)`,
              }}
            />
            <div
              style={{
                fontSize: 16,
                letterSpacing: "0.34em",
                textTransform: "uppercase",
                color: theme.tText2,
              }}
            >
              {stats.asset}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 24,
              maxWidth: 864,
            }}
          >
            <GradientNumber
              gradient={theme.tNumGrad}
              fallbackColor={theme.tAccent}
              style={{
                fontFamily: "var(--font-poster-display), sans-serif",
                fontWeight: 700,
                fontSize: fitHeadline(formatPips(stats.pips), 270),
                lineHeight: 0.82,
                letterSpacing: "-0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {formatPips(stats.pips)}
            </GradientNumber>
          </div>
          <div
            style={{
              fontFamily: "var(--font-poster-display), sans-serif",
              fontWeight: 500,
              fontSize: 56,
              color: theme.tText,
              marginTop: 6,
            }}
          >
            PIPS
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 0,
            borderTop: `1px solid ${theme.tFrame}`,
            paddingTop: 34,
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-poster-display), sans-serif",
                fontWeight: 600,
                fontSize: 46,
              }}
            >
              {stats.tradeCount}
            </div>
            <div
              style={{
                fontSize: 14,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: theme.tMuted,
              }}
            >
              Trades
            </div>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              borderLeft: `1px solid ${theme.tFrameSoft}`,
              paddingLeft: 40,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-poster-display), sans-serif",
                fontWeight: 600,
                fontSize: 46,
                color: theme.win,
              }}
            >
              {stats.wins}
            </div>
            <div
              style={{
                fontSize: 14,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: theme.tMuted,
              }}
            >
              Wins
            </div>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              borderLeft: `1px solid ${theme.tFrameSoft}`,
              paddingLeft: 40,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-poster-display), sans-serif",
                fontWeight: 600,
                fontSize: 46,
                color: theme.loss,
              }}
            >
              {stats.losses}
            </div>
            <div
              style={{
                fontSize: 14,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: theme.tMuted,
              }}
            >
              Losses
            </div>
          </div>
          {/*
            Shown only when there are breakevens — but then it MUST be shown, or
            the footer reads "Trades 10 / Wins 4 / Losses 3" and a reader who
            subtracts concludes three trades were hidden.
          */}
          {stats.breakeven > 0 && (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                borderLeft: `1px solid ${theme.tFrameSoft}`,
                paddingLeft: 40,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-poster-display), sans-serif",
                  fontWeight: 600,
                  fontSize: 46,
                  color: theme.tMuted,
                }}
              >
                {stats.breakeven}
              </div>
              <div
                style={{
                  fontSize: 14,
                  letterSpacing: "0.24em",
                  textTransform: "uppercase",
                  color: theme.tMuted,
                }}
              >
                Breakeven
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 30,
            fontSize: 12,
            lineHeight: 1.6,
            color: theme.tFaint,
            letterSpacing: "0.01em",
            maxWidth: 820,
          }}
        >
          {disclaimer}
        </div>
      </div>
    </div>
  );
}
