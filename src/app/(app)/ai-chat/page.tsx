import { createClient } from "@/lib/supabase/server";
import { TradeChat } from "@/components/chat/trade-chat";

export const metadata = {
  title: "AI Trade Chat | TRDR",
};

export default async function AiChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, full_name, has_onboarded")
    .eq("id", user.id)
    .single();

  const hasOnboarded = profile?.has_onboarded ?? false;
  const userName = profile?.full_name ?? undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <h1 className="text-base font-semibold text-foreground">AI Trade Chat</h1>
        <p className="text-xs text-muted-foreground">
          Describe your trades in plain English and I&apos;ll log them instantly
        </p>
      </div>

      {/* Chat fills remaining height */}
      <div className="flex-1 overflow-hidden">
        <TradeChat
          userId={user.id}
          userName={userName}
          isFirstTime={!hasOnboarded}
        />
      </div>
    </div>
  );
}
