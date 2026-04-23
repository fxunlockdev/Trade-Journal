import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { InvitesPanel } from "@/components/journals/invites-panel";

export default async function InvitesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { journal, role } = await getActiveJournal(supabase, user.id);

  // Owner-only route. Non-owners hitting this URL directly get bounced back
  // to the settings index. (The layout's tab strip already hides the Invites
  // tab for them — this is defence-in-depth.)
  if (role !== "owner") {
    redirect("/journal/settings/general");
  }

  return <InvitesPanel journalId={journal.id} journalName={journal.name} />;
}
