"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Role } from "@/lib/constants/roles";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: Role;
}

interface UseUserReturn {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
}

export function useUser(): UseUserReturn {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const fetchProfile = useCallback(
    async (userId: string) => {
      const { data, error: profileError } = await supabase
        .from("users")
        .select("id, email, full_name, avatar_url, role")
        .eq("id", userId)
        .single();

      if (profileError) {
        setError(profileError.message);
        return;
      }

      setProfile(data as UserProfile);
    },
    [supabase],
  );

  useEffect(() => {
    const getUser = async () => {
      try {
        const {
          data: { user: authUser },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) {
          setError(authError.message);
          setLoading(false);
          return;
        }

        setUser(authUser);

        if (authUser) {
          await fetchProfile(authUser.id);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to load user";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    getUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const authUser = session?.user ?? null;
      setUser(authUser);

      if (authUser) {
        await fetchProfile(authUser.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, fetchProfile]);

  return { user, profile, loading, error };
}
