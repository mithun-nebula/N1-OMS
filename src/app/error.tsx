"use client";

import { useEffect } from "react";
import { Icon } from "./ui/icons";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base px-6">
      <div className="pop-in rounded-3xl bg-surface p-8 text-center shadow-card">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent-strong">
          <Icon name="spark" className="h-6 w-6" />
        </span>
        <h2 className="mt-4 text-xl font-light tracking-tight text-ink">
          Something went <span className="font-extrabold">sideways</span>
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
          This page hit an unexpected error while rendering. Nothing was lost —
          it has been recorded, and a retry usually clears it.
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="press rounded-full bg-chrome px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="press rounded-full bg-raised px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:text-ink"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
