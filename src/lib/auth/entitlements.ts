import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Product entitlements: the server-side authority for "may this user open this
 * app?".
 *
 * Layering (highest authority last):
 *   1. UI/hub          — shows what you have. Convenience only.
 *   2. proxy           — cheap route gate from the JWT claim. UX only.
 *   3. THIS MODULE     — reads the database.
 *   4. RLS             — absolute; even a bug here returns no rows.
 *
 * Never authorize from the JWT claim alone: a token issued before a demotion
 * still carries the old role for the rest of its lifetime.
 *
 * COST: rendering a page used to cost six Supabase round trips (the proxy, the
 * page, and this module each calling getUser, plus two table reads). Everything
 * here is wrapped in React `cache()`, which dedupes per request — so a layout, a
 * page and three server components asking "who is this?" cost ONE call. The
 * role→products matrix is static seed data, so it lives in code rather than
 * costing a query on every render.
 */

/** Products a tier can unlock. Mirrors public.products.key. */
export type ProductKey = "journal" | "crm" | "admin";

/** Sole authority for product access. Mirrors public.platform_role. */
export type PlatformRole = "affiliate" | "ib" | "admin";

/**
 * Mirrors the public.role_products seed (migration 20260816130000). Static
 * reference data, so reading it per request bought nothing but latency and a
 * billable call.
 *
 * If you add a tier, change it in BOTH places: the migration is what RLS and
 * has_product() read, this is what the UI reads. The i7 SQL test asserts the
 * two agree.
 */
export const ROLE_PRODUCTS: Readonly<Record<PlatformRole, readonly ProductKey[]>> = {
  affiliate: ["journal"],
  ib: ["journal", "crm"],
  admin: ["journal", "crm", "admin"],
};

/**
 * NOT to be confused with `users.role` (user|trader|admin), which is a
 * journal-internal capability flag ('trader' gates signal publishing).
 * Product access is always platform_role.
 */
export interface Entitlements {
  readonly userId: string;
  readonly platformRole: PlatformRole;
  readonly products: readonly ProductKey[];
}

/**
 * The signed-in user, deduped for the lifetime of one request.
 *
 * `getUser()` is a network call to Supabase Auth, not a cookie read, so calling
 * it from several components is several billable calls. cache() collapses them.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Entitlements for the signed-in user, read from the database. Returns null
 * when there is no valid session. Deduped per request.
 *
 * One query, not three: the user comes from the cached lookup and the product
 * list is derived from the static matrix above.
 */
export const getEntitlements = cache(async (): Promise<Entitlements | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("platform_role")
    .eq("id", user.id)
    .single<{ platform_role: PlatformRole }>();

  // Fail loud: a signed-in user with no readable profile row is a broken state,
  // not an anonymous visitor. Never fall back to a default tier.
  if (error || !data) {
    throw new Error(
      `[entitlements] no profile row for authenticated user ${user.id}`,
    );
  }

  return {
    userId: user.id,
    platformRole: data.platform_role,
    products: ROLE_PRODUCTS[data.platform_role] ?? [],
  };
});

/**
 * True when the signed-in user's tier grants `product`.
 *
 * Reads platform_role from the database (via the cached entitlements), which is
 * what makes a demotion take effect immediately rather than at token refresh.
 * It no longer calls the has_product RPC: that was a second round trip to
 * re-derive what getEntitlements already knows, and RLS still enforces the same
 * rule at the row level regardless.
 */
export async function hasProduct(product: ProductKey): Promise<boolean> {
  const entitlements = await getEntitlements().catch(() => null);
  return entitlements?.products.includes(product) ?? false;
}

/**
 * Guard for server actions and route handlers: throws unless the caller's tier
 * grants `product`. Use at the top of every /crm and /admin server entry point.
 */
export async function requireProduct(product: ProductKey): Promise<void> {
  if (!(await hasProduct(product))) {
    throw new Error(`[entitlements] forbidden: missing product '${product}'`);
  }
}
