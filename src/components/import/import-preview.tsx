"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CreateTrade } from "@/types/database";
import { CheckCircle, AlertTriangle, Upload, X } from "lucide-react";

interface ParseError {
  readonly row: number;
  readonly message: string;
}

interface ImportPreviewProps {
  readonly trades: readonly CreateTrade[];
  readonly errors: readonly ParseError[];
  readonly onImport: () => void;
  readonly onCancel: () => void;
  readonly importing?: boolean;
}

export function ImportPreview({
  trades,
  errors,
  onImport,
  onCancel,
  importing = false,
}: ImportPreviewProps) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4">
        <Card className="flex-1 border-zinc-800 bg-zinc-950">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle className="h-5 w-5 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-zinc-200">
                {trades.length} valid trades
              </p>
              <p className="text-xs text-zinc-500">Ready to import</p>
            </div>
          </CardContent>
        </Card>

        {errors.length > 0 && (
          <Card className="flex-1 border-red-900/30 bg-zinc-950">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-300">
                  {errors.length} errors
                </p>
                <p className="text-xs text-zinc-500">Rows will be skipped</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Error list */}
      {errors.length > 0 && (
        <Card className="border-zinc-800 bg-zinc-950">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-400">
              Parse Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {errors.map((err, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className="border-red-900 text-red-400"
                  >
                    Row {err.row}
                  </Badge>
                  <span className="text-zinc-400">{err.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trade preview table */}
      {trades.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Instrument</TableHead>
                  <TableHead className="text-zinc-400">Direction</TableHead>
                  <TableHead className="text-right text-zinc-400">
                    Entry
                  </TableHead>
                  <TableHead className="text-right text-zinc-400">
                    Exit
                  </TableHead>
                  <TableHead className="text-right text-zinc-400">
                    Volume
                  </TableHead>
                  <TableHead className="text-zinc-400">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.slice(0, 50).map((trade, i) => (
                  <TableRow
                    key={i}
                    className="border-zinc-800/50 hover:bg-zinc-900/30"
                  >
                    <TableCell className="font-medium text-zinc-100">
                      {trade.instrument}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-semibold uppercase",
                          trade.direction === "buy"
                            ? "border-emerald-800 text-emerald-400"
                            : "border-red-800 text-red-400",
                        )}
                      >
                        {trade.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-zinc-200">
                      {trade.entry_price}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-zinc-400">
                      {trade.exit_price ?? "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-zinc-300">
                      {trade.quantity}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">
                      {trade.entry_time}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {trades.length > 50 && (
            <div className="border-t border-zinc-800 bg-zinc-900/30 px-4 py-2 text-xs text-zinc-500">
              Showing 50 of {trades.length} trades
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          onClick={onCancel}
          className="border-zinc-700 text-zinc-300"
        >
          <X className="mr-2 h-4 w-4" />
          Cancel
        </Button>
        <Button
          onClick={onImport}
          disabled={trades.length === 0 || importing}
          className="bg-emerald-600 text-white hover:bg-emerald-500"
        >
          <Upload className="mr-2 h-4 w-4" />
          {importing
            ? "Importing..."
            : `Import ${trades.length} Trade${trades.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}
