import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotToken, telegramWebhookSecret } from "@/lib/telegram/config";
import {
  parseCommand,
  decodePublish,
  encodePublish,
  isAdminStatus,
  CADENCE_PROMPT,
  type Cadence,
} from "@/lib/telegram/commands";
import {
  getChatMemberStatus,
  sendChatMessage,
  answerCallback,
  clearButtons,
  type InlineButton,
} from "@/lib/telegram/chat";
import { findClaimCode, findLinkCode } from "@/lib/telegram/claim";
import { ensureSnapshot } from "@/lib/reports/ensure-snapshot";
import { publishSnapshot } from "@/lib/reports/publish";
import { escapeHtml } from "@/lib/reports/caption";
import type { ReportDesk } from "@/types/database";

/**
 * Telegram commands: /daily, /weekly, /monthly.
 *
 * TWO INDEPENDENT QUESTIONS, ANSWERED BY TWO DIFFERENT AUTHORITIES.
 *
 *   who   Is the sender an admin of THIS chat?      Telegram (getChatMember)
 *   what  chat -> destination -> owner -> desks     our database
 *
 * Nothing in the request is trusted for either. `callback_data` is a string the
 * client chose, so a tap re-runs the whole chain server-side rather than
 * believing the desk id it carries. Partners in the group see the images
 * arrive; the buttons do nothing for them.
 *
 * This endpoint is PUBLIC and can cause a post to a partner group, so the
 * secret header is checked before anything else is read.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const BUDGET_MS = 280_000;

/** Length-guarded constant-time compare of Telegram's secret header. */
function verifySecret(request: NextRequest): boolean {
  // The SAME derivation the setup route registered with. Both call one
  // function precisely so they cannot disagree about what the secret is.
  const expected = telegramWebhookSecret();
  if (!expected) return false;
  const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i += 1) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

interface TgUser {
  readonly id?: number;
  readonly first_name?: string;
}
interface TgChat {
  readonly id?: number;
  readonly type?: string;
  readonly title?: string;
}
interface TgMessage {
  readonly message_id?: number;
  readonly text?: string;
  readonly chat?: TgChat;
  readonly from?: TgUser;
  /** Present when someone posts AS the group, hiding their user identity. */
  readonly sender_chat?: TgChat;
}
interface TgUpdate {
  readonly message?: TgMessage;
  /** A post in a CHANNEL. Telegram never delivers these as `message`. */
  readonly channel_post?: TgMessage;
  readonly my_chat_member?: { readonly chat?: TgChat & { readonly title?: string } };
  readonly callback_query?: {
    readonly id?: string;
    readonly data?: string;
    readonly from?: TgUser;
    readonly message?: TgMessage;
  };
}

/**
 * Remember that the bot is in this group.
 *
 * Registering a webhook makes getUpdates return 409, and getUpdates was the
 * only way to list a bot's chats. Without recording them here, connecting a
 * NEW group would break the moment /daily shipped. Best-effort on purpose: a
 * failure here must never stop the command the user actually sent.
 */
async function rememberChat(
  admin: ReturnType<typeof createAdminClient>,
  chat: TgChat | undefined,
): Promise<void> {
  // Private chats are the bot's own DMs, never a publishing destination.
  if (!chat?.id || !chat.type || chat.type === "private") return;
  try {
    await admin.from("telegram_seen_chats").upsert(
      {
        chat_id: String(chat.id),
        title: chat.title ?? null,
        chat_type: chat.type,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "chat_id" },
    );
  } catch {
    // Ignored by design; see above.
  }
}

/**
 * Link a chat to the account that posted its claim code.
 *
 * This is the ONLY evidence that an app user is actually in a Telegram group.
 * Telegram cannot bridge the two identities, so posting the code in the group
 * is the proof, and it is only worth anything if the code is single-use and
 * short-lived: `claimed_at is null` and the expiry check below are what make it
 * so. Without them a code seen once could attach any later chat.
 *
 * Returns a message for the group, or null when there was no code to act on.
 */
