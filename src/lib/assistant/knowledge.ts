/**
 * The assistant's curated knowledge base.
 *
 * Tier 1 of the cost ladder: these answers cost ZERO tokens. They cover the
 * questions visitors actually ask — what FXU is, what each app does, who gets
 * what, how to get access, what the rebate calculator is for. Only a genuinely
 * novel question falls through to the cache, and then to the model.
 *
 * Keep answers short, factual and free of financial promises.
 */

export interface KnowledgeEntry {
  /** Lowercase keywords; a question matches when enough of them appear. */
  readonly keywords: readonly string[];
  readonly answer: string;
  /** Optional follow-up chips shown under the answer. */
  readonly suggestions?: readonly string[];
}

export const KNOWLEDGE: readonly KnowledgeEntry[] = [
  {
    keywords: ["what", "fxu", "suite", "platform", "do for me", "about"],
    answer:
      "FXU is one account for two working tools. **Trade Journal** logs every trade and turns your own history into feedback — P&L, win rate, profit factor, drawdown, and AI insights on your patterns. **Affiliate CRM** is for introducing brokers: track partners from lead to active, log commissions monthly, and see who's actually trading. You sign in once here and open whichever you have access to.",
    suggestions: ["What can the Trade Journal do?", "What is the Affiliate CRM?", "How do I get access?"],
  },
  {
    keywords: ["trade journal", "journal", "log trades", "journaling", "track trades"],
    answer:
      "The **Trade Journal** is where you log positions and let the patterns surface. You get P&L, win rate, profit factor and max drawdown; filters by date range, direction and asset; multi-take-profit tracking; a built-in risk and lot calculator; imports from MT5 and Myfxbook; and an AI chat that can log a trade from plain English. Every journal is private to you unless you explicitly invite someone.",
    suggestions: ["How do I add a trade?", "Can I import from MT5?", "How do I get access?"],
  },
  {
    keywords: ["crm", "affiliate crm", "partners", "commission", "ib tool", "introducing broker"],
    answer:
      "The **Affiliate CRM** is built for introducing brokers. Keep a roster of affiliates with status, terms and joining dates; log commissions month by month as pending, paid or cancelled; and see live dashboards for monthly commission and top affiliates. You can also invite an affiliate into the Trade Journal and see whether they're actually active — activity counts only, never their trades.",
    suggestions: ["How do I become an IB?", "What is the rebate calculator?"],
  },
  {
    keywords: ["access", "tier", "level", "ib", "affiliate", "permission", "unlock", "become"],
    answer:
      "There are two levels. **Affiliate** is what everyone gets on sign-up — full Trade Journal, free. **IB** adds the Affiliate CRM on top, and it's invite-only: an FXU admin sends you a link. If you're already signed in, whatever you have access to appears under *Explore the apps*; anything you don't is shown locked with how to get it.",
    suggestions: ["What is the Affiliate CRM?", "What is the rebate calculator?"],
  },
  {
    keywords: ["rebate", "calculator", "how much", "earn", "rebate calculator"],
    answer:
      "The **Rebate Calculator** estimates what your monthly volume could be worth as an introducing broker. Pick the asset class your clients trade, enter monthly volume in lots, and it shows an estimated monthly and annual rebate range. It's free — leave your name, email and phone to unlock the full breakdown and we'll follow up with real terms.",
    suggestions: ["Open the rebate calculator", "How do I become an IB?"],
  },
  {
    keywords: ["add trade", "log a trade", "record trade", "enter trade", "how do i add"],
    answer:
      "Two ways. In the Trade Journal, use the trade form for full control over entries, stops and multiple take-profits. Or just describe it in plain English to the journal's AI chat — \"bought EURUSD at 1.0842, stop 1.0800, target 1.0920, 2 lots\" — and it drafts the entry for you to confirm. Nothing is saved until you approve it.",
    suggestions: ["Open Trade Journal", "Can I import from MT5?"],
  },
  {
    keywords: ["mt5", "import", "myfxbook", "sync", "csv", "metatrader"],
    answer:
      "Yes. The Trade Journal syncs from **MT5** and **Myfxbook**, and accepts CSV imports. Myfxbook credentials are encrypted before they're stored, and imported trades are de-duplicated so a re-sync never doubles your history.",
    suggestions: ["What can the Trade Journal do?", "Open Trade Journal"],
  },
  {
    keywords: ["price", "pricing", "cost", "free", "how much does", "subscription"],
    answer:
      "The Trade Journal is free with your FXU account. The Affiliate CRM comes with IB access, which is granted by invitation rather than sold — it's part of the partnership. The Rebate Calculator is free to use.",
    suggestions: ["How do I get access?", "What is the rebate calculator?"],
  },
  {
    keywords: ["education", "learn", "course", "session", "webinar", "training"],
    answer:
      "**Live Education** runs practical sessions for FXU partner communities: reading structure and patterns, risk management and position sizing, trading psychology, and review/journaling habits. Live with Q&A, recorded afterwards, with workbooks and journal templates.",
    suggestions: ["What can the Trade Journal do?", "How do I get access?"],
  },
  {
    keywords: ["private", "security", "safe", "data", "see my trades", "privacy"],
    answer:
      "Your data is yours. Every table is protected at the database level, so one account can never read or change another's — even your IB sees only whether you're active (join date, last active, trade counts), never your trades, P&L or notes. Broker credentials are encrypted, and journals are private unless you invite someone yourself.",
    suggestions: ["What is the Affiliate CRM?", "How do I get access?"],
  },
];

/** Questions offered as starter chips in the hero. */
export const STARTER_QUESTIONS: readonly string[] = [
  "What can this suite do for me?",
  "What is the rebate calculator?",
  "How do I get IB access?",
];

/**
 * Score a question against the knowledge base. Returns the best entry when the
 * match is convincing enough, otherwise null (caller falls through to cache/AI).
 */
export function matchKnowledge(question: string): KnowledgeEntry | null {
  const q = question.toLowerCase().trim();
  if (q.length < 2) return null;

  let best: { entry: KnowledgeEntry; score: number } | null = null;

  for (const entry of KNOWLEDGE) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (q.includes(kw)) {
        // Longer keyword matches are far more meaningful than short ones
        // ("affiliate crm" should beat a stray "what").
        score += kw.length >= 6 ? 3 : 1;
      }
    }
    if (!best || score > best.score) best = { entry, score };
  }

  return best && best.score >= 3 ? best.entry : null;
}
