"use client";

import { useRouter } from "next/navigation";
import { Signal as SignalIcon } from "lucide-react";

import type { Signal } from "@/types/database";
import { cn, formatDateTime } from "@/lib/utils";
import { getStatusColor } from "@/lib/constants/signal-status";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SignalTableProps {
  readonly signals: readonly Signal[];
}

export function SignalTable({ signals }: SignalTableProps) {
  const router = useRouter();

  if (signals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-zinc-800/50 text-zinc-400">
          <SignalIcon className="size-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-zinc-200">
          No signals yet
        </h3>
        <p className="mt-1.5 max-w-sm text-sm text-zinc-500">
          Create your first signal to start broadcasting trade ideas.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            <TableHead className="text-zinc-500">Date</TableHead>
            <TableHead className="text-zinc-500">Instrument</TableHead>
            <TableHead className="text-zinc-500">Direction</TableHead>
            <TableHead className="text-zinc-500">Entry</TableHead>
            <TableHead className="text-zinc-500">SL</TableHead>
            <TableHead className="text-zinc-500">Status</TableHead>
            <TableHead className="text-right text-zinc-500">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signals.map((signal) => (
            <TableRow
              key={signal.id}
              className="cursor-pointer border-zinc-800 transition-colors hover:bg-zinc-800/50"
              onClick={() => router.push(`/signals/${signal.id}`)}
            >
              <TableCell className="text-sm tabular-nums text-zinc-400">
                {formatDateTime(signal.created_at)}
              </TableCell>
              <TableCell className="font-medium text-zinc-200">
                {signal.instrument}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs font-semibold uppercase",
                    signal.direction === "buy"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-red-500/30 bg-red-500/10 text-red-400",
                  )}
                >
                  {signal.direction}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-sm tabular-nums text-zinc-300">
                {signal.entry_price}
              </TableCell>
              <TableCell className="font-mono text-sm tabular-nums text-zinc-400">
                {signal.stop_loss}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs font-medium",
                    getStatusColor(signal.status),
                  )}
                >
                  {signal.status.replace("_", " ")}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <span className="text-xs text-zinc-500 group-hover:text-zinc-300">
                  View
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
