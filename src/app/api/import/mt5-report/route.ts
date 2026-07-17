import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditTrades, getActiveJournal } from "@/lib/journals/active-journal";
import {
  parseTradeReport,
  ReportParseError,
  type ParsedReport,
} from "@/lib/import/mt5-report";
import { parsePdfReport } from "@/lib/import/pdf-report";
import { parseXlsxReport } from "@/lib/import/xlsx-report";
import { decodeReportText, sniffFileKind } from "@/lib/import/decode-text";
import { processEvents } from "@/lib/mt5/ingest-db";

/**
 * Manual MT4/MT5 report import (multipart form):
 *   file          – the report (XLSX, HTML or PDF)
 *   journal_id    – target journal
 *   utc_offset    – broker timezone offset in MINUTES (report times are broker-local)
 *   mode          – "preview" (parse + dedupe check, writes nothing) | "commit"
 *
 * Commit runs through the shared idempotent ingest with real position tickets
 * (`accountKey = statement:{login}`), so re-uploading the same report — or a
 * wider date range that overlaps — can never duplicate trades.
 */
export const maxDuration = 60;

const MAX_FILE_BYTES = 5 * 1024 * 1024; // MT5 reports are typically <1MB
const MAX_TRADES_PER_IMPORT = 1000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    const journalId = String(form.get("journal_id") ?? "");
    const mode = String(form.get("mode") ?? "preview");
    const utcOffset = Number(form.get("utc_offset") ?? 0);

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "File too large (max 5 MB)." },
        { status: 413 },
      );
    }
    if (!journalId) {
      return NextResponse.json({ error: "journal_id is required." }, { status: 400 });
    }
    if (!Number.isFinite(utcOffset) || utcOffset < -720 || utcOffset > 840) {
      return NextResponse.json({ error: "Invalid UTC offset." }, { status: 400 });
    }
    if (mode !== "preview" && mode !== "commit") {
      return NextResponse.json({ error: "Invalid mode." }, { status: 400 });
    }

    // Same gate as trade creation.
    const { journal, role } = await getActiveJournal(supabase, user.id, journalId);
    if (journal.id !== journalId || !canEditTrades(role)) {
      return NextResponse.json(
        { error: "You can't import trades into this journal." },
        { status: 403 },
      );
    }

    // Dispatch on MAGIC BYTES, never the filename/mime — MetaTrader and its
    // white-labels mislabel exports (HTML served as .xls, xlsx as .zip, and
    // browsers send an empty mime for unknown extensions).
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffFileKind(bytes);

    let parsed: ParsedReport;
    try {
      if (kind === "pdf") {
        parsed = await parsePdfReport(bytes, utcOffset);
      } else if (kind === "zip") {
        parsed = parseXlsxReport(bytes, utcOffset);
      } else if (kind === "ole2") {
        // Legacy BIFF .xls (Excel 97-2003) — a completely different container.
        return NextResponse.json(
          {
            error:
              "That's a legacy Excel file (.xls). Open it in Excel and 'Save As' .xlsx, or re-export from MT5 (History → right-click → Report → XLSX), then upload again.",
            reason: "not_a_report",
          },
          { status: 422 },
        );
      } else {
        // HTML/text — decoded BOM-aware because MT5 writes UTF-16.
        parsed = parseTradeReport(decodeReportText(bytes), utcOffset);
      }
    } catch (err: unknown) {
      if (err instanceof ReportParseError) {
        return NextResponse.json(
          { error: err.message, reason: err.reason },
          { status: 422 },
        );
      }
      throw err;
    }

    if (parsed.events.length > MAX_TRADES_PER_IMPORT) {
      return NextResponse.json(
        {
          error: `Report contains ${parsed.events.length} trades — the limit per import is ${MAX_TRADES_PER_IMPORT}. Export a shorter period.`,
        },
        { status: 413 },
      );
    }

    const accountKey = `statement:${parsed.accountLogin ?? "unknown"}`;
    const admin = createAdminClient();

    // Dedupe check (used by both modes — preview shows it, commit relies on
    // the unique index anyway; this is for the response counts).
    const tickets = parsed.events.map((e) => e.ticket);
    const { data: existingRows } = await admin
      .from("trades")
      .select("mt5_ticket")
      .eq("journal_id", journal.id)
      .eq("mt5_account", accountKey)
      .in("mt5_ticket", tickets);
    const existing = new Set(
      (existingRows ?? []).map((r) => Number(r.mt5_ticket)),
    );

    const preview = parsed.events.map((e) => ({
      ticket: e.ticket,
      symbol: e.symbol,
      direction: e.direction,
      volume: e.volume,
      entry_price: e.entry_price,
      exit_price: e.exit_price ?? null,
      open_time: e.open_time,
      close_time: e.close_time ?? null,
      profit:
        (e.profit ?? 0) + (e.commission ?? 0) + (e.swap ?? 0),
      status: existing.has(e.ticket) ? ("duplicate" as const) : ("new" as const),
    }));

    if (mode === "preview") {
      return NextResponse.json({
        data: {
          platform: parsed.platform,
          account_login: parsed.accountLogin,
          journal_name: journal.name,
          total: preview.length,
          new_count: preview.filter((p) => p.status === "new").length,
          duplicate_count: preview.filter((p) => p.status === "duplicate").length,
          skipped_rows: parsed.skippedRows,
          warnings: parsed.warnings.slice(0, 10),
          trades: preview,
        },
      });
    }

    // Commit — idempotent ingest; duplicates converge, never double.
    const result = await processEvents(
      admin,
      {
        journalId: journal.id,
        userId: user.id,
        accountKey,
        source: "csv",
      },
      parsed.events,
    );

    return NextResponse.json({
      data: {
        platform: parsed.platform,
        imported: result.processed,
        skipped: result.skipped,
        errors: result.errors,
        duplicates_merged: preview.filter((p) => p.status === "duplicate").length,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
