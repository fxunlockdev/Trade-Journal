import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyRenderToken } from "@/lib/reports/render-token";
import { getTemplate } from "@/lib/posters/templates";
import { getTheme } from "@/lib/posters/theme";
import { posterDisclaimer } from "@/lib/posters/disclaimer";
import { POSTER_SIZE } from "@/lib/posters/templates/types";
import { formatPeriodLabel } from "@/lib/reports/periods-tz";
import type { ReportMetrics } from "@/lib/reports/metrics";
import type { Cadence } from "@/lib/reports/periods-tz";

/**
 * One poster, drawn from a frozen snapshot, for a headless browser to
 * screenshot.
 *
 * Deliberately OUTSIDE the (app) route group: it inherits the root layout —
 * which is where the poster fonts are loaded, and they must be — but none of
 * the sidebar or shell. The page is the poster and nothing else, so a
 * screenshot of the viewport is the artefact.
 *
 * Authorised by a signed, short-lived token in the path rather than a session:
 * the browser doing the screenshotting carries no cookies. See
 * lib/reports/render-token.ts.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SnapshotRow {
  readonly id: string;
  readonly cadence: Cadence;
  readonly period_start: string;
  readonly period_end: string;
  readonly metrics: ReportMetrics;
  readonly report_desks: {
    readonly name: string;
    readonly journal_ids: readonly string[];
    readonly theme_id: string;
    readonly logo_path: string | null;
  } | null;
}

/** How long the logo URL needs to outlive its own page load. Short, because it
 *  is minted per render and never leaves this process except into Chromium. */
const LOGO_URL_TTL_SECONDS = 120;

export default async function RenderPosterPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}) {
  const { token } = await params;
  const claims = verifyRenderToken(decodeURIComponent(token));
  // 404 for every rejection — bad signature, expired, unconfigured. The page
  // should not confirm that a snapshot id exists to someone without a token.
  if (!claims) notFound();

  const admin = createAdminClient();
  const { data } = await admin
    .from("report_snapshots")
    .select(
      "id, cadence, period_start, period_end, metrics, report_desks(name, journal_ids, theme_id, logo_path)",
    )
    .eq("id", claims.snapshotId)
    .maybeSingle();

  const snapshot = data as SnapshotRow | null;
  if (!snapshot?.report_desks) notFound();

  const template = getTemplate(claims.style);
  const Template = template.Component;

  // The DESK's theme, not a hardcoded one. Until this existed, a user could
  // pick Blue Violet, publish, and receive Obsidian Gold: what they designed
  // was never what went to the group. `getTheme` falls back to the default for
  // an unknown id, so a stale value degrades to a plain poster rather than
  // failing a 06:00 render.
  const theme = getTheme(snapshot.report_desks.theme_id);

  // The logo lives in a PRIVATE bucket, so a short-lived signed URL is minted
  // here and handed to Chromium. A public URL would put every customer's brand
  // asset behind a guessable address.
  //
  // Best-effort: a missing or unreadable logo prints the name instead, which is
  // the pre-logo behaviour and strictly better than failing the render.
  let logoUrl: string | null = null;
  if (snapshot.report_desks.logo_path) {
    const signed = await admin.storage
      .from("desk-logos")
      .createSignedUrl(snapshot.report_desks.logo_path, LOGO_URL_TTL_SECONDS);
    logoUrl = signed.data?.signedUrl ?? null;
  }

  // The SAME notes the preview shows a human.
  //
  // This used to build its own shorter version, carrying only the combined
  // note and the boilerplate. So every automatically published poster went to
  // partners with three qualifications stripped: which trades the Avg R
  // actually covers, that the win rate excludes breakevens, and how many
  // trades were placed by entry date because no close time was recorded. The
  // path with no human in the loop had the least disclosure.
  const disclaimer = posterDisclaimer(
    snapshot.metrics.stats,
    snapshot.report_desks.journal_ids.length,
  );

  return (
    <div
      // Exactly the poster, at its true size, pinned to the origin so the
      // screenshot needs no clipping maths.
      style={{
        width: POSTER_SIZE,
        height: POSTER_SIZE,
        overflow: "hidden",
        position: "absolute",
        top: 0,
        left: 0,
      }}
      data-testid="render-canvas"
    >
      <Template
        stats={snapshot.metrics.stats}
        theme={theme}
        group={snapshot.report_desks.name}
        logo={logoUrl}
        periodKind={snapshot.cadence.toUpperCase()}
        dateLabel={formatPeriodLabel({
          cadence: snapshot.cadence,
          start: snapshot.period_start,
          end: snapshot.period_end,
        })}
        disclaimer={disclaimer}
      />
    </div>
  );
}
