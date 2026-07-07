import { MyfxbookConnectCard } from "@/components/myfxbook/myfxbook-connect-card";
import { ImportPanel } from "@/components/import/import-panel";

export const metadata = { title: "MT5 Sync | FX Unlock" };

export default function Mt5SyncPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">MT5 Sync</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Link your MetaTrader account and your trades sync into the journal
          automatically — no desktop terminal or VPS required.
        </p>
      </div>

      {/* Automatic — free Myfxbook bridge */}
      <MyfxbookConnectCard />

      {/* Manual — upload an MT5/MT4 report (also the deep-history backfill) */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            or import a report
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Import from an MT5 / MT4 report
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            No Myfxbook? Upload your MetaTrader history report and closed trades
            land instantly — with the broker&apos;s exact P&amp;L. Also the way
            to backfill older trades (Myfxbook only exposes recent history).
            Re-importing never duplicates.
          </p>
        </div>
        <ImportPanel />
      </section>
    </div>
  );
}
