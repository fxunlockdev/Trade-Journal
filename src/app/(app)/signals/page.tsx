import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isTrader } from "@/lib/constants/roles";
import { SignalTable } from "@/components/signal/signal-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import type { Signal } from "@/types/database";
import { Plus, Radio } from "lucide-react";

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
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !isTrader(profile.role)) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-8 py-12 text-center">
          <Radio className="mx-auto h-10 w-10 text-zinc-600" />
          <h2 className="mt-4 text-lg font-semibold text-zinc-200">
            Trader Access Required
          </h2>
          <p className="mt-2 max-w-sm text-sm text-zinc-500">
            You need trader or admin privileges to access signals. Contact your
            administrator to upgrade your role.
          </p>
        </div>
      </div>
    );
  }

  const { data: signals } = await supabase
    .from("signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  const typedSignals = (signals ?? []) as Signal[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Signals</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Create and manage your trading signals
          </p>
        </div>
        <Link href="/signals/new">
          <Button className="bg-emerald-600 text-white hover:bg-emerald-500">
            <Plus className="mr-2 h-4 w-4" />
            New Signal
          </Button>
        </Link>
      </div>

      {typedSignals.length === 0 ? (
        <EmptyState
          icon={<Radio className="h-5 w-5" />}
          title="No signals yet"
          description="Create your first trading signal to get started."
          action={{
            label: "Create Signal",
            onClick: () => {
              // Client-side navigation handled by Link above
            },
          }}
        />
      ) : (
        <SignalTable signals={typedSignals} />
      )}
    </div>
  );
}
