import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { JournalGeneralForm } from "@/components/journals/journal-general-form";

export default async function JournalGeneralSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { journal, role } = await getActiveJournal(supabase, user.id);

  return (
    <JournalGeneralForm
      journal={journal}
      canManage={role === "owner"}
    />
  );
}
