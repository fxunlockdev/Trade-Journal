"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface AcceptInviteButtonProps {
  readonly token: string;
  readonly journalName: string;
}

/**
 * Client button on the /invite/[token] landing page. POSTs to
 * /api/invites/[token]/accept which runs the SQL RPC to add the caller as
 * a member + set their active journal cookie. On success, redirects to the
 * dashboard (which will now render in the newly-joined workspace).
 */
export function AcceptInviteButton({
  token,
  journalName,
}: AcceptInviteButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const handleAccept = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invites/${token}/accept`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't accept invite");
        return;
      }
      toast.success(`Joined ${journalName}`);
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Network error accepting invite");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Button
      onClick={handleAccept}
      disabled={submitting}
      className="w-full"
      size="lg"
    >
      {submitting ? "Accepting…" : `Accept & join ${journalName}`}
    </Button>
  );
}
