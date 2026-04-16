import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    redirect("/login");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Try to get profile, gracefully handle if users table doesn't exist yet
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, email, full_name, avatar_url, role")
    .eq("id", user.id)
    .single();

  if (profileError) {
    console.error("[TRDR] Profile fetch error:", profileError.message);
  }

  const userProfile = profile ?? {
    id: user.id,
    email: user.email ?? "",
    full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url:
      user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    role: "user" as const,
  };

  return <AppShell profile={userProfile}>{children}</AppShell>;
}
