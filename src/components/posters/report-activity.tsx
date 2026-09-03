import { Card, CardContent } from "@/components/ui/card";
import { nextRunFor } from "@/lib/reports/schedule";
import { resolveReportPeriod, type Cadence } from "@/lib/reports/periods-tz";
import type { ReportDesk } from "@/types/database";

/**
 * What the scheduler is going to do, and what it did last.
 *
 * Every confusion this feature has caused was a SILENCE. Nothing arrived, and
 * nothing said why: a period with no trades, a setup that predates the report,
 * a send still in doubt. Each time someone had to ask a person, who had to ask
 * the database.
 *
 * The information already existed in report_deliveries and was never shown. So
 * this is not new machinery, it is the same facts put where the question is
 * asked.
 */

export interface DeliverySummary {
  readonly deskId: string;
  readonly cadence: Cadence;
  readonly periodStart: string;
  readonly status: string;
  readonly images: number;
  readonly attempted: number;
  readonly sentAt: string | null;
  /** Always set, unlike sentAt. This is what "most recent" must mean. */
  readonly updatedAt: string;
  readonly error: string | null;
}

interface ReportActivityProps {
  readonly desks: readonly ReportDesk[];
  readonly deliveries: readonly DeliverySummary[];
  /**
   * Latest closed-trade date per desk, as a LOCAL date in that desk's zone.
   *
   * Null means genuinely none, not merely none recently: the page looks beyond
   * its own 75-day read before concluding that, because "no closed trades in
   * these journals" shown next to a partner-facing channel has to be true.
   */
  readonly lastTradeByDesk: Readonly<Record<string, string | null>>;
  readonly connected: boolean;
  /** Injected so the component stays pure and the page owns the clock. */
  readonly now: string;
}

const CADENCES: readonly Cadence[] = ["daily", "weekly", "monthly"];

/** "3 Sep, 06:00" — short, and in the desk's own zone, which is the only one
 *  that matters for when a report goes out. */
function whenLabel(date: string, hour: number): string {
  const [, m, d] = date.split("-").map(Number);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${MONTHS[m - 1]}, ${String(hour).padStart(2, "0")}:00`;
}

/** The outcome in words someone can act on, rather than a status code. */
function outcomeLabel(d: DeliverySummary): { text: string; tone: string } {
  if (d.status === "sent") {
    if (d.attempted > 0 && d.images < d.attempted) {
      return {
        text: `posted ${d.images} of ${d.attempted} styles`,
        tone: "text-warn",
      };
    }
    return { text: `posted ${d.images} images`, tone: "text-pos" };
  }
  if (d.status === "in_doubt") {
    return { text: "may or may not have posted, needs checking", tone: "text-warn" };
  }
  if (d.status === "superseded") {
    return { text: "replaced with newer figures", tone: "text-muted-foreground" };
  }
  if (d.status === "failed") {
    return { text: "failed, will retry", tone: "text-neg" };
  }
  if (d.status === "pending") {
    return { text: "sending now", tone: "text-muted-foreground" };
  }
  return { text: d.status, tone: "text-muted-foreground" };
}

export function ReportActivity({
  desks,
  deliveries,
  lastTradeByDesk,
  connected,
  now,
}: ReportActivityProps) {
  const active = desks.filter((d) => d.is_active);
  if (active.length === 0) return null;

  const instant = new Date(now);

  // Setups publishing to the same chat should almost always share a timezone.
  // When they do not, their reports arrive hours apart for no visible reason:
  // one setup created after the others kept the default zone, published three
  // hours later than its siblings, and looked broken. The zone was not shown
  // anywhere, so nothing on screen could have explained it.
  const zones = new Set(active.map((d) => d.timezone));
  const mixedZones = zones.size > 1;

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Scheduled reports
          </p>
          {!connected && (
            <p className="text-xs text-warn">
              No Telegram group is connected, so nothing will publish.
            </p>
          )}
          {mixedZones && (
            <p className="text-xs text-warn" data-testid="mixed-timezones">
              These setups use different timezones ({[...zones].join(", ")}), so
              their reports will arrive hours apart.
            </p>
          )}
        </div>

        <div className="space-y-4">
          {active.map((desk) => {
            // Sorted by updatedAt, NOT sentAt.
            //
            // A failed or in-doubt delivery never gets sent_at set, so sorting
            // by it ranks every failure below any past success. A desk that
            // published once and has been failing since would show a green
            // "posted 3 images" with the real problem hidden underneath, which
            // is precisely the silence this panel exists to end.
            const mine = deliveries
              .filter((d) => d.deskId === desk.id)
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            const last = mine[0];
            const lastTrade = lastTradeByDesk[desk.id] ?? null;

            // The warning that would have saved three conversations: the
            // journals stopped, so every period is empty and nothing will go
            // out, and nothing else on the page would say so.
            const quiet =
              lastTrade !== null &&
              new Date(now).getTime() - new Date(`${lastTrade}T12:00:00Z`).getTime() >
                2 * 24 * 60 * 60 * 1000;

            return (
              <div
                key={desk.id}
                className="space-y-1.5 border-t border-border pt-3 first:border-0 first:pt-0"
                data-testid={`report-activity-${desk.id}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{desk.name}</p>
                  {/* Shown always, not only on mismatch: a wrong zone is
                      invisible until someone can read the right one. */}
                  <p className="text-xs text-muted-foreground">
                    {desk.timezone}
                  </p>
                </div>

                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {CADENCES.map((cadence) => {
                    const next = nextRunFor(cadence, instant, desk.timezone);

                    // "Due now" is only honest if it has not already gone.
                    //
                    // The window stays open for two hours, so a report
                    // published at 06:00 would otherwise still read "due now"
                    // at 07:30. A panel that exists to answer "is this
                    // working?" must not imply something is pending when it
                    // has already happened.
                    const current = resolveReportPeriod(
                      cadence,
                      instant,
                      desk.timezone,
                    );
                    const done = mine.some(
                      (d) =>
                        d.cadence === cadence &&
                        d.periodStart === current.start &&
                        (d.status === "sent" || d.status === "superseded"),
                    );

                    return (
                      <span key={cadence}>
                        <span className="capitalize">{cadence}</span>{" "}
                        {next.dueNow && !done ? (
                          <span className="text-pos">due now</span>
                        ) : next.dueNow && done ? (
                          <span className="text-muted-foreground">sent today</span>
                        ) : (
                          whenLabel(next.date, next.hour)
                        )}
                      </span>
                    );
                  })}
                </div>

                {last ? (
                  <p className="text-xs">
                    <span className="text-muted-foreground">
                      Last: {last.cadence} for {last.periodStart} &mdash;{" "}
                    </span>
                    <span className={outcomeLabel(last).tone}>
                      {outcomeLabel(last).text}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing published yet.
                  </p>
                )}

                {last?.error && (
                  <p className="text-xs text-warn">{last.error}</p>
                )}

                {quiet && (
                  <p className="text-xs text-warn">
                    No closed trades since {lastTrade}. Nothing will publish
                    until newer trades are imported.
                  </p>
                )}

                {lastTrade === null && (
                  <p className="text-xs text-warn">
                    No closed trades in these journals, so nothing will publish.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Times are in each setup&rsquo;s own timezone, shown beside its name. A
          period with no closed trades is skipped rather than published empty.
        </p>
      </CardContent>
    </Card>
  );
}
