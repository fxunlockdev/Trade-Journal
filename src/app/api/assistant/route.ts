import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/auth/entitlements";
import { matchKnowledge } from "@/lib/assistant/knowledge";
import { parseMention } from "@/lib/assistant/mentions";
import { getOpenAIClient, OPENAI_MODEL } from "@/lib/openai/client";
import { allowRequest, clientIp, maybePrune, LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/assistant  { message }
 *
 * The FXU Home assistant. Answers are resolved in strict cost order:
 *
 *   1. @mention        -> route to an app (0 tokens)
 *   2. knowledge base  -> curated product answers (0 tokens)
 *   3. shared DB cache -> a previous answer to the same question (0 tokens)
 *   4. OpenAI          -> only a genuinely new question, then cached
 *
 * Step 4 is limited to signed-in users. A public, unmetered model endpoint on a
 * marketing page is an open invitation to run up a bill; visitors still get the
 * whole knowledge base and the cache, which is what they actually ask for.
 */

const MAX_MESSAGE_CHARS = 500;

/** Product answers only — never user data — which is what makes the cache shareable. */
const SYSTEM_PROMPT = `You are the assistant on FXU Home, a platform with two apps:
- Trade Journal: trade logging, analytics (P&L, win rate, profit factor, drawdown), MT4/MT5 statement import, AI trade entry. Free with any account.
- Affiliate CRM: for introducing brokers. Affiliate roster, monthly commission ledger, partner activity tracking. Invite-only (IB tier).
There is also a free Rebate Calculator that estimates an IB's monthly rebate, and Live Education sessions.

Rules:
- Answer in 2-4 sentences, plainly. No preamble.
- Only answer questions about FXU, its apps, trading workflow or getting access.
- If asked something unrelated, say you only cover FXU and suggest what you can help with.
- NEVER give financial advice, price predictions, or any profit guarantee.
- Never claim a feature exists that isn't listed above.`;

function hashQuestion(q: string): string {
  return createHash("sha256").update(q.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      return NextResponse.json({ error: "Ask me something about FXU." }, { status: 400 });
    }
    const message = body.message.trim().slice(0, MAX_MESSAGE_CHARS);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // ── 1. @mention: route to an app ──────────────────────────────
    const mention = parseMention(message);
    if (mention) {
      const { target, instruction } = mention;

      if (!user) {
        return NextResponse.json({
          source: "mention",
          answer: `**${target.label}**: ${target.hint}. Sign in first and I'll take you straight there.`,
          action: { kind: "signin", href: `/login?next=${encodeURIComponent(target.href)}` },
        });
      }

      if (target.product) {
        const entitlements = await getEntitlements();
        if (!entitlements?.products.includes(target.product)) {
          return NextResponse.json({
            source: "mention",
            answer:
              target.product === "crm"
                ? `**${target.label}** is part of IB access, which is invite-only. Ask an FXU admin for an invite and it'll appear here.`
                : `You don't have access to **${target.label}** yet.`,
          });
        }
      }

      // The journal's own AI chat already turns plain English into a draft
      // trade, so forward the instruction there rather than reimplementing it.
      const href =
        instruction && target.actionHref
          ? `${target.actionHref}?q=${encodeURIComponent(instruction)}`
          : target.href;

      return NextResponse.json({
        source: "mention",
        answer: instruction
          ? `Opening **${target.label}** with: “${instruction}”.`
          : `Opening **${target.label}**: ${target.hint}.`,
        action: { kind: "open", href, label: `Open ${target.label}` },
      });
    }

    // ── 2. curated knowledge base (0 tokens) ──────────────────────
    const known = matchKnowledge(message);
    if (known) {
      return NextResponse.json({
        source: "knowledge",
        answer: known.answer,
        suggestions: known.suggestions ?? [],
      });
    }

    // ── 3. shared answer cache (0 tokens) ─────────────────────────
    const hash = hashQuestion(message);
    const { data: cached } = await supabase.rpc("ai_cache_get", { p_hash: hash });
    if (typeof cached === "string" && cached.length > 0) {
      return NextResponse.json({ source: "cache", answer: cached });
    }

    // ── 4. the model — signed-in only ─────────────────────────────
    if (!user) {
      return NextResponse.json({
        source: "gated",
        answer:
          "I can answer that in more depth once you're signed in. It's free, and it also unlocks the Trade Journal. In the meantime, ask me what the suite does, how access levels work, or about the rebate calculator.",
        action: { kind: "signin", href: "/login" },
      });
    }

    // Only the model path is metered — the KB and cache above are free, so a
    // curious visitor never hits this. Keyed to the account when we have one so
    // shared office IPs don't throttle each other.
    if (!(await allowRequest(supabase, LIMITS.assistant, user.id || clientIp(request)))) {
      return NextResponse.json(
        { error: "You're asking faster than I can think. Give me a minute." },
        { status: 429 },
      );
    }
    void maybePrune(supabase);

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      // Short answers keep both latency and spend down.
      max_completion_tokens: 220,
    });

    const answer = completion.choices[0]?.message?.content?.trim();
    if (!answer) {
      return NextResponse.json(
        { error: "I couldn't answer that one. Try rephrasing?" },
        { status: 502 },
      );
    }

    // Cache so the next person asking this costs nothing.
    await supabase.rpc("ai_cache_put", {
      p_hash: hash,
      p_question: message,
      p_answer: answer,
      p_model: OPENAI_MODEL,
    });

    return NextResponse.json({ source: "model", answer });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Try again in a moment." },
      { status: 500 },
    );
  }
}
