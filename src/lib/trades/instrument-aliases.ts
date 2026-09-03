/**
 * What people call instruments when they are not typing a broker symbol.
 *
 * "gold", "cable", "the nas": expanded to the catalogue symbol before any
 * parsing, so the strict grammar reads "bought gold at 3340" the same way it
 * reads "XAUUSD buy 3340". Deliberately conservative -- "gas", "es" and "ym"
 * are left out because they are ordinary words or too short to be safe.
 */

const ALIASES: readonly (readonly [RegExp, string])[] = [
  [/\bgold\b/gi, "XAUUSD"],
  [/\bsilver\b/gi, "XAGUSD"],
  [/\bplatinum\b/gi, "XPTUSD"],
  [/\b(?:oil|crude|wti|us\s?oil)\b/gi, "USOIL"],
  [/\bbrent\b/gi, "UKOIL"],
  [/\bnat\s?gas\b/gi, "NATGAS"],
  [/\b(?:nasdaq|nas\s?100|ustec|nas)\b/gi, "NAS100"],
  [/\b(?:dow|dji|us\s?30)\b/gi, "US30"],
  [/\b(?:spx|sp\s?500|s&p\s?500|s&p)\b/gi, "SPX500"],
  [/\b(?:dax|ger\s?30|ger\s?40|de\s?40)\b/gi, "GER40"],
  [/\b(?:ftse|uk\s?100)\b/gi, "UK100"],
  [/\b(?:nikkei|jpn\s?225)\b/gi, "JPN225"],
  // Not "btc"/"eth": those are the start of real symbols typed with a
  // separator ("BTC-USD", "BTC/USDT"), which the catalogue already reads.
  [/\bbitcoin\b/gi, "BTCUSD"],
  [/\bethereum\b/gi, "ETHUSD"],
  [/\bcable\b/gi, "GBPUSD"],
  [/\bfib(?:er|re)\b/gi, "EURUSD"],
  [/\baussie\b/gi, "AUDUSD"],
  [/\bkiwi\b/gi, "NZDUSD"],
  [/\bloonie\b/gi, "USDCAD"],
  [/\bswissy\b/gi, "USDCHF"],
];

/** The text with every alias replaced by its symbol. */
export function expandAliases(text: string): string {
  return ALIASES.reduce((t, [re, sym]) => t.replace(re, sym), text);
}

/** Whether the text names an instrument by alias (used to decide if prose is worth reading). */
export function mentionsAlias(text: string): boolean {
  return ALIASES.some(([re]) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}
