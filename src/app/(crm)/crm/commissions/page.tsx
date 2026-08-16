"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  COMMISSION_STATUSES, MONTHS, formatCurrency,
  type Affiliate, type Commission, type CommissionStatus,
} from "@/lib/crm/types";

const STATUS_VARIANT: Record<CommissionStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

const now = new Date();

interface FormState {
  affiliate_id: string;
  month: number;
  year: number;
  amount: string;
  status: CommissionStatus;
  note: string;
}

export default function CommissionsPage() {
  const supabase = createClient();
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Commission | null>(null);
  const [deleting, setDeleting] = useState<Commission | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>({
    affiliate_id: "", month: now.getMonth() + 1, year: now.getFullYear(),
    amount: "", status: "PENDING", note: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) setOwnerId(auth.user.id);
    const [c, a] = await Promise.all([
      supabase.from("commissions").select("*").order("year", { ascending: false }).order("month", { ascending: false }),
      supabase.from("affiliates").select("*").order("name"),
    ]);
    setLoading(false);
    if (c.error) return toast.error(c.error.message);
    if (a.error) return toast.error(a.error.message);
    setCommissions((c.data ?? []) as Commission[]);
    setAffiliates((a.data ?? []) as Affiliate[]);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const nameById = useMemo(
    () => new Map(affiliates.map((a) => [a.id, a.name])),
    [affiliates],
  );

  function openAdd() {
    setEditing(null);
    setForm({
      affiliate_id: affiliates[0]?.id ?? "",
      month: now.getMonth() + 1, year: now.getFullYear(),
      amount: "", status: "PENDING", note: "",
    });
    setDialogOpen(true);
  }

  function openEdit(c: Commission) {
    setEditing(c);
    setForm({
      affiliate_id: c.affiliate_id, month: c.month, year: c.year,
      amount: c.amount.toString(), status: c.status, note: c.note ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.affiliate_id) return toast.error("Pick an affiliate.");
    const amount = Number(form.amount);
    if (Number.isNaN(amount) || amount < 0) return toast.error("Amount must be a positive number.");

    setSaving(true);
    const payload = {
      affiliate_id: form.affiliate_id, month: form.month, year: form.year,
      amount, status: form.status, note: form.note.trim() || null,
    };
    const { error } = editing
      ? await supabase.from("commissions").update(payload).eq("id", editing.id)
      : await supabase.from("commissions").insert({ ...payload, owner_id: ownerId });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Commission updated." : "Commission logged.");
    setDialogOpen(false);
    void load();
  }

  async function confirmDelete() {
    if (!deleting) return;
    const { error } = await supabase.from("commissions").delete().eq("id", deleting.id);
    if (error) toast.error(error.message);
    else { toast.success("Commission deleted."); void load(); }
    setDeleting(null);
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Commissions</h1>
          <p className="text-sm text-muted-foreground">Monthly earnings ledger per affiliate.</p>
        </div>
        <Button onClick={openAdd} disabled={affiliates.length === 0}>
          <Plus className="mr-1.5 h-4 w-4" /> Log commission
        </Button>
      </div>

      {affiliates.length === 0 && !loading && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Add an affiliate first — commissions are logged against an affiliate.
        </p>
      )}

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Affiliate</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Note</TableHead>
              <TableHead className="w-[90px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))
            ) : commissions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                    <Receipt className="h-8 w-8 opacity-40" />
                    <p>No commissions logged yet.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              commissions.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{nameById.get(c.affiliate_id) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{MONTHS[c.month - 1]} {c.year}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatCurrency(c.amount)}</TableCell>
                  <TableCell><Badge className={STATUS_VARIANT[c.status]} variant="secondary">{c.status}</Badge></TableCell>
                  <TableCell className="hidden md:table-cell max-w-[200px] truncate text-muted-foreground">{c.note ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)} aria-label="Edit commission"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(c)} aria-label="Delete commission"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit commission" : "Log commission"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Affiliate</Label>
              <Select value={form.affiliate_id} onValueChange={(v) => v && setForm((f) => ({ ...f, affiliate_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select affiliate" /></SelectTrigger>
                <SelectContent>{affiliates.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Month</Label>
                <Select value={String(form.month)} onValueChange={(v) => v && setForm((f) => ({ ...f, month: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Year</Label>
                <Select value={String(form.year)} onValueChange={(v) => v && setForm((f) => ({ ...f, year: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="cm-amount">Amount (USD)</Label>
                <Input id="cm-amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => v && setForm((f) => ({ ...f, status: v as CommissionStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COMMISSION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cm-note">Note</Label>
              <Textarea id="cm-note" rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editing ? "Save" : "Log commission"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this commission?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