async function claimChatIfCoded(
  admin: ReturnType<typeof createAdminClient>,
  msg: TgMessage,
): Promise<string | null> {
  const code = findClaimCode(msg.text);
  if (!code || !msg.chat?.id) return null;

  const { data: claim } = await admin
    .from("telegram_chat_claims")
    .select("code")
    .eq("code", code)
    .is("claimed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!claim) {
    // Covers wrong, already-used and expired alike. Distinguishing them would
    // tell someone probing codes which ones exist.
    return "That code is not valid any more. Open the Posters page again for a fresh one.";
  }

  // Conditional on still being unclaimed, so two messages racing the same code
  // cannot both win.
  const { data: updated } = await admin
    .from("telegram_chat_claims")
    .update({
      chat_id: String(msg.chat.id),
      chat_title: msg.chat.title ?? null,
      claimed_at: new Date().toISOString(),
    })
    .eq("code", code)
    .is("claimed_at", null)
    .select("code")
    .maybeSingle();

  if (!updated) return "That code has already been used.";
  return "Confirmed. This group is now available to connect on the Posters page.";
}

/**
 * Link a Telegram account to the app account that minted this code.
 *
 * The proof is that the message came FROM that Telegram account: only it can
 * send from itself. That is the whole mechanism, and it is why the code must be
 * single-use and short-lived -- otherwise a code seen once could link a
 * different account later.
 *
 * This is what makes "whose journals?" answerable. The chat-to-owner mapping is
 * one chat to one owner, so in a shared room it cannot tell two people apart.
 *
 * Returns a message for the sender, or null when there was no link code.
 */
