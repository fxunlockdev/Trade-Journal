import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mt5AuthErrorMessage, resolveMt5Connection } from "@/lib/mt5/auth";

/**
 * EA handshake. Called once from OnInit so the terminal log shows a human
 * confirmation ("Connected to journal: Personal") and bad tokens fail fast
 * before any trade data is sent. Pins account/broker on first contact via
 * optional query params (?account=…&server=…&broker=…).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = createAdminClient();
    const auth = await resolveMt5Connection(
      admin,
      request.headers.get("authorization"),
    );

    if (!auth.ok) {
      return NextResponse.json(
        { error: mt5AuthErrorMessage(auth.reason), reason: auth.reason },
        { status: auth.status },
      );
    }

    const { connection } = auth;

    const { data: journal } = await admin
      .from("journals")
      .select("name")
      .eq("id", connection.journal_id)
      .maybeSingle();

    // Account pinning: first ping records the account; a later mismatch is a
    // hard 409 so one leaked token can't merge two accounts into a journal.
    const login = request.nextUrl.searchParams.get("account");
    const server = request.nextUrl.searchParams.get("server") ?? "";
    const broker = request.nextUrl.searchParams.get("broker");
    if (login) {
      const accountKey = server ? `${server}:${login}` : login;
      if (connection.account_login && connection.account_login !== accountKey) {
        return NextResponse.json(
          {
            error: `This token is pinned to account ${connection.account_login}. Generate a separate token for ${accountKey}.`,
            reason: "account_mismatch",
          },
          { status: 409 },
        );
      }
      if (!connection.account_login) {
        await admin
          .from("mt5_connections")
          .update({
            account_login: accountKey,
            broker: connection.broker ?? broker ?? null,
          })
          .eq("id", connection.id);
      }
    }

    return NextResponse.json({
      data: {
        journal: journal?.name ?? "journal",
        label: connection.label,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
