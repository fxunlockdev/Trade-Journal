"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import type {
  AccountCurrency,
  JournalColor,
  JournalWithRole,
} from "@/types/database";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const COLORS: ReadonlyArray<{
  readonly value: JournalColor;
  readonly swatch: string;
  readonly label: string;
}> = [
  { value: "slate", swatch: "bg-slate-500", label: "Slate" },
  { value: "emerald", swatch: "bg-emerald-500", label: "Emerald" },
  { value: "sky", swatch: "bg-sky-500", label: "Sky" },
  { value: "violet", swatch: "bg-violet-500", label: "Violet" },
  { value: "orange", swatch: "bg-orange-500", label: "Orange" },
  { value: "cyan", swatch: "bg-cyan-500", label: "Cyan" },
  { value: "rose", swatch: "bg-rose-500", label: "Rose" },
  { value: "lime", swatch: "bg-lime-500", label: "Lime" },
  { value: "amber", swatch: "bg-amber-500", label: "Amber" },
  { value: "red", swatch: "bg-red-500", label: "Red" },
];

interface JournalGeneralFormProps {
  readonly journal: JournalWithRole;
  readonly canManage: boolean;
}

/**
 * General-settings tab: rename, recolour, description, archive/unarchive.
 * Non-owners see everything disabled with a banner explaining they need
 * owner role to edit.
 */
export function JournalGeneralForm({
  journal,
  canManage,
}: JournalGeneralFormProps) {
  const router = useRouter();
  const [name, setName] = useState(journal.name);
  const [color, setColor] = useState<JournalColor>(journal.color);
  const [description, setDescription] = useState(journal.description ?? "");
  const [capital, setCapital] = useState(
    journal.initial_capital == null ? "" : String(journal.initial_capital),
  );
  const [currency, setCurrency] = useState<AccountCurrency>(
    journal.account_currency ?? "USD",
  );
  const [riskPercent, setRiskPercent] = useState(
    String(journal.default_risk_percent ?? 1),
  );
  const [saving, setSaving] = useState(false);
  const [savingRisk, setSavingRisk] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const isDirty =
    name.trim() !== journal.name ||
    color !== journal.color ||
    (description.trim() || null) !== journal.description;

  const capitalNum = capital.trim() === "" ? null : Number(capital);
  const riskNum = Number(riskPercent);
  const riskDirty =
    capitalNum !== (journal.initial_capital ?? null) ||
    currency !== (journal.account_currency ?? "USD") ||
    riskNum !== (journal.default_risk_percent ?? 1);

  const handleSaveRisk = async (): Promise<void> => {
    if (!canManage || !riskDirty || savingRisk) return;
    if (capitalNum !== null && (!Number.isFinite(capitalNum) || capitalNum <= 0)) {
      toast.error("Capital must be a positive number (or blank to turn sizing off)");
      return;
    }
    if (!Number.isFinite(riskNum) || riskNum <= 0 || riskNum > 100) {
      toast.error("Risk must be between 0 and 100%");
      return;
    }
    setSavingRisk(true);
    try {
      const res = await fetch(`/api/journals/${journal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initial_capital: capitalNum,
          account_currency: currency,
          default_risk_percent: riskNum,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to save");
        return;
      }
      toast.success(
        capitalNum === null
          ? "Auto-sizing turned off"
          : "Saved — new trades will size themselves",
      );
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSavingRisk(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!canManage || !isDirty || saving) return;
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/journals/${journal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          color,
          description: description.trim().length === 0 ? null : description.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to save");
        return;
      }
      toast.success("Saved");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (archived: boolean): Promise<void> => {
    if (!canManage || archiving) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/journals/${journal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_archived: archived }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to update");
        return;
      }
      toast.success(archived ? "Journal archived" : "Journal restored");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="space-y-6">
      {!canManage && (
        <Card className="border-warn/30 bg-warn/5">
          <CardContent className="pt-6">
            <p className="text-sm text-warn">
              Only journal owners can change these settings. You can still view
              the current configuration here.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basic info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              disabled={!canManage || saving}
            />
            <p className="text-xs text-muted-foreground">Up to 60 characters.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setColor(c.value)}
                  disabled={!canManage || saving}
                  className={cn(
                    "size-7 rounded-full transition-all",
                    c.swatch,
                    color === c.value
                      ? "scale-110 ring-2 ring-foreground/40 ring-offset-2 ring-offset-background"
                      : "opacity-80 hover:opacity-100",
                    (!canManage || saving) && "cursor-not-allowed opacity-50",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              placeholder="What is this journal for? Which group uses it?"
              disabled={!canManage || saving}
            />
            <p className="text-xs text-muted-foreground">
              Up to 300 characters.
            </p>
          </div>

          {canManage && (
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={!isDirty || saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account &amp; risk</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Set this journal&apos;s account size and how much of it you risk per
            trade, and the trade form works out the position size itself from
            your entry and stop loss — no more typing a quantity on every trade.
            Leave the capital blank to keep entering it by hand.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="initial_capital">Account capital</Label>
              <Input
                id="initial_capital"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                placeholder="e.g. 10000"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                disabled={!canManage || savingRisk}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="account_currency">Currency</Label>
              <select
                id="account_currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as AccountCurrency)}
                disabled={!canManage || savingRisk}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm disabled:opacity-50"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="default_risk_percent">Risk per trade (%)</Label>
              <Input
                id="default_risk_percent"
                type="number"
                step="any"
                min="0"
                max="100"
                inputMode="decimal"
                value={riskPercent}
                onChange={(e) => setRiskPercent(e.target.value)}
                disabled={!canManage || savingRisk}
              />
            </div>
          </div>

          {capitalNum !== null && Number.isFinite(capitalNum) && capitalNum > 0 && (
            <p className="text-xs text-muted-foreground">
              Risking{" "}
              <span className="font-medium text-foreground">
                {riskNum}% of {currency} {capitalNum.toLocaleString("en-US")}
              </span>{" "}
              ={" "}
              <span className="font-medium text-foreground">
                {currency}{" "}
                {((capitalNum * riskNum) / 100).toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                })}
              </span>{" "}
              per trade.
            </p>
          )}

          {canManage && (
            <div className="flex justify-end">
              <Button onClick={handleSaveRisk} disabled={!riskDirty || savingRisk}>
                {savingRisk ? "Saving…" : "Save account settings"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card className="border-warn/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="size-4 text-warn" />
              {journal.is_archived ? "Archived" : "Archive journal"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {journal.is_archived ? (
                <>
                  This journal is archived — it&apos;s hidden from the workspace
                  switcher and dashboard totals. Members cannot log new trades
                  while archived. You can restore it at any time.
                </>
              ) : (
                <>
                  Archiving hides this journal from the workspace switcher and
                  stops new trades being logged. All historical data is
                  preserved and can be restored later. No trades are deleted.
                </>
              )}
            </p>
            {journal.is_archived ? (
              <Button
                variant="outline"
                onClick={() => void handleArchive(false)}
                disabled={archiving}
              >
                {archiving ? "Restoring…" : "Restore journal"}
              </Button>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="outline"
                      className="border-warn/40 text-warn hover:bg-warn/10 hover:text-warn"
                      disabled={archiving}
                    />
                  }
                >
                  {archiving ? "Archiving…" : "Archive this journal"}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive this journal?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Members won&apos;t be able to log new trades while the
                      journal is archived, and it will disappear from the
                      workspace switcher. You can restore it at any time — no
                      data is deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-warn text-white hover:bg-warn/90"
                      onClick={() => void handleArchive(true)}
                    >
                      Archive
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
