import { notFound } from "next/navigation";
import { getEntitlements } from "@/lib/auth/entitlements";
import { AdminUsers } from "./AdminUsers";

/**
 * /admin — platform administration.
 *
 * Middleware already rewrites /admin to 404 for non-admins, but that is UX, not
 * authority. This re-checks entitlement from the database and calls notFound()
 * for anyone who isn't an admin — the surface is never advertised.
 */
export default async function AdminPage() {
  const entitlements = await getEntitlements();
  if (!entitlements || !entitlements.products.includes("admin")) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Platform admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage member access across FXU Home. Role changes take effect immediately at the
          data layer and are audited.
        </p>
      </div>
      <AdminUsers selfId={entitlements.userId} />
    </div>
  );
}
