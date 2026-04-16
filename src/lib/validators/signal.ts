import { z } from "zod";
import type { SignalStatus } from "@/types/database";
import { SIGNAL_STATUS_TRANSITIONS } from "@/lib/constants/signal-status";

const directions = ["buy", "sell"] as const;
const signalStatuses = [
  "CREATED",
  "SENT",
  "ACTIVE",
  "TP_HIT",
  "SL_HIT",
  "CLOSED",
] as const;

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
  status: z.enum(signalStatuses).default("CREATED"),
  risk_amount: z.coerce.number().positive().nullable().optional(),
});

export const updateSignalSchema = createSignalSchema.partial();

export const updateSignalStatusSchema = z
  .object({
    currentStatus: z.enum(signalStatuses),
    newStatus: z.enum(signalStatuses),
  })
  .refine(
    (data) => {
      const allowed = SIGNAL_STATUS_TRANSITIONS[
        data.currentStatus as SignalStatus
      ] as readonly string[];
      return allowed.includes(data.newStatus);
    },
    {
      message: "Invalid status transition",
    },
  );

export type CreateSignalInput = z.infer<typeof createSignalSchema>;
export type UpdateSignalInput = z.infer<typeof updateSignalSchema>;
