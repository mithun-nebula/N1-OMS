import type { ReactNode } from "react";

/**
 * The card shell that ~40 places in the app currently re-type by hand.
 *
 * `tone` covers the three variants already in use: plain, amber for "needs your
 * attention", rose for "something is wrong".
 */
export type CardTone = "plain" | "attention" | "problem";

const TONE: Record<CardTone, string> = {
  plain: "bg-surface shadow-card",
  attention: "border-l-[3px] border-peach-strong bg-peach shadow-card",
  problem: "border-l-[3px] border-rose-strong bg-rose shadow-card",
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
    <section className={`rise rounded-3xl p-5 ${TONE[tone]} ${className}`}>
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
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
        {title}
      </h2>
      {action}
    </div>
  );
}
