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
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-black/[.08] px-6 py-4 dark:border-white/[.12]">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Standard vertical rhythm for page contents, below the header. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="space-y-6 p-6">{children}</div>;
}
