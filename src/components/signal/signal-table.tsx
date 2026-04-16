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
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <SignalIcon className="size-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900">
          No signals yet
        </h3>
        <p className="mt-1.5 max-w-sm text-sm text-slate-500">
          Create your first signal to start broadcasting trade ideas.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-200 hover:bg-transparent">
            <TableHead className="text-slate-500">Date</TableHead>
            <TableHead className="text-slate-500">Instrument</TableHead>
            <TableHead className="text-slate-500">Direction</TableHead>
            <TableHead className="text-slate-500">Entry</TableHead>
            <TableHead className="text-slate-500">SL</TableHead>
            <TableHead className="text-slate-500">Status</TableHead>
            <TableHead className="text-right text-slate-500">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signals.map((signal) => (
            <TableRow
              key={signal.id}
              className="cursor-pointer border-slate-200 transition-colors hover:bg-slate-50"
              onClick={() => router.push(`/signals/${signal.id}`)}
            >
              <TableCell className="text-sm tabular-nums text-slate-500">
                {formatDateTime(signal.created_at)}
              </TableCell>
              <TableCell className="font-medium text-slate-900">
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
              <TableCell className="font-mono text-sm tabular-nums text-slate-700">
                {signal.entry_price}
              </TableCell>
              <TableCell className="font-mono text-sm tabular-nums text-slate-500">
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
                <span className="text-xs text-slate-500 group-hover:text-slate-700">
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
