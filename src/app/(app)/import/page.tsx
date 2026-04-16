"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CsvUpload } from "@/components/import/csv-upload";
import { ImportPreview } from "@/components/import/import-preview";
import { parseCSV } from "@/lib/trades/csv-parser";
import { useUser } from "@/hooks/use-user";
import type { CreateTrade } from "@/types/database";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  Webhook,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type ImportStep = "upload" | "preview" | "done";

interface ParseError {
  readonly row: number;
  readonly message: string;
}

interface ImportResult {
  readonly imported: number;
  readonly errors: number;
}

export default function ImportPage() {
  const { profile } = useUser();
  const [step, setStep] = useState<ImportStep>("upload");
  const [trades, setTrades] = useState<readonly CreateTrade[]>([]);
  const [parseErrors, setParseErrors] = useState<readonly ParseError[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [webhookCopied, setWebhookCopied] = useState(false);

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mt5`
      : "/api/mt5";

  const handleFileSelected = useCallback(
    async (file: File) => {
      const content = await file.text();
      const parsed = parseCSV(content);

      const tradesWithUser = parsed.trades.map((trade) => ({
        ...trade,
        user_id: profile?.id ?? "",
      }));

      setTrades(tradesWithUser);
      setParseErrors(parsed.errors as ParseError[]);
      setStep("preview");
    },
    [profile],
  );

  const handleImport = useCallback(async () => {
    if (trades.length === 0) return;

    setImporting(true);
    try {
      const response = await fetch("/api/trades/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trades }),
      });

      const data = await response.json();

      if (data.success) {
        setResult({
          imported: data.data?.imported ?? trades.length,
          errors: parseErrors.length,
        });
        setStep("done");
      }
    } catch {
      // Error handling via UI state
    } finally {
      setImporting(false);
    }
  }, [trades, parseErrors.length]);

  const handleCancel = useCallback(() => {
    setStep("upload");
    setTrades([]);
    setParseErrors([]);
  }, []);

  const handleReset = useCallback(() => {
    setStep("upload");
    setTrades([]);
    setParseErrors([]);
    setResult(null);
  }, []);

  const handleCopyWebhook = useCallback(() => {
    navigator.clipboard.writeText(webhookUrl);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 2000);
  }, [webhookUrl]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Import Trades</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Import trades from MT5 CSV exports or set up the MT5 webhook
        </p>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-3">
        {(["upload", "preview", "done"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                step === s
                  ? "bg-emerald-600 text-white"
                  : i < ["upload", "preview", "done"].indexOf(step)
                    ? "bg-emerald-600/20 text-emerald-400"
                    : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {i + 1}
            </div>
            <span className="text-sm text-zinc-400 capitalize">{s}</span>
            {i < 2 && <Separator className="w-8 bg-zinc-800" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === "upload" && (
        <CsvUpload onFileSelected={handleFileSelected} />
      )}

      {step === "preview" && (
        <ImportPreview
          trades={trades}
          errors={parseErrors}
          onImport={handleImport}
          onCancel={handleCancel}
          importing={importing}
        />
      )}

      {step === "done" && result && (
        <Card className="border-emerald-900/30 bg-zinc-950">
          <CardContent className="flex flex-col items-center py-12">
            <CheckCircle className="h-12 w-12 text-emerald-400" />
            <h2 className="mt-4 text-xl font-semibold text-zinc-100">
              Import Complete
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Successfully imported {result.imported} trade
              {result.imported !== 1 ? "s" : ""}
              {result.errors > 0 && ` (${result.errors} rows skipped)`}
            </p>
            <Button
              onClick={handleReset}
              variant="outline"
              className="mt-6 border-zinc-700 text-zinc-300"
            >
              <Upload className="mr-2 h-4 w-4" />
              Import More
            </Button>
          </CardContent>
        </Card>
      )}

      {/* MT5 Webhook Setup */}
      <Separator className="bg-zinc-800" />

      <Card className="border-zinc-800 bg-zinc-950">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-zinc-400" />
            <CardTitle className="text-base font-semibold text-zinc-100">
              MT5 Webhook (Automated)
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-400">
            Set up your MT5 Expert Advisor to automatically send trades to TRDR
            via webhook.
          </p>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500">
                Webhook URL
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-200">
                  {webhookUrl}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyWebhook}
                  className="border-zinc-700 text-zinc-300"
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  {webhookCopied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500">
                Authorization Header
              </label>
              <code className="block rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-400">
                Bearer {"<MT5_WEBHOOK_SECRET>"}
              </code>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500">
                Required Headers
              </label>
              <code className="block rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-400">
                x-user-id: {"<your-user-id>"}
              </code>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <p className="text-xs font-medium text-zinc-400">
                EA Configuration Steps:
              </p>
              <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-zinc-500">
                <li>
                  Open your MT5 Expert Advisor settings
                </li>
                <li>
                  Set the webhook URL to the URL above
                </li>
                <li>
                  Add the Authorization header with your MT5_WEBHOOK_SECRET
                </li>
                <li>
                  Add the x-user-id header with your user ID
                </li>
                <li>
                  Enable the EA on your charts
                </li>
              </ol>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <p className="text-xs font-medium text-zinc-400">
                Example Payload:
              </p>
              <pre className="mt-2 overflow-x-auto text-xs text-zinc-500">
{`{
  "secret": "<MT5_WEBHOOK_SECRET>",
  "trades": [
    {
      "instrument": "EURUSD",
      "type": "buy",
      "open_price": 1.08500,
      "close_price": 1.08700,
      "open_time": "2024-01-15 10:30:00",
      "close_time": "2024-01-15 14:45:00",
      "volume": 0.1,
      "commission": -0.70,
      "swap": 0,
      "profit": 20.00
    }
  ]
}`}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
