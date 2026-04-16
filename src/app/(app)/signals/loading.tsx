import { Skeleton } from "@/components/ui/skeleton";

export default function SignalsLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32 bg-zinc-800" />
          <Skeleton className="h-4 w-56 bg-zinc-800" />
        </div>
        <Skeleton className="h-10 w-32 bg-zinc-800" />
      </div>

      {/* Table skeleton */}
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        {/* Header row */}
        <div className="flex gap-4 border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-20 bg-zinc-800" />
          ))}
        </div>

        {/* Data rows */}
        {Array.from({ length: 5 }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="flex gap-4 border-b border-zinc-800/50 px-4 py-3"
          >
            <Skeleton className="h-4 w-28 bg-zinc-800" />
            <Skeleton className="h-4 w-16 bg-zinc-800" />
            <Skeleton className="h-5 w-12 rounded-full bg-zinc-800" />
            <Skeleton className="h-4 w-20 bg-zinc-800" />
            <Skeleton className="h-4 w-20 bg-zinc-800" />
            <Skeleton className="h-5 w-16 rounded-full bg-zinc-800" />
            <Skeleton className="h-4 w-10 bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
