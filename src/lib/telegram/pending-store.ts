/**
 * The admin-client implementation of the two store interfaces the DM and tap
 * handlers are written against. Thin on purpose: every query here is a
 * one-liner, and every decision lives in the handlers where it is tested.
 */

import { randomBytes } from "node:crypto";
import { canEditTrades } from "@/lib/journals/active-journal";
import { allowRequest, LIMITS } from "@/lib/rate-limit";
import { PENDING_ID_BYTES } from "@/lib/telegram/commands";
import { type Admin, editableJournals, lastQuantity, linkedUser } from "@/lib/telegram/accounts";
import type { TradeDmStore } from "@/lib/telegram/trade-dm";
import type { PendingTrade, TradeTapStore } from "@/lib/telegram/trade-tap";
import type { TradeDraft } from "@/lib/telegram/trade-intent";
import type { JournalRole } from "@/types/database";

export function dmStore(admin: Admin): TradeDmStore {
  return {
    allow: (telegramUserId) => allowRequest(admin, LIMITS.telegramDm, String(telegramUserId)),
    linkedUser: (telegramUserId) => linkedUser(admin, telegramUserId),
    editableJournals: (userId) => editableJournals(admin, userId),
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
        expires_at: d.expiresAt,
      });
      return !error;
    },
  };
}

export function tapStore(admin: Admin): TradeTapStore {
  return {
    loadPending: async (id) => {
      const { data } = await admin
        .from("telegram_pending_trades")
        .select("id, telegram_user_id, user_id, chat_id, draft, journal_ids, expires_at, consumed_at, trade_id")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      const row: PendingTrade = {
        id: data.id as string,
        telegramUserId: Number(data.telegram_user_id),
        userId: data.user_id as string,
        chatId: data.chat_id as string,
        draft: data.draft as TradeDraft,
        journalIds: (data.journal_ids ?? []) as string[],
        expiresAt: data.expires_at as string,
        consumedAt: (data.consumed_at as string | null) ?? null,
        tradeId: (data.trade_id as string | null) ?? null,
      };
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
    lastQuantity: (userId, journalId, instrument) => lastQuantity(admin, userId, journalId, instrument),
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
