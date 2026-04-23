import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityFeed } from "@/components/journals/activity-feed";

export default async function ActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { journal } = await getActiveJournal(supabase, user.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ActivityFeed
          endpoint={`/api/journals/${journal.id}/activity?limit=100`}
          emptyLabel="No activity yet. Log a trade to see who did what here."
        />
      </CardContent>
    </Card>
  );
}
