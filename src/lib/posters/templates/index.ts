import { DesignA } from "@/lib/posters/templates/design-a";
import { DesignB } from "@/lib/posters/templates/design-b";
import { DesignC } from "@/lib/posters/templates/design-c";
import type { PosterProps } from "@/lib/posters/templates/types";

/**
 * Template registry.
 *
 * Templates are typed React components rather than DB rows: the compiler
 * guarantees every design renders every stat it claims to, and adding one is a
 * code change with no migration. `blurb` is what the picker shows.
 */
export interface PosterTemplate {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly Component: (props: PosterProps) => React.ReactElement;
}

export const POSTER_TEMPLATES: readonly PosterTemplate[] = [
  {
    id: "design-a",
    label: "Headline",
    blurb: "One huge pip count. Trades, wins and losses along the bottom.",
    Component: DesignA,
  },
  {
    id: "design-b",
    label: "Scorecard",
    blurb: "Pips beside a framed grid of trades, win/loss, win rate and R.",
    Component: DesignB,
  },
  {
    id: "design-c",
    label: "Trade Log",
    blurb: "Stat strip over a per-trade breakdown of the period.",
    Component: DesignC,
  },
];

export const DEFAULT_TEMPLATE_ID = "design-a";

export function getTemplate(id: string): PosterTemplate {
  return POSTER_TEMPLATES.find((t) => t.id === id) ?? POSTER_TEMPLATES[0];
}

export type { PosterProps };
