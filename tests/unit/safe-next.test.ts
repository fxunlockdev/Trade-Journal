import { describe, it, expect } from "vitest";
import { safeInternalPath } from "@/lib/safe-next";

describe("safeInternalPath (open-redirect guard)", () => {
  it("allows a plain relative in-app path", () => {
    expect(safeInternalPath("/crm")).toBe("/crm");
    expect(safeInternalPath("/dashboard/settings")).toBe("/dashboard/settings");
    expect(safeInternalPath("/journal/123?tab=trades")).toBe(
      "/journal/123?tab=trades",
    );
  });

  it("falls back for empty / missing values", () => {
    expect(safeInternalPath(null)).toBe("/dashboard");
    expect(safeInternalPath(undefined)).toBe("/dashboard");
    expect(safeInternalPath("")).toBe("/dashboard");
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(safeInternalPath("//evil.com")).toBe("/dashboard");
    expect(safeInternalPath("https://evil.com")).toBe("/dashboard");
    expect(safeInternalPath("http://evil.com/path")).toBe("/dashboard");
  });

  it("rejects the backslash normalisation trick", () => {
    expect(safeInternalPath("/\\evil.com")).toBe("/dashboard");
    expect(safeInternalPath("/\\/evil.com")).toBe("/dashboard");
  });

  it("rejects non-path values (no leading slash)", () => {
    expect(safeInternalPath("evil.com")).toBe("/dashboard");
    expect(safeInternalPath("javascript:alert(1)")).toBe("/dashboard");
  });

  it("honours a custom fallback", () => {
    expect(safeInternalPath(null, "/login")).toBe("/login");
    expect(safeInternalPath("//x", "/login")).toBe("/login");
  });
});
