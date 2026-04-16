import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type UserRole = "user" | "trader" | "admin";

const VALID_ROLES: readonly UserRole[] = ["user", "trader", "admin"];

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
}

interface TradeRow {
  user_id: string;
}

interface UserWithTradeCount extends UserRow {
  trade_count: number;
}

async function getCallerAsAdmin(): Promise<
  | { callerId: string }
  | { error: string; status: 401 | 403 }
> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized", status: 401 };
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return { error: "Unauthorized", status: 401 };
  }

  if ((profile as { role: string }).role !== "admin") {
    return { error: "Forbidden", status: 403 };
  }

  return { callerId: user.id };
}

export async function GET(): Promise<NextResponse> {
  try {
    const callerResult = await getCallerAsAdmin();

    if ("error" in callerResult) {
      return NextResponse.json(
        { error: callerResult.error },
        { status: callerResult.status },
      );
    }

    const adminClient = createAdminClient();

    const { data: users, error: usersError } = await adminClient
      .from("users")
      .select("id, email, full_name, role, created_at");

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    const { data: trades, error: tradesError } = await adminClient
      .from("trades")
      .select("user_id");

    if (tradesError) {
      return NextResponse.json(
        { error: tradesError.message },
        { status: 500 },
      );
    }

    const tradeCountMap = ((trades ?? []) as TradeRow[]).reduce<
      Record<string, number>
    >((acc, trade) => {
      const count = acc[trade.user_id] ?? 0;
      return { ...acc, [trade.user_id]: count + 1 };
    }, {});

    const usersWithCounts: UserWithTradeCount[] = (
      (users ?? []) as UserRow[]
    ).map((user) => ({
      ...user,
      trade_count: tradeCountMap[user.id] ?? 0,
    }));

    return NextResponse.json({ data: usersWithCounts });
  } catch (_err) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { userId?: unknown; role?: unknown };
    const { userId, role } = body;

    if (typeof userId !== "string" || !userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 },
      );
    }

    if (!VALID_ROLES.includes(role as UserRole)) {
      return NextResponse.json(
        { error: `role must be one of: ${VALID_ROLES.join(", ")}` },
        { status: 400 },
      );
    }

    const validRole = role as UserRole;

    const callerResult = await getCallerAsAdmin();

    if ("error" in callerResult) {
      return NextResponse.json(
        { error: callerResult.error },
        { status: callerResult.status },
      );
    }

    const { callerId } = callerResult;

    if (userId === callerId && validRole !== "admin") {
      return NextResponse.json(
        { error: "Cannot demote yourself from admin" },
        { status: 400 },
      );
    }

    const adminClient = createAdminClient();

    const { error: updateError } = await adminClient
      .from("users")
      .update({ role: validRole })
      .eq("id", userId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (_err) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
