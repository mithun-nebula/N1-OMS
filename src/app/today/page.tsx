import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";
import { isRestricted } from "@/spine/permission/types";
import { LogoutButton } from "./logout-button";

const ROLE_CAPABILITIES: Record<string, string[]> = {
  "super-admin": [
    "Full system control",
    "All records, all actions incl. delete",
    "User & role management",
  ],
  admin: [
    "Org administration",
    "All records (view/create/edit/approve/export)",
    "No delete (reserved for super-admin)",
  ],
  hr: [
    "People & payroll",
    "View/edit/approve/export employee records",
    "See pay & performance fields",
  ],
  manager: [
    "Manage your team",
    "Approve leave (people actions always ask)",
    "View/edit courses across the org",
  ],
  employee: [
    "Your own work & records",
    "Edit your own leave",
    "View the team directory (pay is Restricted)",
    "Write/edit courses in your team",
  ],
  intern: [
    "Read-only access",
    "View the team directory (pay is Restricted)",
    "View courses in your team",
  ],
};

export default async function TodayPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const spine = getSpine();
  const readPriya = spine.read({
    actor: user.id,
    nodeType: "employee",
    nodeId: "priya",
  });
  const payPreview =
    readPriya.found && !isRestricted(readPriya.record.pay)
      ? String(readPriya.record.pay)
      : readPriya.found
        ? "🔒 Restricted"
        : "not available";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <header className="border-b border-black/[.08] bg-white dark:border-white/[.1] dark:bg-black">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-widest text-teal-700 dark:text-teal-400">
              Organization A · Today
            </div>
            <div className="mt-0.5 text-lg font-semibold text-black dark:text-zinc-50">
              {user.displayName}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-teal-700/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-teal-700 dark:text-teal-300">
              {user.role}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              What your role can do
            </h2>
            <ul className="mt-3 space-y-1.5">
              {(ROLE_CAPABILITIES[user.role] ?? []).map((cap) => (
                <li
                  key={cap}
                  className="text-sm text-zinc-700 dark:text-zinc-300"
                >
                  · {cap}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Live RBAC check
            </h2>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Reading <code className="font-mono">employee/priya</code> as you:
            </p>
            <p className="mt-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">pay: </span>
              <span className="font-medium text-black dark:text-zinc-50">
                {payPreview}
              </span>
            </p>
            <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-600">
              HR/admin see the number; everyone else gets 🔒 Restricted — never
              silently blank.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Try the spine API
          </h2>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link
              href="/api/me"
              className="rounded-lg border border-black/[.1] px-3 py-1.5 font-mono hover:border-teal-600 dark:border-white/[.15]"
            >
              GET /api/me
            </Link>
            <Link
              href="/api/figures/course/ai-presentations"
              className="rounded-lg border border-black/[.1] px-3 py-1.5 font-mono hover:border-teal-600 dark:border-white/[.15]"
            >
              GET /api/figures/course/ai-presentations
            </Link>
            <Link
              href="/api/activity"
              className="rounded-lg border border-black/[.1] px-3 py-1.5 font-mono hover:border-teal-600 dark:border-white/[.15]"
            >
              GET /api/activity
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
