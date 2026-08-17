import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntitlements } from "@/lib/auth/entitlements";
import { AdminUsers } from "./AdminUsers";
import { IbInvites } from "./IbInvites";
import "@/app/_home/fxu-home.css";

/**
 * /admin — the FXU Home control room.
 *
 * Middleware already 404s /admin for non-admins, but that is UX, not authority:
 * this re-checks entitlement against the database and calls notFound() for
 * anyone else, so the surface is never advertised or reachable by URL guessing.
 */
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const entitlements = await getEntitlements();
  if (!entitlements || !entitlements.products.includes("admin")) {
    notFound();
  }

  return (
    <div className="fxu-home admin-page">
      <div className="orbs" aria-hidden="true">
        <span className="orb o1" />
        <span className="orb o2" />
      </div>

      <div className="admin-inner">
        <Link href="/" className="admin-back">‹ FXU Home</Link>
        <h1 className="admin-title">Admin</h1>
        <p className="admin-sub">
          Invite IBs and manage who can reach what. Trade Journal is open to everyone who
          signs up; the Affiliate CRM is invite-only.
        </p>

        <IbInvites />
        <AdminUsers selfId={entitlements.userId} />
      </div>
    </div>
  );
}
