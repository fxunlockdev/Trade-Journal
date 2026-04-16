import { Skeleton } from "@/components/ui/skeleton";

function TableRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border/40">
      <Skeleton className="h-4 w-[100px]" />
      <Skeleton className="h-4 w-[80px]" />
      <Skeleton className="h-5 w-[50px] rounded-full" />
      <Skeleton className="h-4 w-[70px]" />
      <Skeleton className="h-4 w-[70px]" />
      <Skeleton className="h-4 w-[80px]" />
      <Skeleton className="h-4 w-[50px]" />
      <Skeleton className="h-5 w-[60px] rounded-full" />
      <div className="ml-auto flex gap-2">
        <Skeleton className="h-7 w-[40px]" />
        <Skeleton className="h-7 w-[50px]" />
      </div>
    </div>
  );
}

export default function JournalLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-[180px]" />
          <Skeleton className="h-4 w-[100px]" />
        </div>
        <Skeleton className="h-9 w-[100px]" />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Skeleton className="h-9 w-[150px]" />
        <Skeleton className="h-9 w-[150px]" />
        <Skeleton className="h-9 w-[140px]" />
        <Skeleton className="h-9 w-[120px]" />
        <Skeleton className="h-9 w-[140px]" />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border/40 overflow-hidden">
        {/* Header row */}
        <div className="flex items-center gap-4 px-4 py-3 bg-muted/30 border-b border-border/40">
          <Skeleton className="h-3 w-[60px]" />
          <Skeleton className="h-3 w-[80px]" />
          <Skeleton className="h-3 w-[60px]" />
          <Skeleton className="h-3 w-[50px]" />
          <Skeleton className="h-3 w-[40px]" />
          <Skeleton className="h-3 w-[40px]" />
          <Skeleton className="h-3 w-[30px]" />
          <Skeleton className="h-3 w-[40px]" />
          <Skeleton className="ml-auto h-3 w-[50px]" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <TableRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
