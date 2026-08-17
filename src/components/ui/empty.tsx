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
    <div className="fade-in rounded-2xl bg-raised px-4 py-8 text-center">
      <p className="text-sm text-ink-faint">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
