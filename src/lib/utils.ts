import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Money formatting. `currency` defaults to USD — the denomination the P&L
 * pipeline converts into — so passing nothing keeps historical behaviour.
 * Pass a journal's `account_currency` when the figure is an account-level one
 * (capital, balance) that the user entered in their own currency.
 */
export function formatCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "MMM dd, yyyy");
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "MMM dd, yyyy HH:mm");
}

/**
 * Format a risk:reward ratio dropping unnecessary trailing zeros.
 * 3     → "1:3"
 * 3.5   → "1:3.5"
 * 2.75  → "1:2.75"
 * Rounds to 2 dp first to kill float noise (1.9999... → 2).
 */
export function formatRR(ratio: number): string {
  const rounded = Math.round(ratio * 100) / 100;
  return `1:${rounded}`;
}
