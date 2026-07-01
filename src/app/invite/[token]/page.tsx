import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AcceptInviteButton } from "@/components/journals/accept-invite-button";
import { COLOR_CLASS_SERVER } from "@/app/(app)/journal/settings/color-class";
import { cn } from "@/lib/utils";
import type { JournalColor } from "@/types/database";

/**
 * Public invite landing page at /invite/[token].
 *
 * Accessible to anonymous visitors. Shows the journal name, colour, inviter,
 * and status (expired / revoked / accepted / pending). If the visitor is
 * logged in, renders an Accept button. If not, shows a Sign in CTA that
 * preserves the invite URL via ?next so they come back here after auth.
 *
 * SECURITY: the token is the authorization. We deliberately use the admin
 * client for the inspect call so RLS on journal_invites doesn't need to be
 * relaxed for anon callers. The SQL RPC `get_invite_public_info` is also
 * GRANTed to anon as a redundant safety net if the admin client fails.
 */

type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

interface InviteInfo {
  readonly journal_id: string;
  readonly journal_name: string;
  readonly journal_color: JournalColor;
  readonly role: string;
  readonly inviter_email: string;
  readonly inviter_name: string;
  readonly expires_at: string;
  readonly accepted_at: string | null;
  readonly revoked_at: string | null;
  readonly status: InviteStatus;
}

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

async function fetchInviteInfo(token: string): Promise<InviteInfo | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_invite_public_info", {
    p_token: token,
  });
  if (error) return null;
  const rows = (data ?? []) as Omit<InviteInfo, "status">[];
  if (rows.length === 0) return null;
  const inv = rows[0];
  const now = Date.now();
  const status: InviteStatus = inv.accepted_at
    ? "accepted"
    : inv.revoked_at
      ? "revoked"
      : new Date(inv.expires_at).getTime() < now
        ? "expired"
        : "pending";
  return { ...inv, status };
}

export default async function InviteLandingPage({ params }: InvitePageProps) {
  const { token } = await params;
  const invite = await fetchInviteInfo(token);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!invite) {
    return (
      <InviteShell>
        <StatusCard
          tone="error"
          title="Invite not found"
          description="This invite link is invalid or has been deleted. Ask whoever sent it to you for a new one."
        />
      </InviteShell>
    );
  }

  const inviterLabel = invite.inviter_name || invite.inviter_email;
  const colorClass = COLOR_CLASS_SERVER[invite.journal_color] ?? "bg-slate-500";

  if (invite.status === "revoked") {
    return (
      <InviteShell>
        <StatusCard
          tone="error"
          title="Invite revoked"
          description={`This invite to "${invite.journal_name}" has been revoked by ${inviterLabel}. Ask them for a new one.`}
        />
      </InviteShell>
    );
  }

  if (invite.status === "expired") {
    return (
      <InviteShell>
        <StatusCard
          tone="warn"
          title="Invite expired"
          description={`This invite to "${invite.journal_name}" expired on ${new Date(invite.expires_at).toLocaleDateString()}. Ask ${inviterLabel} for a new one.`}
        />
      </InviteShell>
    );
  }

  if (invite.status === "accepted") {
    return (
      <InviteShell>
        <StatusCard
          tone="info"
          title="Already accepted"
          description={`This invite has already been accepted. If that was you, head to your dashboard.`}
          cta={
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
            >
              Go to dashboard
            </Link>
          }
        />
      </InviteShell>
    );
  }

  // status === "pending"
  return (
    <InviteShell>
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className={cn("size-6 shrink-0 rounded-full", colorClass)} />
          <h1 className="text-xl font-semibold tracking-tight">
            {invite.journal_name}
          </h1>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{inviterLabel}</span>{" "}
          has invited you to join this journal as a{" "}
          <span className="font-medium text-foreground">{invite.role}</span>.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {invite.role === "member"
            ? "You'll be able to log, edit, and view trades in this journal."
            : "You'll have read-only access to this journal's trades."}
        </p>

        <div className="mt-5">
          {user ? (
            <AcceptInviteButton token={token} journalName={invite.journal_name} />
          ) : (
            <div className="space-y-2">
              <Link
                href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
              >
                Sign in to accept
              </Link>
              <p className="text-center text-xs text-muted-foreground">
                Don&apos;t have an account yet? Sign up and the invite will
                still be waiting for you.
              </p>
            </div>
          )}
        </div>

        <p className="mt-5 text-[11px] text-muted-foreground">
          Expires {new Date(invite.expires_at).toLocaleDateString()}
        </p>
      </div>
    </InviteShell>
  );
}

function InviteShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4">{children}</div>
    </div>
  );
}

interface StatusCardProps {
  readonly tone: "error" | "warn" | "info";
  readonly title: string;
  readonly description: string;
  readonly cta?: React.ReactNode;
}

function StatusCard({ tone, title, description, cta }: StatusCardProps) {
  const toneBorder =
    tone === "error"
      ? "border-neg/30 bg-neg/5"
      : tone === "warn"
        ? "border-warn/30 bg-warn/5"
        : "border-border bg-card";
  return (
    <div className={cn("rounded-xl border p-6", toneBorder)}>
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}
