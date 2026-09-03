/**
 * The admin-client implementation of the two store interfaces the DM and tap
 * handlers are written against. Thin on purpose: every query here is a
 * one-liner, and every decision lives in the handlers where it is tested.
 */

import { randomBytes } from "node:crypto";
import { canEditTrades } from "@/lib/journals/active-journal";
import { allowRequest, LIMITS } from "@/lib/rate-limit";
import { PENDING_ID_BYTES } from "@/lib/telegram/commands";
import { type Admin, editableJournals, lastSize, linkedUser } from "@/lib/telegram/accounts";
import type { TradeDmStore } from "@/lib/telegram/trade-dm";
import type { TradeAnswerStore } from "@/lib/telegram/trade-answer";
import type { OpenDraft, FlowStore } from "@/lib/telegram/trade-flow";
import type { Conversation } from "@/lib/telegram/conversation";
import type { PendingTrade, TradeTapStore } from "@/lib/telegram/trade-tap";
import type { TradeDraft } from "@/lib/telegram/trade-intent";
import type { JournalRole } from "@/types/database";

const OPEN_COLUMNS =
  "id, telegram_user_id, user_id, chat_id, draft, journal_ids, expires_at, consumed_at, trade_id, conversation";

type OpenRow = {
  id: string; telegram_user_id: number | string; user_id: string; chat_id: string;
  draft: TradeDraft; journal_ids: string[] | null; expires_at: string;
  consumed_at: string | null; trade_id: string | null; conversation: Conversation | null;
};

function toOpen(r: OpenRow): OpenDraft & { consumedAt: string | null; tradeId: string | null } {
  return {
    id: r.id,
    telegramUserId: Number(r.telegram_user_id),
    userId: r.user_id,
    chatId: r.chat_id,
    draft: r.draft,
    journalIds: r.journal_ids ?? [],
    expiresAt: r.expires_at,
    consumedAt: r.consumed_at ?? null,
    tradeId: r.trade_id ?? null,
    conversation:
      r.conversation && typeof r.conversation === "object"
        ? { ...r.conversation, answers: r.conversation.answers ?? {} }
        : { answers: {} },
  };
}

function flowStore(admin: Admin): FlowStore {
  return {
    editableJournals: (userId) => editableJournals(admin, userId),
    saveConversation: async (id, patch, expiresAt) => {
      // Merged and life-extended in one statement on the database side.
      const { data, error } = await admin.rpc("touch_pending_conversation", {
        p_id: id,
        p_patch: patch,
        p_expires_at: expiresAt,
      });
      if (error) {
        console.error("[telegram/trade] conversation write failed", { id, message: error.message });
        return false;
      }
      return data === true;
    },
    recentLots: async (userId, instrument) => {
      const { data } = await admin
        .from("trades")
        .select("lot_size")
        .eq("user_id", userId)
        .eq("instrument", instrument)
        .not("lot_size", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);
      const seen = new Set<number>();
      for (const r of data ?? []) {
        const l = r.lot_size;
        if (typeof l === "number" && l > 0) seen.add(l);
      }
      return [...seen].slice(0, 3);
    },
    topTags: async (userId) => {
      const { data } = await admin.rpc("telegram_top_tags", { p_user_id: userId });
      return ((data ?? []) as { tag: string }[])
        .map((r) => r.tag)
        .filter((t) => typeof t === "string" && t.length > 0)
        .map((t) => (t.length > 30 ? `${t.slice(0, 29)}…` : t));
    },
    isQuick: async (telegramUserId) => {
      const { data } = await admin
        .from("telegram_accounts")
        .select("quick")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();
      return data?.quick === true;
    },
  };
}

