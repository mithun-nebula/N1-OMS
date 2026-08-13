import Link from "next/link";
import type { ReactNode } from "react";

export type StatTone = "plain" | "good" | "warn" | "bad";

const VALUE_TONE: Record<StatTone, string> = {
  plain: "text-black dark:text-zinc-50",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
};

/**
 * A single number with a label. Becomes a link when `href` is given.
 *
 * `openInto` is for figures: non-negotiable #13 says any figure opens into the
 * parts it was computed from, so a tile showing a computed number should point
 * at its breakdown rather than being a dead end.
 */
export function StatTile({
  value,
  label,
  href,
  tone = "plain",
  hint,
  openInto,
}: {
  value: ReactNode;
  label: string;
  href?: string;
  tone?: StatTone;
  hint?: string;
  openInto?: string;
}) {
  const body = (
    <>
      <div className={`text-2xl font-semibold ${VALUE_TONE[tone]}`}>{value}</div>
      <div className="mt-0.5 text-xs text-zinc-400">{label}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
      {openInto && (
        <div className="mt-1 text-xs text-teal-600 dark:text-teal-400">
          What this is made of →
        </div>
      )}
    </>
  );

  const shell =
    "block rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.12] dark:bg-black";
  const target = openInto ?? href;

  if (!target) return <div className={shell}>{body}</div>;
  return (
    <Link href={target} className={`${shell} transition-colors hover:border-teal-600`}>
      {body}
    </Link>
  );
}

/** Responsive row of stat tiles: two across on mobile, four on desktop. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{children}</div>;
}
