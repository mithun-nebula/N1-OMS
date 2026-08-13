import type { ReactNode } from "react";

/**
 * What a list shows when it has nothing in it.
 *
 * Worth having as a component because Phase 1 starts against an empty database:
 * for a while, "nothing here yet" is the most common thing on screen, and
 * "no results" should never look like a broken page.
 */
export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-black/[.12] px-4 py-8 text-center dark:border-white/[.15]">
      <p className="text-sm text-zinc-400">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
