import { z } from "zod";

/**
 * Startup environment validation (P8: fail loud).
 *
 * The server must refuse to boot if a required secret is missing or malformed,
 * rather than starting in a half-configured state that fails later, per-request,
 * in ways that can mask an authz problem. Wired into `src/instrumentation.ts`
 * so it runs once on server start.
 *
 * Only the vars whose absence makes the app unsafe/broken are required here.
 * Optional integrations (OpenAI, Telegram, Myfxbook proxy, cron/bootstrap
 * secrets) are validated where they are used, not at boot, so a missing
 * optional integration degrades that feature instead of downing the server.
 */
const isUrl = (v: string): boolean => {
  try {
    // eslint-disable-next-line no-new
    new URL(v);
    return true;
  } catch {
    return false;
  }
};

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .refine(isUrl, "must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, "missing or too short"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "missing or too short"),
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex chars (32 bytes for AES-256-GCM)"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Validate and return required server env, or throw a clear, actionable error. */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[env] Invalid or missing environment variables:\n${issues}\n` +
        `[env] The server refuses to boot. Fix your environment and restart.`,
    );
  }
  return parsed.data;
}