async function linkAccountIfCoded(
  admin: ReturnType<typeof createAdminClient>,
  msg: TgMessage,
): Promise<string | null> {
  const code = findLinkCode(msg.text);
  if (!code) return null;

  // An anonymous sender cannot be linked: there is no account to link TO.
  const telegramUserId = msg.from?.id;
  if (!telegramUserId) {
    return "I can't tell which account sent that. Send the code from your own Telegram account, not as a channel or group.";
  }

  const { data: link } = await admin
    .from("telegram_account_links")
    .select("code, user_id")
    .eq("code", code)
    .is("claimed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!link) {
    // Wrong, used and expired share one message. Distinguishing them would
    // tell someone probing codes which ones exist.
    return "That code is not valid any more. Open Settings in Trade Journal for a fresh one.";
  }

  // Conditional on still being unclaimed, so two messages racing one code
  // cannot both win.
  const { data: claimed } = await admin
    .from("telegram_account_links")
    .update({
      telegram_user_id: telegramUserId,
      claimed_at: new Date().toISOString(),
    })
    .eq("code", code)
    .is("claimed_at", null)
    .select("user_id")
    .maybeSingle();

  if (!claimed) return "That code has already been used.";

  // One Telegram account per app account and vice versa, both enforced by
  // unique indexes. Re-linking REPLACES rather than erroring: someone changing
  // phone or Telegram account should not need support to fix it.
  const { error } = await admin
    .from("telegram_accounts")
    .upsert(
      {
        telegram_user_id: telegramUserId,
        user_id: claimed.user_id as string,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    return "Couldn't finish linking. Try a fresh code from Settings.";
  }

  return "Linked. You can log trades here now, and I'll ask which journal each time.";
}

/** The chat's owner and their connected destination, or null. */
async function resolveChat(
  admin: ReturnType<typeof createAdminClient>,
  chatId: string,
) {
  const { data } = await admin
    .from("telegram_destinations")
    .select("id, chat_id, chat_title, owner_user_id")
    .eq("chat_id", chatId)
    .eq("status", "connected")
    .maybeSingle();
  return data;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  const msLeft = (): number => BUDGET_MS - (Date.now() - started);

  // Checked before the body is read: without this, anyone who learns the URL
  // could make the bot publish.
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botToken = telegramBotToken();
  if (!botToken) return NextResponse.json({ ok: true });

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  // ALWAYS 200 from here on. A non-200 makes Telegram redeliver the update,
  // which would re-run a command someone already got an answer to.
  try {
    const admin = createAdminClient();

    // Recorded for EVERY update, before any command handling, so a group the
    // bot was merely added to still shows up in the connect picker.
    await rememberChat(
      admin,
      update.message?.chat ??
        update.channel_post?.chat ??
        update.my_chat_member?.chat,
    );

    /* ── a claim code ──────────────────────────────────────────────── */
    // Checked BEFORE commands: this is how a chat becomes connectable at all,
    // and it must work somewhere that has no destination yet.
    //
    // Accepts a CHANNEL post as readily as a group message. In a channel only
    // admins can post, so a code appearing there is stronger proof of
    // authority than the same code in a group, not weaker.
    const posted = update.message ?? update.channel_post;
    if (posted?.chat?.id) {
      const reply = await claimChatIfCoded(admin, posted);
      if (reply) {
        await sendChatMessage(botToken, String(posted.chat.id), reply);
        return NextResponse.json({ ok: true });
      }
    }

    /* ── an account-link code ──────────────────────────────────────── */
    // Only from a real message, never a channel post: a channel post carries
    // no `from`, so there is no account to link. Handled before commands so a
    // brand-new DM works with nothing else set up.
    if (update.message?.chat?.id) {
      const reply = await linkAccountIfCoded(admin, update.message);
      if (reply) {
        await sendChatMessage(botToken, String(update.message.chat.id), reply);
        return NextResponse.json({ ok: true });
      }
    }

    /* ── a command typed in a CHANNEL ──────────────────────────────── */
    // A channel post carries no `from`: it is published BY the channel, so
    // there is no user to run the admin check against and no honest way to
    // decide who asked. Rather than fall through to the group handler and emit
    // its "turn off Remain anonymous" advice, which is not a setting channels
    // have, say what actually works.
    if (update.channel_post && parseCommand(update.channel_post.text)) {
      await sendChatMessage(
        botToken,
        String(update.channel_post.chat?.id),
        "Commands don't work in a channel, because a channel post doesn't say who wrote it. Use <b>Post to Telegram</b> on the Posters page instead. Scheduled reports still publish here automatically.",
      );
      return NextResponse.json({ ok: true });
    }

    /* ── a typed command ───────────────────────────────────────────── */
    if (update.message) {
      const msg = update.message;
      const cadence = parseCommand(msg.text);
      if (!cadence || !msg.chat?.id) return NextResponse.json({ ok: true });
      const chatId = String(msg.chat.id);

      // Posting as the group hides who is asking, so the admin check cannot be
      // run at all. Refused with the reason rather than guessed at.
      if (msg.sender_chat || !msg.from?.id) {
        await sendChatMessage(
          botToken,
          chatId,
          "I can't tell who sent that, because it was posted anonymously. Turn off <b>Remain anonymous</b> in your admin settings and try again.",
        );
        return NextResponse.json({ ok: true });
      }

      const destination = await resolveChat(admin, chatId);
      if (!destination) {
        await sendChatMessage(
          botToken,
          chatId,
          "This group isn't connected to a Trade Journal account yet. Connect it from the Posters page first.",
        );
        return NextResponse.json({ ok: true });
      }

      const status = await getChatMemberStatus(botToken, chatId, msg.from.id);
      if (!isAdminStatus(status)) {
        // Deliberately quiet: a partner tapping around should not be told what
        // they are missing, and the group does not need the noise.
        return NextResponse.json({ ok: true });
      }

      const { data: desks } = await admin
        .from("report_desks")
        .select("id, name")
        .eq("owner_user_id", destination.owner_user_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      const list = (desks ?? []) as Pick<ReportDesk, "id" | "name">[];
      if (list.length === 0) {
        await sendChatMessage(
          botToken,
          chatId,
          "No desks are set up for this account yet. Create one on the Posters page.",
        );
        return NextResponse.json({ ok: true });
      }

      const buttons: InlineButton[] = list.map((d) => ({
        text: d.name,
        callback_data: encodePublish(cadence, d.id),
      }));
      await sendChatMessage(
        botToken,
        chatId,
        CADENCE_PROMPT[cadence],
        buttons,
      );
      return NextResponse.json({ ok: true });
    }

    /* ── a tapped desk button ──────────────────────────────────────── */
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id ? String(cb.message.chat.id) : null;
      const request_ = decodePublish(cb.data);

      if (!cb.id || !chatId || !request_ || !cb.from?.id) {
        if (cb.id) await answerCallback(botToken, cb.id);
        return NextResponse.json({ ok: true });
      }

      // RE-VERIFIED, not trusted. The tap carries a desk id the client chose,
      // so every link in the chain is checked again from the CHAT.
      const destination = await resolveChat(admin, chatId);
      if (!destination) {
        await answerCallback(botToken, cb.id, "This group isn't connected.", true);
        return NextResponse.json({ ok: true });
      }

      const status = await getChatMemberStatus(botToken, chatId, cb.from.id);
      if (!isAdminStatus(status)) {
        await answerCallback(
          botToken,
          cb.id,
          "Only group admins can publish reports.",
          true,
        );
        return NextResponse.json({ ok: true });
      }

      // THE cross-tenant check. A well-formed desk id belonging to another
      // owner looks identical in the callback data; this is what refuses it.
      const { data: desk } = await admin
        .from("report_desks")
        .select("*")
        .eq("id", request_.deskId)
        .eq("owner_user_id", destination.owner_user_id)
        .eq("is_active", true)
        .maybeSingle();

      if (!desk) {
        await answerCallback(botToken, cb.id, "That desk isn't available.", true);
        return NextResponse.json({ ok: true });
      }

      // Acknowledged now: Telegram spins the button until this returns, and
      // rendering takes half a minute.
      await answerCallback(botToken, cb.id, "Drawing the posters...");
      if (cb.message?.message_id) {
        // So the same picker cannot be tapped twice while the first is running.
        await clearButtons(botToken, chatId, cb.message.message_id);
      }

      // The response goes back to Telegram NOW and the work continues after it.
      // Holding the connection for a 60s render invites Telegram's own retry,
      // which would be a second identical request.
      after(async () => {
        try {
          const ensured = await ensureSnapshot(
            admin,
            desk as ReportDesk,
            request_.cadence as Cadence,
            new Date(),
          );

          if (ensured.kind === "empty") {
            await sendChatMessage(
              botToken,
              chatId,
              `<b>${escapeHtml(desk.name)}</b> had no closed trades in that period, so there's nothing to post.`,
            );
            return;
          }
          if (ensured.kind === "error") {
            await sendChatMessage(botToken, chatId, ensured.message);
            return;
          }

          const outcome = await publishSnapshot({
            admin,
            snapshot: ensured.snapshot,
            deskName: desk.name,
            templateIds: (desk as ReportDesk).template_ids,
            destination,
            botToken,
            appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "",
            msLeft,
          });

          if (outcome.status === "already") {
            await sendChatMessage(
              botToken,
              chatId,
              `That report has already been posted here. Scroll up to find it.`,
            );
          } else if (outcome.status === "in_doubt") {
            await sendChatMessage(
              botToken,
              chatId,
              "That send didn't finish cleanly and may have posted. Check above before trying again.",
            );
          } else if (outcome.status === "failed") {
            await sendChatMessage(
              botToken,
              chatId,
              "Couldn't draw that report. Nothing was posted.",
            );
          }
          // A success needs no message: the album IS the answer.
        } catch (err: unknown) {
          console.error("[telegram/webhook] publish failed:", err);
        }
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[telegram/webhook] unexpected:", err);
    // Still 200: a 500 makes Telegram redeliver, and a bug that fails twice
    // fails every time.
    return NextResponse.json({ ok: true });
  }
}
