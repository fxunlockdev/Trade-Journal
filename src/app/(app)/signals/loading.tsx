import { Skeleton } from "@/components/ui/skeleton";

export default function SignalsLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32 bg-zinc-800" />
          <Skeleton className="h-4 w-56 bg-zinc-800/60" />
        </div>
        <Skeleton className="h-10 w-32 bg-zinc-800" />
      </div>

      {/* Table skeleton */}
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        {/* Header row */}
        <div className="flex gap-4 border-b border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <Skeleton className="h-4 w-20 bg-zinc-800" />
          <Skeleton className="h-4 w-24 bg-zinc-800" />
          <Skeleton className="h-4 w-16 bg-zinc-800" />
          <Skeleton className="h-4 w-20 bg-zinc-800" />
          <Skeleton className="h-4 w-20 bg-zinc-800" />
          <Skeleton className="h-4 w-16 bg-zinc-800" />
        </div>

        {/* Data rows */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-zinc-800/50 px-4 py-4"
          >
            <Skeleton className="h-4 w-20 bg-zinc-800/60" />
            <Skeleton className="h-4 w-24 bg-zinc-800/60" />
            <Skeleton className="h-5 w-14 rounded-full bg-zinc-800/60" />
            <Skeleton className="h-4 w-20 bg-zinc-800/60" />
            <Skeleton className="h-4 w-20 bg-zinc-800/60" />
            <Skeleton className="h-5 w-16 rounded-full bg-zinc-800/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
