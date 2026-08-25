/**
 * Poster themes.
 *
 * Every value is a LITERAL colour, never a CSS variable. The app's palette
 * flips with the `.dark` class (globals.css), and a poster must rasterise
 * identically whatever theme the person generating it happens to be using —
 * a downloaded PNG that changes colour with a UI setting is a bug.
 *
 * Token names mirror the `d.t*` props in the supplied designs so the ported
 * templates stay diff-able against the originals.
 */

export interface PosterTheme {
  readonly id: string;
  readonly label: string;
  /** Base canvas colour. */
  readonly tBg: string;
  /** Primary and secondary type. */
  readonly tText: string;
  readonly tText2: string;
  readonly tMuted: string;
  readonly tFaint: string;
  /** Accent used for the period line and the stat highlights. */
  readonly tAccent: string;
  /** Ambient gradient washes. */
  readonly tGlow1: string;
  readonly tGlow2: string;
  readonly tBlush: string;
  readonly tStreak: string;
  /** Structure: borders, rules, grid lines, card fills. */
  readonly tFrame: string;
  readonly tFrameSoft: string;
  readonly tGridLine: string;
  readonly tChipBorder: string;
  readonly tCardFill: string;
  readonly tCardBg: string;
  readonly tRowLine: string;
  readonly tTopBar: string;
  /** Gradient applied to the hero numeral via background-clip. */
  readonly tNumGrad: string;
  /** Win / loss accents. */
  readonly win: string;
  readonly loss: string;
}

/** The look of the supplied designs: near-black with brushed gold. */
const OBSIDIAN_GOLD: PosterTheme = {
  id: "obsidian-gold",
  label: "Obsidian Gold",
  tBg: "#0A0B0A",
  tText: "#F5F1E8",
  tText2: "#BDB6A4",
  tMuted: "#8A8478",
  tFaint: "#5E594F",
  tAccent: "#D8B662",
  tGlow1: "rgba(169, 131, 47, 0.28)",
  tGlow2: "rgba(120, 92, 33, 0.20)",
  tBlush: "rgba(216, 182, 98, 0.08)",
  tStreak: "rgba(216, 182, 98, 0.05)",
  tFrame: "rgba(216, 182, 98, 0.22)",
  tFrameSoft: "rgba(216, 182, 98, 0.12)",
  tGridLine: "rgba(216, 182, 98, 0.04)",
  tChipBorder: "rgba(216, 182, 98, 0.35)",
  tCardFill: "rgba(255, 255, 255, 0.015)",
  tCardBg: "#0E0F0D",
  tRowLine: "rgba(216, 182, 98, 0.10)",
  tTopBar: "linear-gradient(90deg, #A9832F, #D8B662, #A9832F)",
  tNumGrad: "linear-gradient(135deg, #F0E2B8 0%, #D8B662 45%, #A9832F 100%)",
  win: "#9FE0AD",
  loss: "#FF897D",
};

/** The app's own brand: deep forest with lime. */
const FOREST_LIME: PosterTheme = {
  id: "forest-lime",
  label: "Forest Lime",
  tBg: "#060F0B",
  tText: "#F1F5EF",
  tText2: "#B3C4B8",
  tMuted: "#7E9186",
  tFaint: "#55655C",
  tAccent: "#C3F35C",
  tGlow1: "rgba(108, 158, 117, 0.28)",
  tGlow2: "rgba(15, 50, 24, 0.55)",
  tBlush: "rgba(195, 243, 92, 0.07)",
  tStreak: "rgba(195, 243, 92, 0.04)",
  tFrame: "rgba(195, 243, 92, 0.20)",
  tFrameSoft: "rgba(195, 243, 92, 0.10)",
  tGridLine: "rgba(195, 243, 92, 0.04)",
  tChipBorder: "rgba(195, 243, 92, 0.32)",
  tCardFill: "rgba(255, 255, 255, 0.02)",
  tCardBg: "#0A160F",
  tRowLine: "rgba(195, 243, 92, 0.10)",
  tTopBar: "linear-gradient(90deg, #6C9E75, #C3F35C, #6C9E75)",
  tNumGrad: "linear-gradient(135deg, #E4FBB4 0%, #C3F35C 45%, #A8D642 100%)",
  win: "#9FE0AD",
  loss: "#FF897D",
};

/** Light alternative for feeds that read better on white. */
const IVORY: PosterTheme = {
  id: "ivory",
  label: "Ivory",
  tBg: "#F7F5EF",
  tText: "#14150F",
  tText2: "#4A4C40",
  tMuted: "#7C7E70",
  tFaint: "#9B9D8F",
  tAccent: "#8A6A1F",
  tGlow1: "rgba(169, 131, 47, 0.14)",
  tGlow2: "rgba(169, 131, 47, 0.08)",
  tBlush: "rgba(169, 131, 47, 0.05)",
  tStreak: "rgba(169, 131, 47, 0.035)",
  tFrame: "rgba(20, 21, 15, 0.16)",
  tFrameSoft: "rgba(20, 21, 15, 0.08)",
  tGridLine: "rgba(20, 21, 15, 0.035)",
  tChipBorder: "rgba(20, 21, 15, 0.22)",
  tCardFill: "rgba(255, 255, 255, 0.55)",
  tCardBg: "#FFFDF7",
  tRowLine: "rgba(20, 21, 15, 0.08)",
  tTopBar: "linear-gradient(90deg, #A9832F, #D8B662, #A9832F)",
  tNumGrad: "linear-gradient(135deg, #A9832F 0%, #8A6A1F 55%, #5E4712 100%)",
  win: "#2E7D4F",
  loss: "#C0392B",
};

export const POSTER_THEMES: readonly PosterTheme[] = [
  OBSIDIAN_GOLD,
  FOREST_LIME,
  IVORY,
];

export const DEFAULT_THEME_ID = OBSIDIAN_GOLD.id;

export function getTheme(id: string): PosterTheme {
  return POSTER_THEMES.find((t) => t.id === id) ?? OBSIDIAN_GOLD;
}

/**
 * Standing disclaimer. Posters are marketing material for a leveraged product,
 * so the risk warning ships by default rather than being something a user has
 * to remember to add.
 */
export const POSTER_DISCLAIMER =
  "Past performance is not indicative of future results. Trading foreign exchange and CFDs carries a high level of risk and may not be suitable for all investors. Figures shown are the results of closed trades recorded in this journal and are provided for information only. Nothing here is financial advice.";
