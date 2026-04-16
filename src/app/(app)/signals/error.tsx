"use client";

import { Button } from "@/components/ui/button";

export default function SignalsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-lg font-semibold text-foreground">
        Something went wrong
      </h2>
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        {error.message || "Failed to load signals. Please try again."}
      </p>
      <Button
        onClick={reset}
        className="bg-emerald-600 text-white hover:bg-emerald-500"
      >
        Try again
      </Button>
    </div>
  );
}
