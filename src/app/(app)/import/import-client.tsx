"use client";

import { ImportPanel } from "@/components/import/import-panel";

export function ImportClient() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Import Trades</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload your MetaTrader history report. Closed trades land in your
          journal with the broker&apos;s exact P&amp;L. Re-importing never
          duplicates.
        </p>
      </div>

      <ImportPanel />
    </div>
  );
}
