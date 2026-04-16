import Link from "next/link";
import { TradeForm } from "@/components/trade/trade-form";

export default function NewTradePage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4 md:p-6 lg:p-8">
      <div className="flex items-center gap-4">
        <Link
          href="/journal"
          className="inline-flex h-7 items-center justify-center rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">New Trade</h1>
      </div>

      <TradeForm />
    </div>
  );
}
