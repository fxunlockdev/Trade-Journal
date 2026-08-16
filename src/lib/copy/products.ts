/**
 * User-facing product and tier wording, in one place.
 *
 * Swapping a label (e.g. "IB" <-> "Affiliate") must be a one-file change with
 * zero schema impact — the database only ever stores the tier keys
 * (affiliate | ib | admin).
 */

export const TIER_LABELS = {
  /** Tenant of the CRM: manages a roster and earns commissions. */
  ib: "IB",
  /** A person on an IB's roster; uses the Trade Journal. */
  affiliate: "Affiliate",
  /** FXU staff. */
  admin: "Admin",
} as const;

export const PRODUCT_LABELS = {
  journal: "Trade Journal",
  crm: "Affiliate CRM",
  admin: "Platform Admin",
} as const;

export type LockedProductKey = "crm" | "admin";

interface LockedCopy {
  readonly title: string;
  readonly description: string;
  readonly howToGetAccess: string;
}

export const PRODUCT_COPY: Readonly<
  Record<LockedProductKey | "default", LockedCopy>
> = {
  crm: {
    title: `${PRODUCT_LABELS.crm} isn't part of your plan`,
    description: `The ${PRODUCT_LABELS.crm} is where ${TIER_LABELS.ib}s manage their ${TIER_LABELS.affiliate} roster, track commissions and see who is actively trading.`,
    howToGetAccess: `Your account is set up for the ${PRODUCT_LABELS.journal}. If you partner with FXU as an ${TIER_LABELS.ib}, ask your FXU contact to upgrade your account — the CRM appears here the next time you sign in.`,
  },
  admin: {
    title: "Admin tools aren't available on your account",
    description: "Platform administration is limited to FXU staff.",
    howToGetAccess: "If you think this is a mistake, contact your FXU contact.",
  },
  default: {
    title: "This app isn't part of your plan",
    description: "Your account doesn't include access to this product yet.",
    howToGetAccess:
      "Ask your FXU contact if you need it — access appears here the next time you sign in.",
  },
};
