import { z } from "zod";
import { SIGNAL_STATUSES } from "@/lib/constants/signal-status";

const directions = ["buy", "sell"] as const;

export const createSignalSchema = z.object({
  trader_id: z.string().trim().min(1),
  instrument: z.string().trim().min(1).max(20),
  direction: z.enum(directions),
  entry_price: z.coerce.number().positive(),
  stop_loss: z.coerce.number().positive(),
  tp1: z.coerce.number().positive().nullable().optional(),
  tp2: z.coerce.number().positive().nullable().optional(),
  tp3: z.coerce.number().positive().nullable().optional(),
  tp4: z.coerce.number().positive().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(SIGNAL_STATUSES).default("CREATED"),
  risk_amount: z.coerce.number().positive().nullable().optional(),
});

export const updateSignalStatusSchema = z.object({
  status: z.enum(SIGNAL_STATUSES),
});

export type CreateSignalInput = z.infer<typeof createSignalSchema>;
export type UpdateSignalStatusInput = z.infer<typeof updateSignalStatusSchema>;
