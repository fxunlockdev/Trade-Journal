import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { connectMyfxbookSchema } from "@/lib/validators/myfxbook";
import {
  credentialsKeyConfigured,
  encryptSecret,
} from "@/lib/crypto/secretbox";
import {
  MyfxbookApiError,
  myfxbookLoginAndGetAccounts,
  packSession,
} from "@/lib/myfxbook/client";
import { syncMyfxbookConnection } from "@/lib/myfxbook/sync";
import { canEditTrades, getActiveJournal } from "@/lib/journals/active-journal";
import type { MyfxbookConnection } from "@/types/database";

/**
 * Myfxbook connection management (cookie-authed, from Settings).
 *
 * POST is two-phase over one stateless endpoint:
 *   phase 1 (no myfxbook_account_id): live-validate the login against
 *     Myfxbook and return the user's account list — nothing is stored;
 *   phase 2 (with myfxbook_account_id): encrypt + store credentials, create
 *     the connection, and run the first sync inline so trades appear
 *     immediately.
 *
 * Login + first sync can take ~10s of Myfxbook round-trips (≥1.2s spacing).
 */
export const maxDuration = 60;

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

    if (!credentialsKeyConfigured()) {
      return NextResponse.json(
        { error: "Myfxbook sync isn't configured on the server (missing CREDENTIALS_ENCRYPTION_KEY)." },
        { status: 503 },
      );
    }

    const body: unknown = await request.json();
    const parsed = connectMyfxbookSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const input = parsed.data;

    // Same gate as trade creation — viewers can't feed trades into a journal.
    const { journal, role } = await getActiveJournal(
      supabase,
      user.id,
      input.journal_id,
    );
    if (journal.id !== input.journal_id || !canEditTrades(role)) {
      return NextResponse.json(
        { error: "You can't connect an account to this journal." },
        { status: 403 },
      );
    }

    // Live-validate the credentials + pull the account list, retrying past
    // Myfxbook's IP-bound "Invalid session" rejections on serverless egress.
    let session: string;
    let accounts;
    try {
      ({ session, accounts } = await myfxbookLoginAndGetAccounts(
        input.email,
        input.password,
      ));
    } catch (err: unknown) {
      if (err instanceof MyfxbookApiError) {
        if (err.kind === "invalid_credentials") {
          return NextResponse.json(
            { error: "Myfxbook rejected that email/password." },
            { status: 401 },
          );
        }
        if (err.kind === "login_locked") {
          return NextResponse.json(
            {
              error:
                "Myfxbook temporarily locked API logins for this account after repeated attempts. Wait ~30–60 minutes, then try ONCE — or use the report import below, which always works.",
              detail: err.message,
            },
            { status: 429 },
          );
        }
        if (err.kind === "rate_limited") {
          return NextResponse.json(
            {
              error:
                "Myfxbook's API request limit was hit (their free tier allows ~100 requests per day). It resets within 24h — try again later, or use the report import below, which doesn't use their API at all.",
              detail: err.message,
            },
            { status: 429 },
          );
        }
        // invalid_session after retries / api_error — include what Myfxbook
        // actually said so failures are diagnosable from the browser.
        return NextResponse.json(
          {
            error:
              "Couldn't reach Myfxbook reliably just now. Please try again in a minute — or use the report import below, which works instantly.",
            detail: `${err.kind}: ${err.message}`,
          },
          { status: 502 },
        );
      }
      throw err;
    }

    if (accounts.length === 0) {
      return NextResponse.json(
        {
          error:
            "No accounts found on this Myfxbook profile. Add your MT4/MT5 account on myfxbook.com first (Portfolio → Add Account).",
        },
        { status: 422 },
      );
    }

    // Phase 1: return the account list for the picker — store nothing.
    if (!input.myfxbook_account_id) {
      return NextResponse.json({
        data: {
          accounts: accounts.map((a) => ({
            id: String(a.id),
            account_login: String(a.accountId),
            name: a.name,
            broker: a.server?.name ?? a.broker ?? null,
            currency: a.currency ?? null,
            demo: Boolean(a.demo),
            last_update: a.lastUpdateDate ?? null,
          })),
        },
      });
    }

    // Phase 2: create the connection.
    const account = accounts.find(
      (a) => String(a.id) === input.myfxbook_account_id,
    );
    if (!account) {
      return NextResponse.json(
        { error: "That account isn't on this Myfxbook profile." },
        { status: 422 },
      );
    }

    const admin = createAdminClient();
    const { data: created, error } = await admin
      .from("myfxbook_connections")
      .insert({
        user_id: user.id,
        journal_id: journal.id,
        email_encrypted: encryptSecret(input.email),
        password_encrypted: encryptSecret(input.password),
        // Session + its Cloudflare affinity cookies persist together.
        session_token: packSession(session),
        myfxbook_account_id: String(account.id),
        account_name: account.name ?? String(account.accountId),
        broker: account.server?.name ?? account.broker ?? null,
        broker_utc_offset_minutes: input.broker_utc_offset_minutes,
      })
      .select("*")
      .single();

    if (error) {
      console.error("[myfxbook/connections POST] insert failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // First sync inline — the connect flow ends with trades already visible.
    const sync = await syncMyfxbookConnection(
      admin,
      created as MyfxbookConnection,
    );

    return NextResponse.json(
      {
        data: {
          id: created.id,
          journal_name: journal.name,
          account_name: created.account_name,
          broker: created.broker,
          first_sync: sync.ok
            ? { processed: sync.result?.processed ?? 0, skipped: sync.result?.skipped ?? 0 }
            : { error: sync.error },
        },
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("myfxbook_connections")
      .select(
        "id, journal_id, myfxbook_account_id, account_name, broker, broker_utc_offset_minutes, last_sync_at, last_error, revoked_at, created_at, journals(name, color)",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
