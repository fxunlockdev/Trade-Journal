"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly full_name: string | null;
  readonly avatar_url: string | null;
  readonly role: string;
  readonly has_onboarded: boolean;
}

interface UseUserReturn {
  readonly user: User | null;
  readonly profile: UserProfile | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refetch: () => Promise<void>;
}

export function useUser(): UseUserReturn {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());

  async function fetchProfile(authUser: User) {
    const supabase = supabaseRef.current;

    const { data, error: profileError } = await supabase
      .from("users")
      .select("id, email, full_name, avatar_url, role, has_onboarded")
      .eq("id", authUser.id)
      .single();

    if (profileError || !data) {
      // Fallback to auth user metadata if profile table fails
      setProfile({
        id: authUser.id,
        email: authUser.email ?? "",
        full_name:
          authUser.user_metadata?.full_name ??
          authUser.user_metadata?.name ??
          null,
        avatar_url:
          authUser.user_metadata?.avatar_url ??
          authUser.user_metadata?.picture ??
          null,
        role: "user",
        has_onboarded: false,
      });
      return;
    }

    // Merge: prefer DB data but fill gaps from auth metadata
    setProfile({
      id: data.id,
      email: data.email || authUser.email || "",
      full_name:
        data.full_name ||
        authUser.user_metadata?.full_name ||
        authUser.user_metadata?.name ||
        null,
      avatar_url:
        data.avatar_url ||
        authUser.user_metadata?.avatar_url ||
        authUser.user_metadata?.picture ||
        null,
      role: data.role ?? "user",
      has_onboarded: data.has_onboarded ?? false,
    });
  }

  async function loadUser() {
    const supabase = supabaseRef.current;
    try {
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !authUser) {
        setError(authError?.message ?? null);
        setLoading(false);
        return;
      }

      setUser(authUser);
      await fetchProfile(authUser);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load user");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUser();

    const supabase = supabaseRef.current;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const authUser = session?.user ?? null;
      setUser(authUser);
      if (authUser) {
        await fetchProfile(authUser);
      } else {
        setProfile(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { user, profile, loading, error, refetch: loadUser };
}
