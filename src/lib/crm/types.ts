/**
 * Affiliate CRM domain types. Mirror the columns created in
 * supabase/migrations/20260816150000_crm_core.sql. The tenant is the IB
 * (owner_id); RLS guarantees a user only ever sees their own rows.
 */

export type AffiliateStatus = "LEAD" | "ONBOARDING" | "ACTIVE" | "INACTIVE";
export type CommissionStatus = "PENDING" | "PAID" | "CANCELLED";

export const AFFILIATE_STATUSES: readonly AffiliateStatus[] = [
  "LEAD",
  "ONBOARDING",
  "ACTIVE",
  "INACTIVE",
];

export const COMMISSION_STATUSES: readonly CommissionStatus[] = [
  "PENDING",
  "PAID",
  "CANCELLED",
];

export const COMMISSION_TYPES: readonly string[] = [
  "Revenue Share",
  "CPA",
  "Hybrid",
  "Fixed",
];

export interface Affiliate {
  readonly id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly country: string | null;
  readonly status: AffiliateStatus;
  readonly commission_type: string | null;
  readonly commission_rate: number | null;
  readonly join_date: string | null;
  readonly notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface Commission {
  readonly id: string;
  readonly owner_id: string;
  readonly affiliate_id: string;
  readonly month: number;
  readonly year: number;
  readonly amount: number;
  readonly status: CommissionStatus;
  readonly note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Fields a user supplies when creating/editing an affiliate. */
export type AffiliateInput = Pick<
  Affiliate,
  "name" | "email" | "phone" | "country" | "status" | "commission_type" | "commission_rate" | "join_date" | "notes"
>;

/** Fields a user supplies when logging a commission. */
export type CommissionInput = Pick<
  Commission,
  "affiliate_id" | "month" | "year" | "amount" | "status" | "note"
>;

export const MONTHS: readonly string[] = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}
