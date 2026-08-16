import { describe, it, expect } from "vitest";
import { validateEnv } from "@/lib/env";

const complete: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: "b".repeat(40),
  CREDENTIALS_ENCRYPTION_KEY: "0".repeat(64),
};

const REQUIRED_KEYS = Object.keys(complete);

describe("env validation (fail-fast, P8)", () => {
  it("passes with a complete, well-formed env", () => {
    expect(() => validateEnv(complete)).not.toThrow();
  });

  it.each(REQUIRED_KEYS)(
    "refuses to boot when %s is missing",
    (key: string) => {
      const { [key]: _dropped, ...rest } = complete;
      void _dropped;
      expect(() => validateEnv(rest)).toThrow(new RegExp(key));
    },
  );

  it.each(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"])(
    "refuses to boot when %s is present but too short",
    (key: string) => {
      expect(() => validateEnv({ ...complete, [key]: "short" })).toThrow(
        new RegExp(key),
      );
    },
  );

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
