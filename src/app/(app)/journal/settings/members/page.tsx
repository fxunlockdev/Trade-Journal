import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { MembersList } from "@/components/journals/members-list";

export default async function MembersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { journal, role } = await getActiveJournal(supabase, user.id);

  return (
    <MembersList
      journalId={journal.id}
      currentUserId={user.id}
      currentUserRole={role}
    />
  );
}
