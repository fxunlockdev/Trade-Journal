import { describe, expect, it } from "vitest";
import { splitJournals, type MembershipRow } from "@/lib/journals/split-journals";
import type { Journal } from "@/types/database";

const journal = (o: Partial<Journal> & { id: string; name: string }): Journal =>
  ({ color: "slate", sort_order: 0, created_at: "2026-01-01T00:00:00Z", is_archived: false, ...o }) as Journal;

describe("splitJournals", () => {
  it("keeps the working set and the archived ones apart, both in the app's order, roles attached", () => {
    const rows: MembershipRow[] = [
      { role: "owner", journals: journal({ id: "b", name: "TTC FOREX", sort_order: 2 }) },
      { role: "member", journals: journal({ id: "a", name: "Personal", sort_order: 1 }) },
      { role: "owner", journals: journal({ id: "z", name: "Old GOLD", sort_order: 0, is_archived: true }) },
      { role: "viewer", journals: journal({ id: "y", name: "Old BTC", sort_order: 5, is_archived: true }) },
      { role: "member", journals: null },
    ];
    const { journals, archived } = splitJournals(rows);
    expect(journals.map((j) => [j.name, j.my_role])).toEqual([["Personal", "member"], ["TTC FOREX", "owner"]]);
    expect(archived.map((j) => [j.name, j.my_role])).toEqual([["Old GOLD", "owner"], ["Old BTC", "viewer"]]);
  });

  it("breaks a sort tie by creation, oldest first", () => {
    const rows: MembershipRow[] = [
      { role: "owner", journals: journal({ id: "n", name: "Newer", created_at: "2026-03-01T00:00:00Z" }) },
      { role: "owner", journals: journal({ id: "o", name: "Older", created_at: "2026-02-01T00:00:00Z" }) },
    ];
    expect(splitJournals(rows).journals.map((j) => j.name)).toEqual(["Older", "Newer"]);
  });
});
