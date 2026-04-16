import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignalDetailClient } from "./signal-detail-client";
import type { Signal, SignalEvent } from "@/types/database";

interface SignalDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function SignalDetailPage({
  params,
}: SignalDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: signal, error } = await supabase
    .from("signals")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !signal) {
    notFound();
  }

  const { data: events } = await supabase
    .from("signal_events")
    .select("*")
    .eq("signal_id", id)
    .order("created_at", { ascending: true });

  return (
    <SignalDetailClient
      signal={signal as Signal}
      events={(events ?? []) as SignalEvent[]}
    />
  );
}
