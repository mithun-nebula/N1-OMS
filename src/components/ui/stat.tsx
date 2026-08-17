import Link from "next/link";
import type { ReactNode } from "react";

export type StatTone = "plain" | "good" | "warn" | "bad";

const VALUE_TONE: Record<StatTone, string> = {
  plain: "text-ink",
  good: "text-mint-strong",
  warn: "text-peach-strong",
  bad: "text-rose-strong",
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
      <div className={`text-2xl font-extrabold ${VALUE_TONE[tone]}`}>{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-ink-faint">{label}</div>
      {hint && <div className="mt-1 text-xs text-ink-soft">{hint}</div>}
      {openInto && (
        <div className="mt-1 text-xs font-medium text-accent-strong">
          What this is made of →
        </div>
      )}
    </>
  );

  const shell = "block rounded-2xl bg-surface p-4 shadow-card";
  const target = openInto ?? href;

  if (!target) return <div className={shell}>{body}</div>;
  return (
    <Link href={target} className={`${shell} lift press`}>
      {body}
    </Link>
  );
}

/** Responsive row of stat tiles: two across on mobile, four on desktop. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>;
}
