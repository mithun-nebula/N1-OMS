import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 dark:bg-black">
      <div className="text-5xl font-light text-zinc-300 dark:text-zinc-700">404</div>
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Page not found</h2>
      <p className="text-sm text-zinc-400">That page doesn’t exist or you don’t have access to it.</p>
      <Link href="/dashboard" className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">
        Back to dashboard
      </Link>
    </div>
  );
}
