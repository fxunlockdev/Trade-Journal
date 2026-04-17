"use client";

import { Toaster } from "sonner";
import { useTheme } from "next-themes";

export function ToasterProvider() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={(resolvedTheme ?? "system") as "light" | "dark" | "system"}
      position="top-right"
      richColors
      closeButton
    />
  );
}
