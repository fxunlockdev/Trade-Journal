import type { Metadata } from "next";
import { Landing } from "./_home/Landing";

/**
 * The FXU Home landing — the public front door of the platform.
 *
 * Previously this route redirected straight to /login (the app had no marketing
 * face). It's now the public landing; the app lives at /dashboard and friends.
 * Middleware leaves "/" ungated, so signed-out visitors land here.
 */
export const metadata: Metadata = {
  title: "FXU · The toolkit for serious traders",
  description:
    "Journal every trade, size every risk, and grow every partnership. Trade Journal and Affiliate CRM, under one account.",
};

export default function HomePage() {
  return <Landing />;
}
