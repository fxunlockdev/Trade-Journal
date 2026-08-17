"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * CRM settings — the IB edits their own company name (used as the workspace
 * label). Writes go through the RLS-scoped client; the user may only update
 * their own row, and only the whitelisted columns (company_name, full_name).
 */
export default function CrmSettingsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      setEmail(auth.user.email ?? "");
      const { data } = await supabase
        .from("users")
        .select("company_name, full_name")
        .eq("id", auth.user.id)
        .single<{ company_name: string | null; full_name: string | null }>();
      setCompanyName(data?.company_name ?? "");
      setFullName(data?.full_name ?? "");
      setLoading(false);
    })();
  }, [supabase]);

  async function handleSave() {
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setSaving(false); return; }
    const { error } = await supabase
      .from("users")
      .update({ company_name: companyName.trim() || null, full_name: fullName.trim() || null })
      .eq("id", auth.user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Settings saved.");
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Your CRM workspace details.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace</CardTitle>
          <CardDescription>Shown across your CRM. This is your own profile, and no one else can see or edit it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="company">Company name</Label>
                <Input id="company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Introducing Broker" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fullname">Your name</Label>
                <Input id="fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={email} disabled className="text-muted-foreground" />
              </div>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
