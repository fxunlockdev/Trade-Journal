import { Skeleton } from "@/components/ui/skeleton";

export default function CalendarLoading() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <Skeleton className="h-8 w-40 bg-muted" />
        <Skeleton className="mt-2 h-4 w-72 bg-muted" />
      </div>

      {/* Header row: nav + summary pills */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-8 w-64 rounded-lg bg-muted" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-11 w-24 rounded-lg bg-muted" />
          <Skeleton className="h-11 w-20 rounded-lg bg-muted" />
          <Skeleton className="h-11 w-24 rounded-lg bg-muted" />
          <Skeleton className="h-11 w-16 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full bg-muted" />
        ))}
      </div>

      {/* 5 week rows */}
      <div className="space-y-1 sm:space-y-2">
        {Array.from({ length: 5 }).map((_, w) => (
          <div key={w} className="grid grid-cols-7 gap-1 sm:gap-2">
            {Array.from({ length: 7 }).map((_, d) => (
              <Skeleton
                key={d}
                className="min-h-[56px] w-full rounded-lg bg-muted sm:min-h-[84px]"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
