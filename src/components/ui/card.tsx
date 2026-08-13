import type { ReactNode } from "react";

/**
 * The card shell that ~40 places in the app currently re-type by hand.
 *
 * `tone` covers the three variants already in use: plain, amber for "needs your
 * attention", rose for "something is wrong".
 */
export type CardTone = "plain" | "attention" | "problem";

const TONE: Record<CardTone, string> = {
  plain:
    "border-black/[.08] bg-white dark:border-white/[.12] dark:bg-black",
  attention:
    "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
  problem:
    "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950",
};

export function Card({
  children,
  tone = "plain",
  className = "",
}: {
  children: ReactNode;
  tone?: CardTone;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border p-5 ${TONE[tone]} ${className}`}>
      {children}
    </section>
  );
}

/**
 * A card's heading row. `action` is the "View all →" style link on the right.
 */
export function CardHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h2>
      {action}
    </div>
  );
}
