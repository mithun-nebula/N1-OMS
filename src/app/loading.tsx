export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6" aria-busy>
      <div className="mt-2 h-8 w-56 animate-pulse rounded-full bg-raised" />
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-3xl bg-surface shadow-card" />
        <div className="h-28 animate-pulse rounded-3xl bg-surface shadow-card" style={{ animationDelay: "150ms" }} />
        <div className="h-28 animate-pulse rounded-3xl bg-surface shadow-card" style={{ animationDelay: "300ms" }} />
      </div>
      <p className="text-center text-[11px] font-medium text-ink-faint">Loading…</p>
    </div>
  );
}
