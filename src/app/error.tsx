"use client";

import { useEffect } from "react";

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
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 dark:bg-black">
      <div className="text-4xl">⚠</div>
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Something went wrong</h2>
      <p className="max-w-sm text-center text-sm text-zinc-400">
        An unexpected error occurred while rendering this page. It has been recorded.
      </p>
      <div className="flex gap-3">
        <button onClick={reset} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
        <a href="/dashboard" className="rounded-lg border border-black/[.1] px-4 py-2 text-sm text-zinc-600 dark:border-white/[.2] dark:text-zinc-300">
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
