/**
 * `@mention` routing for the FXU assistant.
 *
 * Typing "@trade journal log EURUSD long 2 lots" targets an app directly. The
 * assistant resolves the app, checks the user is entitled to it, and hands off —
 * for the journal it forwards the request to the journal's own AI chat, which
 * already turns plain English into a draft trade the user confirms.
 *
 * Deliberately a router, not an executor: nothing here writes data. The target
 * app performs the action under its own auth, so entitlement and RLS still
 * decide what actually happens.
 */

import type { ProductKey } from "@/lib/auth/entitlements";

export interface AppTarget {
  readonly id: "journal" | "crm" | "risk" | "rebate";
  readonly label: string;
  /** Aliases users might type after "@". Longest match wins. */
  readonly aliases: readonly string[];
  /** Product needed to use it; null = open to everyone. */
  readonly product: ProductKey | null;
  readonly href: string;
  /** Where a natural-language instruction should be sent, if supported. */
  readonly actionHref?: string;
  readonly hint: string;
}

export const APP_TARGETS: readonly AppTarget[] = [
  {
    id: "journal",
    label: "Trade Journal",
    aliases: ["trade journal", "tradejournal", "journal", "tj"],
    product: "journal",
    href: "/dashboard",
    actionHref: "/ai-chat",
    hint: "Log a trade, or ask about your performance",
  },
  {
    id: "crm",
    label: "Affiliate CRM",
    aliases: ["affiliate crm", "affiliatecrm", "crm", "affiliates"],
    product: "crm",
    href: "/crm",
    hint: "Open your affiliate roster and commissions",
  },
  {
    id: "risk",
    label: "Risk Calculator",
    aliases: ["risk calculator", "riskcalculator", "risk calc", "risk", "lot calculator", "lot calc"],
    product: "journal",
    href: "/risk-calculator",
    hint: "Size a position from your account risk",
  },
  {
    id: "rebate",
    label: "Rebate Calculator",
    aliases: ["rebate calculator", "rebatecalculator", "rebate calc", "rebate"],
    product: null,
    href: "/rebate-calculator",
    hint: "Estimate your monthly rebate as an IB",
  },
];

export interface ParsedMention {
  readonly target: AppTarget;
  /** Whatever the user typed after the app name. */
  readonly instruction: string;
}

/**
 * Extract a leading `@app` mention. Aliases are matched longest-first so
 * "@trade journal" wins over "@journal".
 */
export function parseMention(input: string): ParsedMention | null {
  const text = input.trim();
  if (!text.startsWith("@")) return null;

  const body = text.slice(1);
  const lower = body.toLowerCase();

  const candidates = APP_TARGETS.flatMap((target) =>
    target.aliases.map((alias) => ({ target, alias })),
  ).sort((a, b) => b.alias.length - a.alias.length);

  for (const { target, alias } of candidates) {
    if (lower.startsWith(alias)) {
      return { target, instruction: body.slice(alias.length).trim() };
    }
  }
  return null;
}
