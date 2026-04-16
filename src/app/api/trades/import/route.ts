import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createTradeSchema } from "@/lib/validators/trade";
import { computeTradeFields } from "@/lib/trades/computations";
import Papa from "papaparse";

interface ImportError {
  readonly row: number;
  readonly message: string;
}

interface CsvRow {
  readonly [key: string]: string | undefined;
}

function normalizeColumnName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function mapCsvRowToTrade(
  row: CsvRow,
  userId: string,
): Record<string, unknown> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeColumnName(key)] = value;
  }

  return {
    user_id: userId,
    instrument: normalized.instrument ?? normalized.symbol ?? "",
    asset_type: normalized.asset_type ?? "forex",
    direction: normalized.direction ?? normalized.side ?? "buy",
    entry_price: normalized.entry_price ?? normalized.entry ?? "0",
    exit_price: normalized.exit_price ?? normalized.exit ?? null,
    quantity: normalized.quantity ?? normalized.volume ?? normalized.size ?? "1",
    lot_size: normalized.lot_size ?? normalized.lots ?? null,
    stop_loss: normalized.stop_loss ?? normalized.sl ?? null,
    take_profit: normalized.take_profit ?? normalized.tp ?? null,
    fees: normalized.fees ?? normalized.commission ?? "0",
    notes: normalized.notes ?? null,
    tags: normalized.tags ? normalized.tags.split(",").map((t) => t.trim()) : [],
    entry_time: normalized.entry_time ?? normalized.open_time ?? normalized.date ?? "",
    exit_time: normalized.exit_time ?? normalized.close_time ?? null,
    source: "csv" as const,
  };
}

const BATCH_SIZE = 10;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No CSV file provided" },
        { status: 400 },
      );
    }

    if (!file.name.endsWith(".csv")) {
      return NextResponse.json(
        { error: "File must be a CSV" },
        { status: 400 },
      );
    }

    const csvText = await file.text();
    const parsed = Papa.parse<CsvRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim(),
    });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return NextResponse.json(
        { error: "Failed to parse CSV", details: parsed.errors },
        { status: 400 },
      );
    }

    const errors: ImportError[] = [];
    const validTrades: ReturnType<typeof computeTradeFields>[] = [];

    for (let i = 0; i < parsed.data.length; i++) {
      const row = parsed.data[i];
      const mapped = mapCsvRowToTrade(row, user.id);
      const result = createTradeSchema.safeParse(mapped);

      if (!result.success) {
        const fieldErrors = result.error.flatten().fieldErrors;
        const messages = Object.entries(fieldErrors)
          .map(([field, msgs]) => `${field}: ${(msgs ?? []).join(", ")}`)
          .join("; ");
        errors.push({ row: i + 2, message: messages });
        continue;
      }

      const tradeData = {
        ...result.data,
        exit_price: result.data.exit_price ?? null,
        stop_loss: result.data.stop_loss ?? null,
        take_profit: result.data.take_profit ?? null,
      };
      validTrades.push(computeTradeFields(tradeData));
    }

    let imported = 0;

    for (let i = 0; i < validTrades.length; i += BATCH_SIZE) {
      const batch = validTrades.slice(i, i + BATCH_SIZE);
      const { error: insertError, data: inserted } = await supabase
        .from("trades")
        .insert(batch)
        .select();

      if (insertError) {
        for (let j = 0; j < batch.length; j++) {
          errors.push({
            row: i + j + 2,
            message: insertError.message,
          });
        }
      } else {
        imported += inserted?.length ?? 0;
      }
    }

    return NextResponse.json({
      data: { imported, errors },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