export function dmStore(admin: Admin): TradeDmStore {
  return {
    ...flowStore(admin),
    allow: (telegramUserId) => allowRequest(admin, LIMITS.telegramDm, String(telegramUserId)),
    linkedUser: (telegramUserId) => linkedUser(admin, telegramUserId),
    newPendingId: () => randomBytes(PENDING_ID_BYTES).toString("base64url"),
    holdDraft: async (d) => {
      const { error } = await admin.from("telegram_pending_trades").insert({
        id: d.id,
        telegram_user_id: d.telegramUserId,
        user_id: d.userId,
        chat_id: d.chatId,
        draft: d.draft,
        journal_ids: d.journalIds,
        message_text: d.draft.message,
        conversation: d.conversation,
        expires_at: d.expiresAt,
      });
      return !error;
    },
    openDraft: async (telegramUserId) => {
      // Expired or ready included: the handler decides what each means.
      const { data } = await admin
        .from("telegram_pending_trades")
        .select(OPEN_COLUMNS)
        .eq("telegram_user_id", telegramUserId)
        .is("consumed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? toOpen(data as unknown as OpenRow) : null;
    },
    cancelDraft: (id) => cancelDraft(admin, id),
    saveDraft: async (id, draft) => {
      const { error } = await admin
        .from("telegram_pending_trades")
        .update({ draft })
        .eq("id", id)
        .is("consumed_at", null);
      return !error;
    },
    setQuick: async (telegramUserId, quick) => {
      await admin.from("telegram_accounts").update({ quick }).eq("telegram_user_id", telegramUserId);
    },
  };
}

async function cancelDraft(admin: Admin, id: string): Promise<void> {
  await admin
    .from("telegram_pending_trades")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id)
    .is("consumed_at", null);
}

export function answerStore(admin: Admin): TradeAnswerStore {
  return {
    ...flowStore(admin),
    allow: (telegramUserId) => allowRequest(admin, LIMITS.telegramDm, String(telegramUserId)),
    linkedUser: (telegramUserId) => linkedUser(admin, telegramUserId),
    cancelDraft: (id) => cancelDraft(admin, id),
    loadOpen: async (id) => {
      const { data } = await admin.from("telegram_pending_trades").select(OPEN_COLUMNS).eq("id", id).maybeSingle();
      return data ? toOpen(data as unknown as OpenRow) : null;
    },
  };
}

export function tapStore(admin: Admin): TradeTapStore {
  return {
    allow: (telegramUserId) => allowRequest(admin, LIMITS.telegramDm, String(telegramUserId)),
    loadPending: async (id) => {
      const { data } = await admin.from("telegram_pending_trades").select(OPEN_COLUMNS).eq("id", id).maybeSingle();
      if (!data) return null;
      const row: PendingTrade = toOpen(data as unknown as OpenRow);
      return row;
    },
    linkedUser: (telegramUserId) => linkedUser(admin, telegramUserId),
    membership: async (journalId, userId) => {
      const { data } = await admin
        .from("journal_members")
        .select("role, journals!inner(name, is_archived)")
        .eq("journal_id", journalId)
        .eq("user_id", userId)
        .maybeSingle();
      type M = { role: JournalRole; journals: { name: string; is_archived: boolean } };
      const m = data as unknown as M | null;
      if (!m) return null;
      return { name: m.journals.name, canEdit: canEditTrades(m.role), archived: m.journals.is_archived };
    },
    consume: async (id, now) => {
      const { data } = await admin
        .from("telegram_pending_trades")
        .update({ consumed_at: now.toISOString() })
        .eq("id", id)
        .is("consumed_at", null)
        .select("id")
        .maybeSingle();
      return data !== null;
    },
    retake: async (id, now, staleBefore) => {
      const { data } = await admin
        .from("telegram_pending_trades")
        .update({ consumed_at: now.toISOString() })
        .eq("id", id)
        .is("trade_id", null)
        .lt("consumed_at", staleBefore.toISOString())
        .select("id")
        .maybeSingle();
      return data !== null;
    },
    lastSize: (userId, journalId, instrument) => lastSize(admin, userId, journalId, instrument),
    insertTrade: async (row) => {
      const { data, error } = await admin.from("trades").insert(row).select("id").single();
      if (error) {
        if (error.code === "23505" && /telegram_pending/.test(error.message)) return { duplicate: true };
        console.error("[telegram/trade] insert failed", {
          message: error.message, code: error.code, details: error.details, hint: error.hint,
        });
        return { error: error.message };
      }
      return { id: data.id as string };
    },
    savedTradeFor: async (pendingId) => {
      const { data } = await admin
        .from("trades")
        .select("id")
        .eq("telegram_pending_id", pendingId)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },
    markSaved: async (id, tradeId) => {
      await admin.from("telegram_pending_trades").update({ trade_id: tradeId }).eq("id", id);
    },
  };
}
