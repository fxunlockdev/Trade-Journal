import { notFound } from "next/navigation";
import { TourHarnessClient } from "@/components/tour/tour-harness-client";

/**
 * Tour harness — DEVELOPMENT ONLY.
 *
 * The tour spotlights real app chrome and only auto-runs for a brand-new
 * account, so neither the visual check nor the E2E can reach it through the
 * normal path without a session and a fresh user. This route renders stand-in
 * anchors with the same `data-tour` names and drives the real overlay against
 * them.
 *
 * `notFound()` in production keeps it out of the shipped app.
 */
export const dynamic = "force-dynamic";

export default function TourHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TourHarnessClient />;
}
