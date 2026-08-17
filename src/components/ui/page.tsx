import type { ReactNode } from "react";

/**
 * The header bar that every page currently re-types.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="rise flex flex-wrap items-end justify-between gap-3 px-4 pt-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Standard vertical rhythm for page contents, below the header. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">{children}</div>;
}
