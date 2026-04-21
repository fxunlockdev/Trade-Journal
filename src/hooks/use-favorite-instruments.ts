"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-user favorite instruments hook. Fetches from `/api/favorites` on mount
 * and exposes optimistic toggle. Keeps favorites as an ordered list (oldest
 * first — matches server ordering) so the picker renders them deterministically.
 */
interface UseFavoriteInstrumentsReturn {
  readonly favorites: readonly string[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly isFavorite: (instrument: string) => boolean;
  readonly toggle: (instrument: string) => Promise<void>;
}

interface FavoritesPayload {
  readonly favorites?: readonly string[];
  readonly error?: string;
}

function normalize(sym: string): string {
  return sym.trim().toUpperCase();
}

export function useFavoriteInstruments(): UseFavoriteInstrumentsReturn {
  const [favorites, setFavorites] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch("/api/favorites", { cache: "no-store" });
        const body = (await res.json()) as FavoritesPayload;
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? "Failed to load favorites");
          return;
        }
        setFavorites(body.favorites ?? []);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const isFavorite = useCallback(
    (instrument: string): boolean =>
      favorites.includes(normalize(instrument)),
    [favorites],
  );

  const toggle = useCallback(
    async (instrumentRaw: string): Promise<void> => {
      const instrument = normalize(instrumentRaw);
      const currentlyFav = favorites.includes(instrument);
      const previous = favorites;

      // Optimistic update — server is the source of truth but UI stays snappy.
      const next = currentlyFav
        ? favorites.filter((i) => i !== instrument)
        : [...favorites, instrument];
      setFavorites(next);

      try {
        const res = currentlyFav
          ? await fetch(
              `/api/favorites?instrument=${encodeURIComponent(instrument)}`,
              { method: "DELETE" },
            )
          : await fetch("/api/favorites", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ instrument }),
            });

        const body = (await res.json()) as FavoritesPayload;
        if (!res.ok) {
          setFavorites(previous);
          setError(body.error ?? "Failed to update favorite");
          return;
        }
        setFavorites(body.favorites ?? next);
        setError(null);
      } catch (err: unknown) {
        setFavorites(previous);
        setError(err instanceof Error ? err.message : "Network error");
      }
    },
    [favorites],
  );

  return { favorites, loading, error, isFavorite, toggle };
}
