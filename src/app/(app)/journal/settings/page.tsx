import { redirect } from "next/navigation";

/** /journal/settings → /journal/settings/general by default */
export default function JournalSettingsIndex() {
  redirect("/journal/settings/general");
}
