import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Signal } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import type { Signal as SignalType } from "@/types/database";

import { Button } from "@/components/ui/button";
import { SignalTable } from "@/components/signal/signal-table";

export default async function SignalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "trader" && profile.role !== "admin")) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Signal className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          Access Denied
        </h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          You need trader or admin privileges to access signals. Contact your
          administrator to upgrade your account.
        </p>
      </div>
    );
  }

  const isAdmin = profile.role === "admin";

  let query = supabase
    .from("signals")
    .select("*")
    .order("created_at", { ascending: false });

  if (!isAdmin) {
    query = query.eq("trader_id", user.id);
  }

  const { data: signals } = await query;

  return (
    <div className="space-y-6 p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Signals
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage your trade signals.
          </p>
        </div>
        <Link href="/signals/new">
          <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="size-4" />
            New Signal
          </Button>
        </Link>
      </div>

      <SignalTable signals={(signals as readonly SignalType[]) ?? []} />
    </div>
  );
}
