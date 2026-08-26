"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { parseStoredLogo, readLogoFile } from "@/lib/posters/logo";
import { safeGet, safeRemove, safeSet } from "@/lib/safe-storage";

/**
 * The uploaded logo that stands in for a poster's group name.
 *
 * Owns the whole lifecycle for one journal combination: hydrate from storage,
 * validate and apply an upload, persist, remove. The component that renders the
 * poster only needs `logo` and the three handlers.
 *
 * `storageKey` is the caller's scope. Pass null when there is no combination to
 * remember (no journals selected); an upload still applies for the session, it
 * just isn't persisted.
 */
interface UsePosterLogoReturn {
  /** A validated PNG data URL, or null to print the group name. */
  readonly logo: string | null;
  /** True while a picked file is being decoded. */
  readonly busy: boolean;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly onPicked: (file: File | undefined) => Promise<void>;
  readonly onRemove: () => void;
}

export function usePosterLogo(storageKey: string | null): UsePosterLogoReturn {
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Mirrors storageKey for the async upload path. Reading the prop after an
  // await reads the value captured when the handler was created, which is stale
  // the moment the journal selection changes mid-upload.
  const keyRef = useRef(storageKey);

  useEffect(() => {
    keyRef.current = storageKey;
    setLogo(storageKey ? parseStoredLogo(safeGet(storageKey)) : null);
  }, [storageKey]);

  const onPicked = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    // Decoding is async and the journal chips stay live throughout. Bind the
    // logo to the selection it was PICKED for, not to whatever is selected when
    // the decode happens to finish.
    const pickedFor = keyRef.current;
    setBusy(true);
    try {
      const parsed = await readLogoFile(file);
      // No key means no journals are selected, so there is no combination to
      // remember it against. The logo still applies for the session.
      const saved = pickedFor ? safeSet(pickedFor, parsed.dataUrl) : true;

      // The selection moved while this was decoding. Applying the logo now
      // would print one team's mark over another team's numbers, the exact
      // failure the per-combination key exists to prevent. The effect above has
      // already loaded the right logo for the new selection, so leave it alone.
      if (keyRef.current !== pickedFor) {
        // Reports what actually happened. A blanket success here would tell a
        // user whose write ALSO failed that their logo was kept, when it was
        // neither applied nor stored: the upload vanished under a green toast.
        if (saved) {
          toast.success("Logo saved to the journals it was picked for.");
        } else {
          toast.warning(
            "That logo couldn't be saved. Re-pick it with those journals selected.",
          );
        }
        return;
      }

      setLogo(parsed.dataUrl);
      // Independent conditions, so neither can silence the other. Storage
      // outcome and pixel content have nothing to do with each other, and an
      // if/else chain would drop the transparency warning — the only one of the
      // two that changes the published artefact — whenever a write failed.
      if (!parsed.transparent) {
        toast.warning(
          "That PNG has no transparency, so it will print as a solid rectangle. Export it with a transparent background.",
        );
      }
      if (!saved) {
        toast.warning("Logo applied, but it couldn't be saved for next time.");
      } else if (parsed.transparent) {
        toast.success("Logo added");
      }
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "That logo couldn't be read.",
      );
    } finally {
      setBusy(false);
      // Cleared so re-picking the SAME file fires change again; without this a
      // user who fixes their PNG and re-uploads it sees nothing happen.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onRemove = (): void => {
    setLogo(null);
    // Said out loud, because state and storage have now diverged: on the next
    // load the hydrate above would resurrect the logo the user just deleted.
    if (storageKey && !safeRemove(storageKey)) {
      toast.warning("Logo removed, but it couldn't be cleared from this browser.");
    }
  };

  return { logo, busy, inputRef, onPicked, onRemove };
}
