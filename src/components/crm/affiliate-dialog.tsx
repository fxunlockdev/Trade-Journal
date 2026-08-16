"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AFFILIATE_STATUSES, COMMISSION_TYPES, type Affiliate, type AffiliateStatus,
} from "@/lib/crm/types";

interface AffiliateDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly ownerId: string;
  readonly editing: Affiliate | null;
  readonly onSaved: () => void;
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  country: string;
  status: AffiliateStatus;
  commission_type: string;
  commission_rate: string;
  join_date: string;
  notes: string;
}

const EMPTY: FormState = {
  name: "", email: "", phone: "", country: "",
  status: "LEAD", commission_type: "Revenue Share",
  commission_rate: "", join_date: "", notes: "",
};

export function AffiliateDialog({ open, onOpenChange, ownerId, editing, onSaved }: AffiliateDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            name: editing.name,
            email: editing.email ?? "",
            phone: editing.phone ?? "",
            country: editing.country ?? "",
            status: editing.status,
            commission_type: editing.commission_type ?? "Revenue Share",
            commission_rate: editing.commission_rate?.toString() ?? "",
            join_date: editing.join_date ?? "",
            notes: editing.notes ?? "",
          }
        : EMPTY,
    );
  }, [open, editing]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    const rate = form.commission_rate.trim() === "" ? null : Number(form.commission_rate);
    if (rate !== null && (Number.isNaN(rate) || rate < 0)) {
      toast.error("Commission rate must be a positive number.");
      return;
    }

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      country: form.country.trim() || null,
      status: form.status,
      commission_type: form.commission_type || null,
      commission_rate: rate,
      join_date: form.join_date || null,
      notes: form.notes.trim() || null,
    };

    // owner_id is set explicitly and re-checked by RLS (owner_id = auth.uid()
    // AND has_product('crm')). A crafted owner_id for another user fails the
    // policy WITH CHECK, so this is safe from the client.
    const { error } = editing
      ? await supabase.from("affiliates").update(payload).eq("id", editing.id)
      : await supabase.from("affiliates").insert({ ...payload, owner_id: ownerId });

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editing ? "Affiliate updated." : "Affiliate added.");
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit affiliate" : "Add affiliate"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="af-name">Name *</Label>
            <Input id="af-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Jane Doe" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="af-email">Email</Label>
              <Input id="af-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@example.com" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="af-phone">Phone</Label>
              <Input id="af-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="af-country">Country</Label>
              <Input id="af-country" value={form.country} onChange={(e) => set("country", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => v && set("status", v as AffiliateStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AFFILIATE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Commission type</Label>
              <Select value={form.commission_type} onValueChange={(v) => v && set("commission_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMISSION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="af-rate">Commission rate (%)</Label>
              <Input id="af-rate" inputMode="decimal" value={form.commission_rate} onChange={(e) => set("commission_rate", e.target.value)} placeholder="30" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="af-join">Join date</Label>
            <Input id="af-join" type="date" value={form.join_date} onChange={(e) => set("join_date", e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="af-notes">Notes</Label>
            <Textarea id="af-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add affiliate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
