import { z } from "zod";
import { GROUP_NAME_MAX } from "@/lib/posters/scope";

/**
 * A desk names and brands a set of journals for publishing.
 *
 * The name cap is GROUP_NAME_MAX, the width the poster header was designed
 * around — a longer name does not wrap on a 1080px canvas, it overruns it. The
 * same number is a CHECK constraint on the table, so a client bypassing this
 * still cannot store one that would break the artefact.
 */

/**
 * Is this a canonical IANA timezone?
 *
 * Checked against `Intl.supportedValuesOf("timeZone")` rather than by asking
 * whether `Intl.DateTimeFormat` merely ACCEPTS it, because it accepts a set of
 * legacy aliases that resolve somewhere entirely different:
 *
 *   "BST" -> Asia/Dhaka          (not British Summer Time)
 *   "EST" -> America/Panama
 *   "GMT" -> UTC
 *
 * A desk's zone decides what "yesterday" means for its report. Someone typing
 * "BST" for British Summer Time would get Bangladesh, six hours out, and every
 * trade near midnight would land on the wrong day of a published poster. It
 * would never throw, so nothing downstream could notice.
 *
 * "UTC" is not in the canonical list either, but it is unambiguous and useful,
 * so it is allowed explicitly.
 */
const CANONICAL_ZONES: ReadonlySet<string> = new Set([
  ...(typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : []),
  "UTC",
]);

export function isValidTimeZone(tz: string): boolean {
  // A runtime without supportedValuesOf would give an empty set and refuse
  // everything, so fall back to the looser check there rather than locking
  // every desk out.
  if (CANONICAL_ZONES.size <= 1) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }
  return CANONICAL_ZONES.has(tz);
}

const timezone = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, "must be a valid IANA timezone, e.g. Europe/London");

const journalIds = z
  .array(z.string().uuid())
  .min(1, "a desk needs at least one journal")
  .max(10)
  // Order carries no meaning and a duplicate would double-count that journal's
  // trades in the desk's own report.
  .transform((ids) => [...new Set(ids)].sort());

export const createDeskSchema = z.object({
  name: z.string().trim().min(1).max(GROUP_NAME_MAX),
  journal_ids: journalIds,
  timezone: timezone.default("Europe/London"),
  logo_path: z.string().max(300).nullable().optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
});

export const updateDeskSchema = z
  .object({
    name: z.string().trim().min(1).max(GROUP_NAME_MAX),
    journal_ids: journalIds,
    timezone,
    logo_path: z.string().max(300).nullable(),
    sort_order: z.number().int().min(0).max(999),
    is_active: z.boolean(),
  })
  .partial();

export type CreateDeskInput = z.infer<typeof createDeskSchema>;
export type UpdateDeskInput = z.infer<typeof updateDeskSchema>;
