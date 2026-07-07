import Link from "next/link";
import { FileUp } from "lucide-react";
import { MyfxbookConnectCard } from "@/components/myfxbook/myfxbook-connect-card";

export const metadata = { title: "MT5 Sync | FX Unlock" };

export default function Mt5SyncPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">MT5 Sync</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Link your MetaTrader account and your trades sync into the journal
          automatically — no desktop terminal or VPS required.
        </p>
      </div>

      <MyfxbookConnectCard />

      {/* Backfill / manual path */}
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        Already have older trades to bring in? Myfxbook only exposes recent
        history, so for a full backfill{" "}
        <Link
          href="/import"
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
        >
          <FileUp className="h-3.5 w-3.5" />
          import your MT5 report
        </Link>
        .
      </div>
    </div>
  );
}
