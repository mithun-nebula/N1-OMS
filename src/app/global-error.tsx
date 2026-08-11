"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 dark:bg-black">
        <div className="text-4xl">⚠</div>
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Application error</h2>
        <p className="text-sm text-zinc-400">{error.message || "A critical error occurred."}</p>
        <button onClick={reset} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
      </body>
    </html>
  );
}
