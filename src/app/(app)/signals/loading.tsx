import { Skeleton } from "@/components/ui/skeleton";

export default function SignalsLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32 bg-slate-200" />
          <Skeleton className="h-4 w-56 bg-slate-200" />
        </div>
        <Skeleton className="h-10 w-32 bg-slate-200" />
      </div>

      {/* Table skeleton */}
      <div className="overflow-hidden rounded-lg border border-slate-200">
        {/* Header row */}
        <div className="flex gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-20 bg-slate-200" />
          ))}
        </div>

        {/* Data rows */}
        {Array.from({ length: 5 }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="flex gap-4 border-b border-slate-200 px-4 py-3"
          >
            <Skeleton className="h-4 w-28 bg-slate-200" />
            <Skeleton className="h-4 w-16 bg-slate-200" />
            <Skeleton className="h-5 w-12 rounded-full bg-slate-200" />
            <Skeleton className="h-4 w-20 bg-slate-200" />
            <Skeleton className="h-4 w-20 bg-slate-200" />
            <Skeleton className="h-5 w-16 rounded-full bg-slate-200" />
            <Skeleton className="h-4 w-10 bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
