"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

interface InviteRow {
  id: string;
  label: string | null;
  email: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

type Status = "Pending" | "Used" | "Revoked" | "Expired";

function statusOf(i: InviteRow): Status {
  if (i.accepted_at) return "Used";
  if (i.revoked_at) return "Revoked";
  if (new Date(i.expires_at) < new Date()) return "Expired";
  return "Pending";
}

/**
 * IB invite management. IB access is invite-only, so this is where it's granted:
 * mint a single-use link, send it, revoke it if it goes astray.
 */
export function IbInvites() {
  const supabase = createClient();
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newUrl, setNewUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_invites")
      .select("id, label, email, expires_at, accepted_at, revoked_at, created_at")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as InviteRow[]);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  async function createInvite() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/ib-invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(data.error ?? "Could not create invite.");
        return;
      }
      setNewUrl(data.url);
      setLabel("");
      void navigator.clipboard.writeText(data.url).catch(() => {});
      toast.success("Invite link created and copied.");
      void load();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/admin/ib-invites/${id}/revoke`, { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? "Could not revoke.");
      return;
    }
    toast.success("Invite revoked.");
    void load();
  }

  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2>IB invitations</h2>
          <p>IB access is invite-only. Send someone a link and they get the Affiliate CRM on top of their journal.</p>
        </div>
      </div>

      <div className="admin-invite-form">
        <input
          placeholder="Who is this for? (optional, e.g. Nick — EU desk)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className="btn-primary" onClick={createInvite} disabled={creating}>
          {creating ? "Creating…" : "Create IB invite"}
        </button>
      </div>

      {newUrl && (
        <div className="admin-newlink">
          <span>Single-use link, valid 14 days — copied to your clipboard:</span>
          <code>{newUrl}</code>
        </div>
      )}

      <div className="admin-table">
        <div className="admin-tr admin-th">
          <span>For</span><span>Created</span><span>Status</span><span />
        </div>
        {loading ? (
          <div className="admin-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="admin-empty">No invites yet.</div>
        ) : (
          rows.map((i) => {
            const s = statusOf(i);
            return (
              <div className="admin-tr" key={i.id}>
                <span>{i.label ?? i.email ?? "—"}</span>
                <span className="muted">{new Date(i.created_at).toLocaleDateString()}</span>
                <span><em className={`pill-status s-${s.toLowerCase()}`}>{s}</em></span>
                <span className="right">
                  {s === "Pending" && (
                    <button className="admin-link-btn" onClick={() => revoke(i.id)}>Revoke</button>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
