import { Skeleton } from "@/components/ui/skeleton";

export default function SignalsLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32 bg-muted" />
          <Skeleton className="h-4 w-56 bg-muted" />
        </div>
        <Skeleton className="h-10 w-32 bg-muted" />
      </div>

      {/* Table skeleton */}
      <div className="overflow-hidden rounded-lg border border-border">
        {/* Header row */}
        <div className="flex gap-4 border-b border-border bg-muted px-4 py-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-20 bg-muted" />
          ))}
        </div>

        {/* Data rows */}
        {Array.from({ length: 5 }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="flex gap-4 border-b border-border px-4 py-3"
          >
            <Skeleton className="h-4 w-28 bg-muted" />
            <Skeleton className="h-4 w-16 bg-muted" />
            <Skeleton className="h-5 w-12 rounded-full bg-muted" />
            <Skeleton className="h-4 w-20 bg-muted" />
            <Skeleton className="h-4 w-20 bg-muted" />
            <Skeleton className="h-5 w-16 rounded-full bg-muted" />
            <Skeleton className="h-4 w-10 bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
