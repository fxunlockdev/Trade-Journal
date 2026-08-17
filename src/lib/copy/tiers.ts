import type { PlatformRole } from "@/lib/auth/entitlements";

/**
 * Every user-facing string for the access tiers lives here.
 *
 * Renaming a tier (e.g. swapping "IB" and "Affiliate", or introducing a new
 * label) is a one-file change with zero schema or logic impact — the database
 * enum values (affiliate | ib | admin) never change.
 */
export const TIER_LABEL: Record<PlatformRole, string> = {
  affiliate: "Affiliate",
  ib: "IB",
  admin: "Admin",
};

/** One-line explanation of what the tier unlocks. */
export const TIER_BLURB: Record<PlatformRole, string> = {
  affiliate: "Trade Journal access",
  ib: "Trade Journal + Affiliate CRM",
  admin: "Full platform access",
};
