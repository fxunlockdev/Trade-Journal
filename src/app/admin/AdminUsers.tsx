"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { PlatformRole } from "@/lib/auth/entitlements";

interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
  platform_role: PlatformRole;
  last_active_at: string | null;
  created_at: string;
  signup_intent: "trader" | "ib" | null;
  ib_request_status: "none" | "pending" | "approved" | "declined";
  ib_requested_at: string | null;
}

const ROLE_LABEL: Record<PlatformRole, string> = {
  affiliate: "Affiliate · Journal only",
  ib: "IB · Journal + CRM",
  admin: "Admin · everything",
};

/**
 * Member tier list. This is the other half of gatekeeping: invites grant IB on
 * the way in, and this can grant or take it away afterwards. Every change runs
 * through admin_set_platform_role(), which re-checks admin, blocks self-changes
 * and last-admin demotion, and writes an audit row.
 */
export function AdminUsers({ selfId }: { selfId: string }) {
  const supabase = createClient();
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_users");
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as AdminUserRow[]);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  async function decide(target: AdminUserRow, approve: boolean) {
    setBusyId(target.id);
    try {
      const res = await fetch("/api/admin/ib-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetUserId: target.id, approve }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not update the request.");
        return;
      }
      toast.success(
        approve
          ? `${target.email ?? "User"} now has IB access.`
          : `Request declined.`,
      );
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(target: AdminUserRow, role: PlatformRole) {
    if (role === target.platform_role) return;
    setBusyId(target.id);
    try {
      const res = await fetch("/api/admin/platform-role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetUserId: target.id, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not change role.");
        return;
      }
      toast.success(`${target.email ?? "User"} is now ${role}.`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const pending = rows.filter((u) => u.ib_request_status === "pending");

  return (
    <>
      {pending.length > 0 && (
        <section className="admin-section">
          <div className="admin-section-head">
            <div>
              <h2>IB requests · {pending.length}</h2>
              <p>
                These people said they introduce clients when they signed up. They have
                journal access already; approving adds the Affiliate CRM.
              </p>
            </div>
          </div>
          <div className="admin-table">
            {pending.map((u) => (
              <div className="admin-tr cols-3" key={u.id}>
                <span>
                  <strong>{u.full_name ?? u.email ?? u.id}</strong>
                  <em className="muted block">{u.email}</em>
                </span>
                <span className="muted">
                  {u.ib_requested_at ? new Date(u.ib_requested_at).toLocaleDateString() : "–"}
                </span>
                <span className="admin-decide">
                  <button
                    className="btn-primary admin-approve"
                    disabled={busyId === u.id}
                    onClick={() => decide(u, true)}
                  >
                    Approve
                  </button>
                  <button
                    className="admin-link-btn"
                    disabled={busyId === u.id}
                    onClick={() => decide(u, false)}
                  >
                    Decline
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

    <section className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2>Members</h2>
          <p>Everyone with an FXU account. Change a tier to grant or remove CRM access.</p>
        </div>
      </div>

      <div className="admin-table">
        <div className="admin-tr admin-th cols-3">
          <span>Member</span><span>Last active</span><span>Access</span>
        </div>
        {loading ? (
          <div className="admin-empty">Loading…</div>
        ) : (
          rows.map((u) => (
            <div className="admin-tr cols-3" key={u.id}>
              <span>
                <strong>{u.full_name ?? u.email ?? u.id}</strong>
                <em className="muted block">
                  {u.email}{u.id === selfId ? " · you" : ""}
                  {u.signup_intent === "ib" && " · said IB"}
                  {u.signup_intent === "trader" && " · said trader"}
                </em>
              </span>
              <span className="muted">
                {u.last_active_at ? new Date(u.last_active_at).toLocaleDateString() : "–"}
              </span>
              <span>
                <select
                  className="admin-select"
                  value={u.platform_role}
                  disabled={u.id === selfId || busyId === u.id}
                  onChange={(e) => changeRole(u, e.target.value as PlatformRole)}
                >
                  {(Object.keys(ROLE_LABEL) as PlatformRole[]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
    </>
  );
}
