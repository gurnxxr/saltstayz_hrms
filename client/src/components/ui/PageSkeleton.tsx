'use client';

export default function PageSkeleton({ cards = 0, table = true }: { cards?: number; table?: boolean }) {
  return (
    <div className="animate-pulse space-y-6 p-6 ml-64">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-48 bg-muted rounded-lg" />
          <div className="h-4 w-72 bg-muted rounded-lg mt-2" />
        </div>
        <div className="h-10 w-32 bg-muted rounded-lg" />
      </div>

      {/* Stat cards */}
      {cards > 0 && (
        <div className={`grid grid-cols-${Math.min(cards, 5)} gap-4`}>
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-xl" />
          ))}
        </div>
      )}

      {/* Table */}
      {table && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="h-12 bg-muted/50 border-b border-border" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 border-b border-border px-4 flex items-center gap-4">
              <div className="h-4 w-16 bg-muted rounded" />
              <div className="h-4 w-32 bg-muted rounded" />
              <div className="h-4 w-24 bg-muted rounded" />
              <div className="h-4 w-20 bg-muted rounded" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
