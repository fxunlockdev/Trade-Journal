import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function PageSkeleton({ className }: SkeletonProps) {
  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-48 bg-slate-200" />
        <Skeleton className="h-4 w-72 bg-slate-200/60" />
      </div>

      {/* Cards row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={`page-card-${i}`} />
        ))}
      </div>

      {/* Table */}
      <TableSkeleton />
    </div>
  );
}

export function CardSkeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-6",
        className,
      )}
    >
      <div className="space-y-3">
        <Skeleton className="h-4 w-24 bg-slate-200" />
        <Skeleton className="h-8 w-32 bg-slate-200/60" />
        <Skeleton className="h-3 w-20 bg-slate-200/40" />
      </div>
    </div>
  );
}

export function TableSkeleton({
  className,
  rows = 5,
}: SkeletonProps & { rows?: number }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white",
        className,
      )}
    >
      {/* Table header */}
      <div className="flex items-center gap-4 border-b border-slate-200 px-6 py-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={`th-${i}`} className="h-4 flex-1 bg-slate-200" />
        ))}
      </div>

      {/* Table rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={`tr-${i}`}
          className="flex items-center gap-4 border-b border-slate-200/50 px-6 py-4 last:border-0"
        >
          {Array.from({ length: 5 }).map((_, j) => (
            <Skeleton
              key={`td-${i}-${j}`}
              className="h-4 flex-1 bg-slate-200/50"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-6",
        className,
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32 bg-slate-200" />
          <Skeleton className="h-8 w-24 bg-slate-200/60" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg bg-slate-200/40" />
      </div>
    </div>
  );
}
