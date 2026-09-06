import { describe, expect, it } from "vitest";
import { reviewNotice } from "@/lib/telegram/notify";

/** The private note a room message kept for review turns into. */
describe("the private note about a message kept for review", () => {
  const base = { room: "GOLD - Chris", journal: "TTC GOLD | CHRIS", sender: "Chris", text: "🎯 TP 61000 HIT", reason: "no target at 61000", appUrl: "https://www.fx-apps.com" };

  it("says which room and journal, quotes the message, gives the reason and the way back", () => {
    const n = reviewNotice(base);
    expect(n).toContain("<b>GOLD - Chris</b> → TTC GOLD | CHRIS");
    expect(n).toContain("<i>Chris</i>: 🎯 TP 61000 HIT");
    expect(n).toContain("Why: no target at 61000");
    expect(n).toContain("https://www.fx-apps.com/posters");
  });

  it("escapes what people typed, so a stray angle bracket cannot break the message", () => {
    const n = reviewNotice({ ...base, sender: "<admin>", text: "SL <b>hit</b> & done", reason: "a & b" });
    expect(n).toContain("&lt;admin&gt;");
    expect(n).toContain("SL &lt;b&gt;hit&lt;/b&gt; &amp; done");
    expect(n).toContain("Why: a &amp; b");
  });

  it("keeps a long message short and works without a sender", () => {
    const n = reviewNotice({ ...base, sender: null, text: "x".repeat(600) });
    expect(n).not.toContain("<i>");
    expect(n).toContain("x".repeat(280) + "…");
    expect(n).not.toContain("x".repeat(281));
  });
});
