export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-700 border-t-transparent dark:border-teal-400 dark:border-t-transparent" />
        <p className="text-xs text-zinc-400">Loading…</p>
      </div>
    </div>
  );
}
