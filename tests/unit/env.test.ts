import { describe, it, expect } from "vitest";
import { validateEnv } from "@/lib/env";

const complete: NodeJS.ProcessEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: "b".repeat(40),
  CREDENTIALS_ENCRYPTION_KEY: "0".repeat(64),
};

describe("env validation (fail-fast, P8)", () => {
  it("passes with a complete, well-formed env", () => {
    expect(() => validateEnv(complete)).not.toThrow();
  });

  it("refuses to boot when a required secret is missing", () => {
    const { SUPABASE_SERVICE_ROLE_KEY, ...missing } = complete;
    void SUPABASE_SERVICE_ROLE_KEY;
    expect(() => validateEnv(missing)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("refuses to boot when the Supabase URL is malformed", () => {
    expect(() =>
      validateEnv({ ...complete, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }),
    ).toThrow(/URL/);
  });

  it("refuses to boot when the encryption key is not 64 hex chars", () => {
    expect(() =>
      validateEnv({ ...complete, CREDENTIALS_ENCRYPTION_KEY: "short" }),
    ).toThrow(/hex/);
  });
});
