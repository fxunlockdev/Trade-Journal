import { createClient } from "@/lib/supabase/server";

/**
 * Product entitlements — the server-side authority for "may this user open
 * this app?".
 *
 * Layering (highest authority last):
 *   1. UI/hub          — shows what you have. Convenience only.
 *   2. middleware      — cheap route gate from the JWT claim. UX only.
 *   3. THIS MODULE     — re-reads the database on every server check.
 *   4. RLS             — absolute; even a bug here returns no rows.
 *
 * Never authorize from the JWT claim alone: a token issued before a demotion
 * still carries the old role for the rest of its lifetime. `has_product()`
 * reads the live row, so a role change takes effect immediately.
 */

/** Products a tier can unlock. Mirrors public.products.key. */
export type ProductKey = "journal" | "crm" | "admin";

/** Sole authority for product access. Mirrors public.platform_role. */
export type PlatformRole = "affiliate" | "ib" | "admin";

/**
 * NOT to be confused with `users.role` (user|trader|admin), which is a
 * journal-internal capability flag ('trader' gates signal publishing).
 * Product access is always platform_role / hasProduct().
 */

export interface Entitlements {
  readonly userId: string;
  readonly platformRole: PlatformRole;
  readonly products: readonly ProductKey[];
}

/**
 * Entitlements for the signed-in user, read from the database.
 * Returns null when there is no valid session.
 */
export async function getEntitlements(): Promise<Entitlements | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const { data, error } = await supabase
    .from("users")
    .select("platform_role")
    .eq("id", user.id)
    .single<{ platform_role: PlatformRole }>();

  // Fail loud: a signed-in user with no readable profile row is a broken
  // state, not an anonymous visitor. Never fall back to a default tier.
  if (error || !data) {
    throw new Error(
      `[entitlements] no profile row for authenticated user ${user.id}`,
    );
  }

  const { data: rows, error: matrixError } = await supabase
    .from("role_products")
    .select("product_key")
    .eq("platform_role", data.platform_role);

  if (matrixError) {
    throw new Error(
      `[entitlements] matrix read failed: ${matrixError.message}`,
    );
  }

  return {
    userId: user.id,
    platformRole: data.platform_role,
    products: (rows ?? []).map(
      (r) => (r as { product_key: ProductKey }).product_key,
    ),
  };
}

/**
 * True when the signed-in user's tier grants `product`.
 * Authoritative — asks the database (public.has_product), never the token.
 */
export async function hasProduct(product: ProductKey): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return false;

  const { data, error } = await supabase.rpc("has_product", {
    p_user_id: user.id,
    p_product: product,
  });

  if (error) {
    throw new Error(`[entitlements] has_product failed: ${error.message}`);
  }

  return data === true;
}

/**
 * Guard for server actions and route handlers: throws unless the caller's
 * tier grants `product`. Use at the top of every /crm and /admin server
 * entry point — middleware is not authority (§3.3).
 */
export async function requireProduct(product: ProductKey): Promise<void> {
  if (!(await hasProduct(product))) {
    throw new Error(`[entitlements] forbidden: missing product '${product}'`);
  }
}
