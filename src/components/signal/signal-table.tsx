"use client";

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { getStatusColor } from "@/lib/constants/signal-status";
import type { Signal } from "@/types/database";

interface SignalTableProps {
  readonly signals: readonly Signal[];
}

function formatPrice(price: number): string {
  return price.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function DirectionBadge({ direction }: { readonly direction: "buy" | "sell" }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-semibold uppercase",
        direction === "buy"
          ? "border-emerald-800 bg-emerald-950/50 text-emerald-400"
          : "border-red-800 bg-red-950/50 text-red-400",
      )}
    >
      {direction}
    </Badge>
  );
}

function StatusBadge({ status }: { readonly status: Signal["status"] }) {
  const colorClass = getStatusColor(status);

  return (
    <Badge
      variant="outline"
      className={cn("border-zinc-700 font-medium", colorClass)}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}

export function SignalTable({ signals }: SignalTableProps) {
  const router = useRouter();

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            <TableHead className="text-zinc-400">Date</TableHead>
            <TableHead className="text-zinc-400">Instrument</TableHead>
            <TableHead className="text-zinc-400">Direction</TableHead>
            <TableHead className="text-right text-zinc-400">Entry</TableHead>
            <TableHead className="text-right text-zinc-400">SL</TableHead>
            <TableHead className="text-zinc-400">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signals.map((signal) => (
            <TableRow
              key={signal.id}
              onClick={() => router.push(`/signals/${signal.id}`)}
              className="cursor-pointer border-zinc-800/50 transition-colors hover:bg-zinc-900/50"
            >
              <TableCell className="text-sm text-zinc-400">
                {formatDate(signal.created_at)}
              </TableCell>
              <TableCell className="font-medium text-zinc-100">
                {signal.instrument}
              </TableCell>
              <TableCell>
                <DirectionBadge direction={signal.direction} />
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-zinc-200">
                {formatPrice(signal.entry_price)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-zinc-400">
                {formatPrice(signal.stop_loss)}
              </TableCell>
              <TableCell>
                <StatusBadge status={signal.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
