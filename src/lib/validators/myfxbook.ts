import { z } from "zod";

/**
 * Myfxbook bridge payloads.
 *
 * Connecting is two-phase over one endpoint (stateless — credentials are
 * only PERSISTED in phase 2):
 *   1. { email, password, journal_id }            → validate login, return account list
 *   2. { ...same, myfxbook_account_id }           → store encrypted + create connection
 */
export const connectMyfxbookSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  journal_id: z.string().trim().uuid(),
  myfxbook_account_id: z.string().trim().min(1).max(32).optional(),
  /** Broker timezone offset in minutes from UTC (Myfxbook times are broker-local). */
  broker_utc_offset_minutes: z.coerce
    .number()
    .int()
    .min(-720)
    .max(840)
    .default(0),
});

export type ConnectMyfxbookInput = z.infer<typeof connectMyfxbookSchema>;
