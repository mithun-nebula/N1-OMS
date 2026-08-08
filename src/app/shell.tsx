"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { VoiceButton } from "./voice-input";

const NAV = [
  { href: "/today", label: "Today" },
  { href: "/calendar", label: "Calendar" },
  { href: "/courses", label: "Courses" },
  { href: "/team", label: "Team" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ displayName: string; role: string } | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user && setUser(d.user))
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-black">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-black/[.08] bg-white dark:border-white/[.1] dark:bg-black sm:flex">
        <div className="px-5 py-6">
          <div className="text-xs font-medium uppercase tracking-widest text-teal-700 dark:text-teal-400">
            Organization A
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-teal-700/10 text-teal-700 dark:text-teal-300"
                    : "text-zinc-600 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-black/[.08] px-5 py-4 dark:border-white/[.1]">
          <div className="text-sm font-medium text-black dark:text-zinc-50">{user?.displayName ?? "…"}</div>
          <div className="text-xs text-zinc-400">{user?.role}</div>
          <button
            onClick={logout}
            className="mt-3 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="flex-1 overflow-x-hidden">
        <div className="border-b border-black/[.06] px-6 py-3 dark:border-white/[.06] sm:hidden">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-black dark:text-zinc-50">Organization A</span>
            <button onClick={logout} className="text-xs text-zinc-500">Sign out</button>
          </div>
          <div className="mt-2 flex gap-3">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-xs ${pathname === item.href ? "text-teal-700 dark:text-teal-300" : "text-zinc-500"}`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        {children}
      </div>
      <VoiceButton />
    </div>
  );
}
