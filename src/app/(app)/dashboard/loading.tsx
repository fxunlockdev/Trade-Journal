import { Skeleton } from "@/components/ui/skeleton";

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20 bg-zinc-800" />
        <Skeleton className="h-8 w-8 rounded-lg bg-zinc-800" />
      </div>
      <Skeleton className="mt-4 h-7 w-28 bg-zinc-800" />
      <Skeleton className="mt-2 h-3 w-24 bg-zinc-800" />
    </div>
  );
}

function ChartSkeleton({ height = "h-[350px]" }: { readonly height?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <Skeleton className="mb-4 h-5 w-36 bg-zinc-800" />
      <Skeleton className={`w-full rounded-lg bg-zinc-800/50 ${height}`} />
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40 bg-zinc-800" />
        <Skeleton className="h-9 w-56 rounded-lg bg-zinc-800" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>

      <ChartSkeleton />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartSkeleton />
        </div>
        <ChartSkeleton height="h-[280px]" />
      </div>

      <ChartSkeleton height="h-[280px]" />
    </div>
  );
}
