import type { JournalColor } from "@/types/database";

/**
 * Server-usable colour → tailwind class map. Mirrors the one in
 * journal-switcher.tsx; kept separate so server components can import it
 * without pulling in client-only code.
 */
export const COLOR_CLASS_SERVER: Record<JournalColor, string> = {
  slate: "bg-slate-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  orange: "bg-orange-500",
  cyan: "bg-cyan-500",
  rose: "bg-rose-500",
  lime: "bg-lime-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};
