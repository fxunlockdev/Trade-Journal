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

  // Fetch user profile to check onboarding status
  const { data: profile } = await supabase
    .from("users")
    .select("id, full_name, has_onboarded")
    .eq("id", user.id)
    .single();

  const hasOnboarded = profile?.has_onboarded ?? false;
  const userName = profile?.full_name ?? undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <h1 className="text-lg font-semibold text-foreground">AI Trade Chat</h1>
        <p className="text-xs text-muted-foreground">
          Describe your trades in natural language and I will log them for you
        </p>
      </div>
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
